// ACCOUNTS against the local PostgreSQL: IDOR (another customer's order, address or favorite is "not
// found"), the address book rules, favorites, guest-order linking only after verification (+ the
// welcome mail once), the cart attach / merge at sign-in, "Bu adresi kaydet" and account deletion
// (anonymization that keeps orders).
//
// Shared database: every row this file creates belongs to users / e-mails starting with
// "accounts-test-" (@test.local) and is removed in after(); stock, variant updated_at and the id
// sequences it moves are put back, and the counts are compared with the snapshot.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/accounts.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listAddresses, MAX_ADDRESSES, saveAddress, saveAddressFromOrder, deleteAddress, setDefaultAddress } from "@/lib/account/addresses";
import { attachCartToUser } from "@/lib/account/cart-merge";
import { AccountError } from "@/lib/account/errors";
import { completeEmailVerification, queuePasswordChanged } from "@/lib/account/events";
import { listFavoriteIds, setFavorite } from "@/lib/account/favorites";
import { accountOrderToken, linkGuestOrders, listAccountOrders } from "@/lib/account/orders";
import { addressInputSchema, type AddressInput } from "@/lib/account/schemas";
import { ANONYMIZED_NAME, anonymizeAccount, anonymizedEmail, isAnonymizedEmail, marketingState, withdrawMarketingConsent } from "@/lib/account/service";
import { addItem } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { outboxDirectory } from "@/lib/email/drivers";
import { placeOrder, type PlaceOrderSuccess } from "@/lib/orders/place";

const PREFIX = "accounts-test-";
const mail = (tag: string) => `${PREFIX}${tag}@test.local`;
const NO_EFFECTS = { effects: false } as const;

const createdUsers = new Set<string>();
const createdCarts = new Set<string>();
const createdOrders = new Set<number>();

type Snapshot = {
  stock: Map<number, number>;
  stamps: Map<number, string>;
  counts: Record<string, number>;
  sequences: { name: string; lastValue: string; isCalled: boolean }[];
};
let snap: Snapshot;
let settings: CommerceSettings;
const variants: Record<string, number> = {};
const products: { active: number; draftOrMissing: number } = { active: 0, draftOrMissing: 0 };

const COUNT_TABLES = ["user", "session", "account", "orders", "order_items", "order_events", "payments", "carts", "cart_items", "addresses", "favorites", "email_messages", "newsletter_subscribers", "subscriptions", "verification"] as const;
const SEQ_TABLES = ["orders", "order_items", "order_events", "payments", "cart_items", "addresses", "email_messages", "newsletter_subscribers", "subscriptions"] as const;

async function takeSnapshot(): Promise<Snapshot> {
  const v = schema.productVariants;
  const rows = await db.select({ id: v.id, stock: v.stock, updatedAt: sql<string>`${v.updatedAt}::text` }).from(v).orderBy(v.id);
  const counts: Record<string, number> = {};
  for (const t of COUNT_TABLES) counts[t] = Number((await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from "${t}"`)))[0].n);
  const names = ["public.order_number_seq"];
  for (const t of SEQ_TABLES) names.push((await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${t}, 'id') as seq`))[0].seq);
  const sequences: Snapshot["sequences"] = [];
  for (const name of names) {
    const [r] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${name}`));
    sequences.push({ name, lastValue: r.last_value, isCalled: r.is_called });
  }
  return { stock: new Map(rows.map((r) => [r.id, r.stock])), stamps: new Map(rows.map((r) => [r.id, r.updatedAt])), counts, sequences };
}

async function makeUser(tag: string, extra: Partial<typeof schema.user.$inferInsert> = {}): Promise<{ id: string; email: string }> {
  const id = `${PREFIX}${tag}-${randomUUID().slice(0, 8)}`;
  const email = mail(tag);
  await db.insert(schema.user).values({ id, name: `Test ${tag}`, email, emailVerified: true, role: "customer", ...extra });
  createdUsers.add(id);
  return { id, email };
}

function addressInput(overrides: Record<string, unknown> = {}): AddressInput {
  return addressInputSchema.parse({
    locale: "tr",
    title: "",
    address: { fullName: "Ayşe Test", phone: "0532 123 45 67", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
    invoice: { type: "individual" },
    ...overrides,
  });
}

async function placeCardOrder(email: string, customer: CustomerContext = RETAIL_CUSTOMER): Promise<PlaceOrderSuccess> {
  const added = await addItem(null, { variantId: variants["PR-LVL-500"], quantity: 1 }, { customer, locale: "tr", settings });
  assert.ok(added.ok);
  createdCarts.add(added.cartId);
  const r = await placeOrder(
    {
      locale: "tr",
      contact: { email, phone: "0532 123 45 67" },
      shippingAddress: { fullName: "Ayşe Test", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
      invoice: { type: "individual", sameAsShipping: true },
      paymentMethod: "card",
      consents: { preInformation: true, distanceSales: true },
    },
    { cartId: added.cartId, customer, settings, ...NO_EFFECTS, allowDraftContracts: true },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const ok = r as PlaceOrderSuccess;
  createdOrders.add(ok.orderId);
  return ok;
}

const userCustomer = (userId: string): CustomerContext => ({ ...RETAIL_CUSTOMER, userId });

async function myMailIds(): Promise<number[]> {
  return (await db.select({ id: schema.emailMessages.id }).from(schema.emailMessages).where(like(schema.emailMessages.toEmail, `${PREFIX}%@test.local`))).map((r) => r.id);
}

function removeOutboxFiles(ids: number[]) {
  const dir = outboxDirectory();
  if (!existsSync(dir) || ids.length === 0) return;
  const suffixes = ids.map((id) => `-${id}.`);
  for (const file of readdirSync(dir)) if (suffixes.some((s) => file.includes(s)) && /\.(html|txt|json)$/.test(file)) unlinkSync(path.join(dir, file));
}

async function cleanup() {
  removeOutboxFiles(await myMailIds());
  await db.delete(schema.emailMessages).where(like(schema.emailMessages.toEmail, `${PREFIX}%@test.local`));
  const o = schema.orders;
  const orderIds = (await db.select({ id: o.id }).from(o).where(sql`${o.email} like ${`${PREFIX}%@test.local`} or ${createdOrders.size ? inArray(o.id, [...createdOrders]) : sql`false`}`)).map((r) => r.id);
  if (orderIds.length) {
    // Give back the stock these orders took (a delta, so other agents' changes meanwhile survive).
    const items = await db.select({ variantId: schema.orderItems.variantId, quantity: schema.orderItems.quantity, snapshot: schema.orderItems.snapshot }).from(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds));
    for (const item of items) {
      if (item.variantId != null && item.snapshot.stockTracked) await db.execute(sql`update product_variants set stock = stock + ${item.quantity} where id = ${item.variantId}`);
    }
    await db.delete(o).where(inArray(o.id, orderIds));
  }
  const users = [...createdUsers];
  if (users.length) {
    await db.delete(schema.addresses).where(inArray(schema.addresses.userId, users));
    await db.delete(schema.subscriptions).where(inArray(schema.subscriptions.userId, users));
    await db.delete(schema.carts).where(inArray(schema.carts.userId, users));
    await db.delete(schema.verification).where(inArray(schema.verification.value, users));
  }
  if (createdCarts.size) await db.delete(schema.carts).where(inArray(schema.carts.id, [...createdCarts]));
  await db.delete(schema.newsletterSubscribers).where(like(schema.newsletterSubscribers.email, `${PREFIX}%@test.local`));
  if (users.length) await db.delete(schema.user).where(inArray(schema.user.id, users)); // sessions, accounts, favorites cascade
  // updated_at of the variants whose stock is back to the snapshot value (nobody else changed them).
  for (const [id, stock] of snap.stock) {
    const stamp = snap.stamps.get(id)!;
    await db.execute(sql`update product_variants set updated_at = ${stamp}::timestamptz where id = ${id} and stock = ${stock} and updated_at <> ${stamp}::timestamptz`);
  }
  const ordersSeq = snap.sequences.find((s) => s.name.endsWith(".orders_id_seq"));
  for (const s of snap.sequences) {
    // Only when nobody else inserted rows meanwhile (shared database). The order number sequence
    // follows the orders table: never hand out an order number twice.
    const table = s.name.endsWith("order_number_seq") ? "orders" : SEQ_TABLES.find((t) => s.name.endsWith(`.${t}_id_seq`));
    if (!table) continue;
    const reference = table === "orders" && ordersSeq ? ordersSeq.lastValue : s.lastValue;
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from "${table}"`));
    if (max !== null && Number(max) > Number(reference)) continue;
    await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
  }
}

before(async () => {
  snap = await takeSnapshot();
  const leftovers = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `${PREFIX}%`));
  assert.equal(leftovers.length, 0, "no leftovers from an earlier run");
  assert.equal(process.env.PAYMENT_SIMULATOR, "true", "PAYMENT_SIMULATOR=true must be set in .env.local");
  settings = await loadCommerceSettings();
  const rows = await db.select({ id: schema.productVariants.id, sku: schema.productVariants.sku }).from(schema.productVariants);
  for (const r of rows) variants[r.sku] = r.id;
  assert.ok(variants["PR-LVL-500"] && variants["PR-LAV-500"], "seed variants");
  const [active] = await db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.status, "active"), eq(schema.products.type, "standard"))).limit(1);
  products.active = active.id;
  const [sample] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.type, "sample")).limit(1);
  products.draftOrMissing = sample?.id ?? 99_999_999;
});

after(async () => {
  try {
    await cleanup();
    // Other agents write to the same tables meanwhile, so compare only what this file owns: none of
    // its rows remain, and the stock it took is back.
    const left = await db.execute<{ users: string; orders: string; mails: string; news: string }>(sql`
      select (select count(*) from "user" where email like ${`${PREFIX}%`} or id like ${`${PREFIX}%`})::text as users,
             (select count(*) from orders where email like ${`${PREFIX}%`})::text as orders,
             (select count(*) from email_messages where to_email like ${`${PREFIX}%`})::text as mails,
             (select count(*) from newsletter_subscribers where email like ${`${PREFIX}%`})::text as news`);
    assert.deepEqual(left[0], { users: "0", orders: "0", mails: "0", news: "0" }, "no rows of this file left");
    const ids = [variants["PR-LVL-500"], variants["PR-LAV-500"]];
    const stock = await db.select({ id: schema.productVariants.id, stock: schema.productVariants.stock }).from(schema.productVariants).where(inArray(schema.productVariants.id, ids));
    for (const row of stock) assert.equal(row.stock, snap.stock.get(row.id), `stock of variant ${row.id} restored`);
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------

describe("address book", () => {
  test("first address is the default; a new default clears the old one; delete passes the default on", async () => {
    const u = await makeUser("addr");
    const first = await db.transaction((tx) => saveAddress(tx, u.id, addressInput()));
    assert.equal(first.isDefaultShipping, true);
    assert.equal(first.isDefaultBilling, true);
    assert.equal(first.title, "Kocasinan / Kayseri", "empty title → district / province");
    assert.equal(first.data.phone, "+905321234567", "phone normalized");

    const second = await db.transaction((tx) =>
      saveAddress(tx, u.id, addressInput({ title: "İş", isDefaultShipping: "on", invoice: { type: "corporate", companyName: "Test A.Ş.", taxOffice: "Kocasinan", taxNumber: "1234567890" } })),
    );
    let list = await listAddresses(db, u.id);
    assert.equal(list.length, 2);
    assert.equal(list.find((a) => a.id === second.id)?.isDefaultShipping, true);
    assert.equal(list.find((a) => a.id === first.id)?.isDefaultShipping, false, "old shipping default cleared");
    assert.equal(list.find((a) => a.id === first.id)?.isDefaultBilling, true, "billing default unchanged");
    assert.equal(second.invoice?.type, "corporate");

    await db.transaction((tx) => setDefaultAddress(tx, u.id, second.id, "billing"));
    list = await listAddresses(db, u.id);
    assert.equal(list.filter((a) => a.isDefaultBilling).length, 1);
    assert.equal(list.find((a) => a.isDefaultBilling)?.id, second.id);

    await db.transaction((tx) => deleteAddress(tx, u.id, second.id));
    list = await listAddresses(db, u.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].isDefaultShipping, true, "default passed on");
    assert.equal(list[0].isDefaultBilling, true);
  });

  test("validation uses the checkout rules (province, mobile phone, VKN)", () => {
    const bad = addressInputSchema.safeParse({
      locale: "tr",
      address: { fullName: "A", phone: "0212 123 45 67", city: "Atlantis", district: "X", line1: "kısa" },
      invoice: { type: "corporate", companyName: "", taxOffice: "", taxNumber: "123" },
    });
    assert.equal(bad.success, false);
    const paths = new Set(bad.error!.issues.map((i) => `${i.path.join(".")}:${i.message}`));
    for (const expected of ["address.fullName:too_short", "address.phone:invalid_phone", "address.city:invalid_province", "address.line1:too_short", "invoice.taxNumber:invalid_tax_number"]) {
      assert.ok(paths.has(expected), expected);
    }
  });

  test(`at most ${MAX_ADDRESSES} addresses`, async () => {
    const u = await makeUser("addrlimit");
    await db.insert(schema.addresses).values(
      Array.from({ length: MAX_ADDRESSES }, (_, i) => ({ userId: u.id, title: `A${i}`, data: { fullName: "X Y", phone: "+905321234567", city: "Kayseri", district: "Melikgazi", line1: `Sokak ${i} No 1` } })),
    );
    await assert.rejects(db.transaction((tx) => saveAddress(tx, u.id, addressInput())), (e: unknown) => e instanceof AccountError && e.code === "limit");
  });
});

describe("IDOR: another customer's rows are not found", () => {
  test("addresses, orders and favorites of user A are invisible to user B", async () => {
    const a = await makeUser("idor-a");
    const b = await makeUser("idor-b");
    const addr = await db.transaction((tx) => saveAddress(tx, a.id, addressInput()));
    const notFound = (e: unknown) => e instanceof AccountError && e.code === "not_found";
    await assert.rejects(db.transaction((tx) => saveAddress(tx, b.id, addressInput({ id: addr.id, title: "Ele geçirildi" }))), notFound);
    await assert.rejects(db.transaction((tx) => deleteAddress(tx, b.id, addr.id)), notFound);
    await assert.rejects(db.transaction((tx) => setDefaultAddress(tx, b.id, addr.id, "shipping")), notFound);
    assert.equal((await listAddresses(db, b.id)).length, 0);
    const [still] = await db.select().from(schema.addresses).where(eq(schema.addresses.id, addr.id));
    assert.equal(still.title, addr.title, "A's address untouched");

    const order = await placeCardOrder(a.email, userCustomer(a.id));
    assert.ok(await accountOrderToken(db, a.id, order.orderNumber), "owner sees the order");
    assert.equal(await accountOrderToken(db, a.id, order.orderNumber.toLowerCase()), order.accessToken, "normalized number");
    assert.equal(await accountOrderToken(db, b.id, order.orderNumber), null, "another customer gets nothing");
    assert.equal(await accountOrderToken(db, b.id, "not-a-number"), null);
    assert.equal((await listAccountOrders(db, b.id)).total, 0);
    assert.equal((await listAccountOrders(db, a.id)).items[0]?.orderNumber, order.orderNumber);

    await db.transaction((tx) => setFavorite(tx, a.id, products.active, true));
    await db.transaction((tx) => setFavorite(tx, b.id, products.active, false)); // B "removes" A's favorite
    assert.deepEqual(await listFavoriteIds(db, a.id), [products.active], "A's favorite stays");
    assert.deepEqual(await listFavoriteIds(db, b.id), []);
  });
});

describe("favorites", () => {
  test("idempotent; only active listable products", async () => {
    const u = await makeUser("fav");
    assert.deepEqual(await db.transaction((tx) => setFavorite(tx, u.id, products.active, true)), { favorite: true });
    assert.deepEqual(await db.transaction((tx) => setFavorite(tx, u.id, products.active, true)), { favorite: true });
    assert.deepEqual(await listFavoriteIds(db, u.id), [products.active]);
    await assert.rejects(db.transaction((tx) => setFavorite(tx, u.id, products.draftOrMissing, true)), (e: unknown) => e instanceof AccountError && e.code === "not_found");
    await db.transaction((tx) => setFavorite(tx, u.id, products.active, false));
    await db.transaction((tx) => setFavorite(tx, u.id, products.active, false));
    assert.deepEqual(await listFavoriteIds(db, u.id), []);
  });
});

describe("guest orders are linked only after verification", () => {
  test("unverified: nothing linked, no mail; verified: linked + one welcome mail", async () => {
    const u = await makeUser("verify", { emailVerified: false, locale: "en" });
    const guest = await placeCardOrder(u.email.toUpperCase()); // same address, different case
    const other = await placeCardOrder(mail("someone-else"));
    const [before] = await db.select({ updatedAt: sql<string>`${schema.orders.updatedAt}::text` }).from(schema.orders).where(eq(schema.orders.id, guest.orderId));

    const notYet = await db.transaction((tx) => completeEmailVerification(tx, u.id));
    assert.deepEqual(notYet, { linkedOrders: 0, welcomeQueued: false });
    const [row0] = await db.select({ userId: schema.orders.userId }).from(schema.orders).where(eq(schema.orders.id, guest.orderId));
    assert.equal(row0.userId, null);

    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, u.id));
    const done = await db.transaction((tx) => completeEmailVerification(tx, u.id));
    assert.deepEqual(done, { linkedOrders: 1, welcomeQueued: true });
    const [row1] = await db.select({ userId: schema.orders.userId, updatedAt: sql<string>`${schema.orders.updatedAt}::text` }).from(schema.orders).where(eq(schema.orders.id, guest.orderId));
    assert.equal(row1.userId, u.id);
    assert.equal(row1.updatedAt, before.updatedAt, "linking keeps updated_at (no false panel conflicts)");
    const [otherRow] = await db.select({ userId: schema.orders.userId }).from(schema.orders).where(eq(schema.orders.id, other.orderId));
    assert.equal(otherRow.userId, null, "another address is not linked");

    const mails = await db.select().from(schema.emailMessages).where(and(eq(schema.emailMessages.toEmail, u.email), eq(schema.emailMessages.template, "welcome")));
    assert.equal(mails.length, 1);
    assert.equal(mails[0].locale, "en");
    assert.equal(mails[0].dedupeKey, `user:${u.id}:welcome`);
    assert.match(mails[0].text ?? "", /1 earlier order/);
    assert.match(mails[0].text ?? "", /\/en\/account/);

    const again = await db.transaction((tx) => completeEmailVerification(tx, u.id));
    assert.deepEqual(again, { linkedOrders: 0, welcomeQueued: false }, "welcome once per user");
    assert.equal(await db.transaction((tx) => linkGuestOrders(tx, u)), 0, "an order with a user is never re-linked");
  });

  test("password_changed is queued once per minute", async () => {
    const u = await makeUser("pwd");
    const now = new Date("2026-11-10T10:00:30Z");
    assert.equal(await db.transaction((tx) => queuePasswordChanged(tx, u.id, "change", now)), true);
    assert.equal(await db.transaction((tx) => queuePasswordChanged(tx, u.id, "change", new Date(now.getTime() + 10_000))), false, "double submit");
    const [m] = await db.select().from(schema.emailMessages).where(and(eq(schema.emailMessages.toEmail, u.email), eq(schema.emailMessages.template, "password_changed")));
    assert.match(m.subject, /Şifreniz değiştirildi/);
  });
});

describe("cart at sign-in", () => {
  test("guest cart is attached; with an older account cart the two merge (larger quantity, coupon kept)", async () => {
    const u = await makeUser("cart");
    const old = await addItem(null, { variantId: variants["PR-LVL-500"], quantity: 3 }, { customer: userCustomer(u.id), locale: "tr", settings });
    assert.ok(old.ok);
    createdCarts.add(old.cartId);
    await addItem(old.cartId, { variantId: variants["PR-LAV-500"], quantity: 1 }, { customer: userCustomer(u.id), locale: "tr", settings });
    await db.update(schema.carts).set({ couponCode: "ESKI" }).where(eq(schema.carts.id, old.cartId));

    const guest = await addItem(null, { variantId: variants["PR-LVL-500"], quantity: 1 }, { customer: RETAIL_CUSTOMER, locale: "tr", settings });
    assert.ok(guest.ok);
    createdCarts.add(guest.cartId);

    const result = await db.transaction((tx) => attachCartToUser(tx, { cartId: guest.cartId, userId: u.id }));
    assert.deepEqual(result, { cartId: guest.cartId, merged: true, changed: false });
    const lines = await db.select({ variantId: schema.cartItems.variantId, quantity: schema.cartItems.quantity }).from(schema.cartItems).where(eq(schema.cartItems.cartId, guest.cartId));
    assert.equal(lines.find((l) => l.variantId === variants["PR-LVL-500"])?.quantity, 3, "larger quantity wins");
    assert.equal(lines.find((l) => l.variantId === variants["PR-LAV-500"])?.quantity, 1, "missing line added");
    const [cart] = await db.select().from(schema.carts).where(eq(schema.carts.id, guest.cartId));
    assert.equal(cart.userId, u.id);
    assert.equal(cart.couponCode, "ESKI");
    assert.equal((await db.select().from(schema.carts).where(eq(schema.carts.id, old.cartId))).length, 0, "old cart deleted");
  });

  test("another account's cart on this browser is left alone; the user gets their own cart back", async () => {
    const a = await makeUser("cart-a");
    const b = await makeUser("cart-b");
    const aCart = await addItem(null, { variantId: variants["PR-LVL-500"], quantity: 2 }, { customer: userCustomer(a.id), locale: "tr", settings });
    const bCart = await addItem(null, { variantId: variants["PR-LAV-500"], quantity: 1 }, { customer: userCustomer(b.id), locale: "tr", settings });
    assert.ok(aCart.ok && bCart.ok);
    createdCarts.add(aCart.cartId);
    createdCarts.add(bCart.cartId);
    const r = await db.transaction((tx) => attachCartToUser(tx, { cartId: aCart.cartId, userId: b.id }));
    assert.deepEqual(r, { cartId: bCart.cartId, merged: false, changed: true });
    const [aRow] = await db.select().from(schema.carts).where(eq(schema.carts.id, aCart.cartId));
    assert.equal(aRow.userId, a.id, "A's cart unchanged");
    const c = await makeUser("cart-c");
    const none = await db.transaction((tx) => attachCartToUser(tx, { cartId: null, userId: c.id }));
    assert.deepEqual(none, { cartId: null, merged: false, changed: false });
  });
});

describe("Bu adresi kaydet", () => {
  test("stores the order's delivery address once (no duplicates)", async () => {
    const u = await makeUser("save");
    const order = await placeCardOrder(u.email, userCustomer(u.id));
    const [row] = await db.select({ shippingAddress: schema.orders.shippingAddress, invoice: schema.orders.invoice }).from(schema.orders).where(eq(schema.orders.id, order.orderId));
    const id = await db.transaction((tx) => saveAddressFromOrder(tx, u.id, row));
    assert.ok(id);
    assert.equal(await db.transaction((tx) => saveAddressFromOrder(tx, u.id, row)), null, "same address again → nothing");
    const [saved] = await listAddresses(db, u.id);
    assert.equal(saved.data.fullName, "Ayşe Test");
    assert.equal(saved.data.phone, "+905321234567");
    assert.equal(saved.isDefaultShipping, true);
    assert.deepEqual(saved.invoice, { type: "individual" });
  });
});

describe("account deletion (anonymization, orders kept)", () => {
  test("personal data, addresses, favorites, sessions and the password go; orders stay", async () => {
    const u = await makeUser("delete", { phone: "+905321234567", marketingConsent: true });
    await db.insert(schema.session).values({ id: `${u.id}-s`, token: `${u.id}-t`, userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) });
    await db.insert(schema.account).values({ id: `${u.id}-a`, accountId: u.id, providerId: "credential", userId: u.id, password: "hash" });
    await db.insert(schema.verification).values({ id: `${u.id}-v`, identifier: "reset-password:x", value: u.id, expiresAt: new Date(Date.now() + 3_600_000) });
    await db.transaction((tx) => saveAddress(tx, u.id, addressInput()));
    await db.transaction((tx) => setFavorite(tx, u.id, products.active, true));
    const order = await placeCardOrder(u.email, userCustomer(u.id));
    const [plan] = await db.select({ id: schema.subscriptionPlans.id }).from(schema.subscriptionPlans).limit(1);
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({ userId: u.id, planId: plan.id, items: [{ variantId: variants["PR-LVL-500"], quantity: 1 }], shippingAddress: { fullName: "Ayşe Test", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test 1" }, invoice: { type: "individual" }, nextRunAt: new Date(Date.now() + 86_400_000 * 30), email: u.email, paymentMethod: "bank_transfer" })
      .returning({ id: schema.subscriptions.id });
    await db.insert(schema.newsletterSubscribers).values({ email: u.email, status: "active", unsubscribeToken: randomUUID() });
    const cart = await addItem(null, { variantId: variants["PR-LAV-500"], quantity: 1 }, { customer: userCustomer(u.id), locale: "tr", settings });
    assert.ok(cart.ok);
    createdCarts.add(cart.cartId);

    const result = await db.transaction((tx) => anonymizeAccount(tx, u.id, { actorId: u.id }));
    assert.equal(result.keptOrders, 1);
    assert.equal(result.deletedAddresses, 1);
    assert.equal(result.deletedFavorites, 1);
    assert.equal(result.cancelledSubscriptions, 1);
    assert.equal(result.revokedSessions, 1);
    assert.equal(result.deletedCarts, 1);
    assert.equal(result.unsubscribedNewsletter, 1);
    assert.equal(result.audit.entity, "user");
    assert.equal(JSON.stringify(result.audit).includes(u.email), false, "no personal data in the audit entry");

    const [user] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
    assert.equal(user.name, ANONYMIZED_NAME);
    assert.equal(user.email, anonymizedEmail(u.id));
    assert.ok(isAnonymizedEmail(user.email));
    assert.equal(user.phone, null);
    assert.equal(user.marketingConsent, false);
    assert.equal(user.emailVerified, false);
    assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, u.id))).length, 0);
    assert.equal((await db.select().from(schema.account).where(eq(schema.account.userId, u.id))).length, 0, "no password: no sign-in");
    assert.equal((await db.select().from(schema.verification).where(eq(schema.verification.value, u.id))).length, 0);
    assert.equal((await listAddresses(db, u.id)).length, 0);
    assert.deepEqual(await listFavoriteIds(db, u.id), []);
    const [subRow] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id));
    assert.equal(subRow.status, "cancelled");
    const [news] = await db.select().from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.email, u.email));
    assert.equal(news.status, "unsubscribed");
    const [orderRow] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.orderId));
    assert.equal(orderRow.userId, u.id, "order kept and still linked");
    assert.equal(orderRow.email, u.email, "the order keeps its own data (legal retention)");

    await assert.rejects(db.transaction((tx) => anonymizeAccount(tx, u.id, { actorId: u.id })), (e: unknown) => e instanceof AccountError && e.code === "not_found");
    const staff = await makeUser("staff", { role: "editor" });
    await assert.rejects(db.transaction((tx) => anonymizeAccount(tx, staff.id, { actorId: null })), (e: unknown) => e instanceof AccountError && e.code === "forbidden");
  });

  test("withdrawing marketing consent unsubscribes the address", async () => {
    const u = await makeUser("mkt", { marketingConsent: true });
    await db.insert(schema.newsletterSubscribers).values({ email: u.email, status: "pending", unsubscribeToken: randomUUID() });
    assert.equal(await marketingState(db, { email: u.email, marketingConsent: true }), "pending");
    await db.transaction((tx) => withdrawMarketingConsent(tx, u));
    assert.equal(await marketingState(db, { email: u.email, marketingConsent: false }), "off");
    const [user] = await db.select({ marketingConsent: schema.user.marketingConsent }).from(schema.user).where(eq(schema.user.id, u.id));
    assert.equal(user.marketingConsent, false);
  });
});
