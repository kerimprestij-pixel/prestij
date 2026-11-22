// Day 6 WHEEL-SERVER against the local PostgreSQL: the gift wheel services end to end.
//   - spins: the server-side pick and the prize snapshot; a held spin comes back (idempotent), never a
//     re-spin; one spin per visitor per round; the hold;
//   - every eligibility rule with DB facts (off, schedule, staff, approved business, counted orders by
//     user id or e-mail, banned), and the audience enforced again when a guest's spin is claimed;
//   - one prize per account per round (unique index), a new round makes the account eligible again;
//   - cross-device: the spin is bound at sign-up (cookie spin id) and the prize is issued at
//     completeEmailVerification WITHOUT any cookie; an existing e-mail's sign-up never binds;
//   - sign-in claim + auto-apply (never over a typed code), the per-IP claim limit, issue idempotency and
//     code-collision retry, the wheel_prize / wheel_prize_reminder mails, purge, anonymize, cookie token.
// Every write happens inside a transaction that is rolled back (users …@test.local with ids
// day6-test-wserver-…, codes DAY6TEST… or CARK-… only inside the rollback); the id sequences those
// writes advance are put back, and the touched tables are compared before and after.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-wheel-server-flow.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { completeEmailVerification } from "@/lib/account/events";
import { anonymizeAccount } from "@/lib/account/service";
import { loadCommerceSettings } from "@/lib/cart/settings";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { parseWheelSpinToken, wheelCookieTtlSeconds, wheelSpinToken } from "@/lib/wheel/cookie";
import { purgeWheelSpins, queueWheelReminders } from "@/lib/wheel/maintenance";
import { getBestWheelCode } from "@/lib/wheel/prize-coupons";
import {
  autoApplyWheelPrize,
  bindSpin,
  bindSpinAtRegistration,
  bindSpinToAccount,
  claimSpinForAccount,
  createSpin,
  hashWheelIp,
  heldSliceIndex,
  issueBoundPrizes,
  issueSpinPrize,
  loadWheelAccount,
  readWheelConfig,
  resolveWheelVisitor,
  wheelSignInEffects,
  type WheelConfig,
  type WheelSpinRow,
} from "@/lib/wheel/service";
import { GIFT_WHEEL_DEFAULT_SLICES, WHEEL_CODE_PATTERN, type GiftWheelSettings } from "@/lib/wheel/types";

const RUN = randomBytes(3).toString("hex");
const ID = (tag: string) => `day6-test-wserver-${tag}-${RUN}`;
const EMAIL = (tag: string) => `${ID(tag)}@test.local`;
const CODE = (tag: string) => `DAY6TEST-WS-${RUN}-${tag}`.toUpperCase();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** randomInt → 35 lands on slice 1 of the default slices ("indirim-10": 10 %, no minimum). */
const TEN = () => 35;
const allow = async () => true;

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
/** Sequences advanced by the rolled-back writes below (nextval is not transactional). */
const SEQUENCES = [
  "coupons_id_seq",
  "wheel_spins_id_seq",
  "email_messages_id_seq",
  "cart_items_id_seq",
  "newsletter_subscribers_id_seq",
  "companies_id_seq",
  "orders_id_seq",
] as const;
/** Tables compared before/after (written here only inside rollbacks; the live site does not write them while browsing). */
const SNAPSHOT_TABLES = ["coupons", "wheel_spins", "settings", "companies", "newsletter_subscribers"] as const;
const seqBefore = new Map<string, Seq>();
const tablesBefore = new Map<string, string>();
const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const tableHash = async (table: string): Promise<string> => {
  const [row] = await db.execute<{ h: string }>(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`));
  return row.h;
};

let variant: { id: number; price: number };

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
  const settings = await loadCommerceSettings();
  const [row] = await db.execute<{ id: number; price: number }>(
    sql`select v.id, v.price from product_variants v join products p on p.id = v.product_id
        where p.status = 'active' and p.type = 'standard' and not p.business_only and v.is_active
          and v.price > 0 and v.price < ${settings.shipping.freeThreshold} and (not v.track_stock or v.allow_backorder or v.stock >= 50)
        order by v.price, v.id limit 1`,
  );
  assert.ok(row, "a buyable standard variant below the free-shipping threshold");
  variant = { id: Number(row.id), price: Number(row.price) };
});

after(async () => {
  try {
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      }
      assert.deepEqual(await readSeq(name), seq, `${name} restored`);
    }
    for (const t of SNAPSHOT_TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
    const [own] = await db.execute<{ users: string; carts: string; coupons: string; mails: string }>(
      sql`select (select count(*) from "user" where id like ${"day6-test-wserver-%"})::text as users,
                 (select count(*) from carts where user_id like ${"day6-test-wserver-%"})::text as carts,
                 (select count(*) from coupons where user_id like ${"day6-test-wserver-%"} or code like ${"DAY6TEST-WS-%"})::text as coupons,
                 (select count(*) from email_messages where to_email like ${"day6-test-wserver-%"})::text as mails`,
    );
    assert.deepEqual({ ...own }, { users: "0", carts: "0", coupons: "0", mails: "0" }, "no test rows left");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------
// Helpers (all inside the test's transaction)

async function setWheel(tx: Tx, over: Partial<GiftWheelSettings> = {}): Promise<WheelConfig> {
  const value = { ...parseSettings("giftWheel", { enabled: true }), enabled: true, round: 1, holdDays: 7, validityHours: 72, audience: "new_customers", showToBusiness: false, ...over };
  await tx.insert(schema.settings).values({ key: "giftWheel", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  return readWheelConfig(tx);
}

async function makeUser(tx: Tx, tag: string, over: Partial<typeof schema.user.$inferInsert> = {}): Promise<{ id: string; email: string }> {
  const id = ID(tag);
  const email = EMAIL(tag);
  await tx.insert(schema.user).values({ id, name: `Deniz ${tag}`, email, emailVerified: true, locale: "tr", ...over });
  return { id, email };
}

async function makeCart(tx: Tx, userId: string | null, couponCode: string | null = null): Promise<string> {
  const [cart] = await tx.insert(schema.carts).values({ userId, locale: "tr", couponCode, expiresAt: new Date(Date.now() + DAY) }).returning({ id: schema.carts.id });
  await tx.insert(schema.cartItems).values({ cartId: cart.id, variantId: variant.id, quantity: 1 });
  return cart.id;
}

async function guestSpin(tx: Tx, config: WheelConfig, now = new Date(), randomInt = TEN): Promise<WheelSpinRow> {
  const r = await createSpin(tx, { config, account: null, locale: "tr", ipHash: hashWheelIp("203.0.113.7"), pagePath: "/urunler/lavanta", now, randomInt });
  assert.ok(r.ok);
  return r.spin;
}

const spinRow = async (tx: Tx, id: number) => (await tx.select().from(schema.wheelSpins).where(eq(schema.wheelSpins.id, id)))[0];
const cartCode = async (tx: Tx, cartId: string) => (await tx.select({ code: schema.carts.couponCode }).from(schema.carts).where(eq(schema.carts.id, cartId)))[0].code;
const mailsTo = (tx: Tx, email: string) =>
  tx.select({ template: schema.emailMessages.template, subject: schema.emailMessages.subject, text: schema.emailMessages.text, locale: schema.emailMessages.locale, headers: schema.emailMessages.headers }).from(schema.emailMessages).where(eq(schema.emailMessages.toEmail, email));

async function paidOrder(tx: Tx, email: string, status: "paid" | "cancelled" = "paid", userId: string | null = null): Promise<void> {
  await tx.insert(schema.orders).values({
    orderNumber: CODE(`O${randomBytes(2).toString("hex")}`),
    email,
    userId,
    status,
    paymentMethod: "bank_transfer",
    subtotal: 10000,
    grandTotal: 10000,
    shippingAddress: { fullName: "Deniz Test", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test 1" },
    invoice: { type: "individual" },
  });
}

// ---------------------------------------------------------------------------------------------------

describe("spins", () => {
  test("the server picks the slice and stores a prize snapshot (no weight), a guest spin is unbound", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const now = new Date();
      const r = await createSpin(tx, { config, account: null, locale: "en", ipHash: hashWheelIp("203.0.113.7"), pagePath: "/urunler/lavanta", now, randomInt: () => 99 });
      assert.ok(r.ok);
      assert.equal(r.sliceIndex, 5, "roll 99 of 100 → the last slice");
      const row = r.spin;
      assert.equal(row.sliceKey, "indirim-20");
      // FIX COR-2: the hold end is frozen with the prize (spin time + holdDays of then).
      assert.deepEqual(row.prize, {
        type: "percent",
        value: 20,
        label: { ...GIFT_WHEEL_DEFAULT_SLICES[5].label },
        minOrderTotal: 75000,
        holdUntil: new Date(now.getTime() + 7 * DAY).toISOString(),
      });
      assert.equal(row.status, "spun");
      assert.equal(row.userId, null);
      assert.equal(row.boundVia, null);
      assert.equal(row.round, 1);
      assert.equal(row.locale, "en");
      assert.equal(row.pagePath, "/urunler/lavanta");
      assert.match(row.ipHash ?? "", /^[0-9a-f]{40}$/);
      assert.ok(!JSON.stringify(row).includes("203.0.113.7"), "never the IP itself");
      assert.equal(heldSliceIndex(row, config.wheel), 5);
      assert.equal(heldSliceIndex(row, { slices: config.wheel.slices.slice(0, 5) }), -1, "a removed slice → -1");
    });
  });

  test("idempotent: a held spin comes back for its visitor; after the hold a new spin is allowed", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const now = new Date();
      const spin = await guestSpin(tx, config, now);
      for (let i = 0; i < 2; i++) {
        const v = await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: spin.id, now });
        assert.equal(v.reason, "eligible");
        assert.equal(v.held?.id, spin.id, "the same spin, never a re-spin");
      }
      const later = new Date(now.getTime() + 7 * DAY + 1000);
      const v = await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: spin.id, now: later });
      assert.deepEqual([v.reason, v.held], ["eligible", null], "hold over: may spin again");
      assert.equal(await bindSpin(tx, { spinId: spin.id, userId: ID("x"), via: "sign_in", config, now: later }), "expired");
      assert.equal((await spinRow(tx, spin.id)).status, "expired", "marked lazily");
    });
  });

  test("one spin per visitor: a claimed cookie spin of this round refuses a guest; a new round lets them spin", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const a = await makeUser(tx, "visitor");
      const spin = await guestSpin(tx, config);
      const claim = await claimSpinForAccount(tx, { userId: a.id, cookieSpinId: spin.id, via: "signed_in", config, now: new Date() });
      assert.ok(claim.ok);
      const guest = await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: spin.id, now: new Date() });
      assert.equal(guest.reason, "already_claimed");
      const round2 = await setWheel(tx, { round: 2 });
      assert.equal((await resolveWheelVisitor(tx, { config: round2, userId: null, cookieSpinId: spin.id, now: new Date() })).reason, "eligible");
    });
  });

  test("cookie token: signed spin id, expires with the hold, tampering refused; IP hash keyed and stable", () => {
    const token = wheelSpinToken(4242, 3600);
    assert.equal(parseWheelSpinToken(token), 4242);
    assert.equal(parseWheelSpinToken(`${token.slice(0, -2)}xx`), null);
    assert.equal(parseWheelSpinToken("v1.e30.abc"), null);
    assert.equal(parseWheelSpinToken(undefined), null);
    assert.equal(wheelCookieTtlSeconds(new Date(Date.now() + 2 * DAY), new Date()), 2 * 86400);
    assert.equal(wheelCookieTtlSeconds(new Date(Date.now() - DAY), new Date()), 60, "never a dead cookie");
    assert.equal(hashWheelIp("203.0.113.7"), hashWheelIp(" 203.0.113.7 "));
    assert.notEqual(hashWheelIp("203.0.113.7"), hashWheelIp("203.0.113.8"));
    assert.equal(hashWheelIp(""), null);
  });
});

describe("eligibility with database facts", () => {
  test("off, schedule, staff, banned", async () => {
    await inRollback(async (tx) => {
      const staff = await makeUser(tx, "staff", { role: "editor" });
      const banned = await makeUser(tx, "banned", { banned: true });
      const now = new Date();
      let config = await setWheel(tx, { enabled: false });
      assert.equal((await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: null, now })).reason, "disabled");
      config = await setWheel(tx, { startsAt: new Date(now.getTime() + DAY).toISOString() });
      assert.equal((await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: null, now })).reason, "not_started");
      config = await setWheel(tx);
      const held = await guestSpin(tx, config, now);
      config = await setWheel(tx, { endsAt: new Date(now.getTime() - 1000).toISOString() });
      assert.equal((await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: null, now })).reason, "ended");
      const v = await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: held.id, now });
      assert.deepEqual([v.reason, v.held?.id], ["eligible", held.id], "a spin held from the campaign stays claimable after it ended");
      config = await setWheel(tx);
      assert.equal((await resolveWheelVisitor(tx, { config, userId: staff.id, cookieSpinId: held.id, now })).reason, "staff");
      const refused = await claimSpinForAccount(tx, { userId: staff.id, cookieSpinId: held.id, via: "signed_in", config, now });
      assert.deepEqual(refused, { ok: false, error: "staff" });
      assert.equal(await bindSpinToAccount(tx, { spinId: held.id, userId: staff.id, via: "sign_in", now }), "not_eligible");
      assert.equal((await resolveWheelVisitor(tx, { config, userId: banned.id, cookieSpinId: null, now })).reason, "unavailable");
      assert.equal((await spinRow(tx, held.id)).status, "spun", "refusals never touch the spin");
    });
  });

  test("approved business customers only with showToBusiness", async () => {
    await inRollback(async (tx) => {
      const [company] = await tx.insert(schema.companies).values({ name: `${ID("co")}`, status: "approved" }).returning({ id: schema.companies.id });
      const biz = await makeUser(tx, "biz", { companyId: company.id });
      const now = new Date();
      let config = await setWheel(tx);
      assert.equal((await loadWheelAccount(tx, biz.id))?.business, true);
      assert.equal((await resolveWheelVisitor(tx, { config, userId: biz.id, cookieSpinId: null, now })).reason, "business");
      config = await setWheel(tx, { showToBusiness: true });
      assert.equal((await resolveWheelVisitor(tx, { config, userId: biz.id, cookieSpinId: null, now })).reason, "eligible");
      await tx.update(schema.companies).set({ status: "pending" }).where(eq(schema.companies.id, company.id));
      config = await setWheel(tx);
      assert.equal((await resolveWheelVisitor(tx, { config, userId: biz.id, cookieSpinId: null, now })).reason, "eligible", "a pending application is not a business customer");
    });
  });

  test("new customers only: a counted order by user id or by e-mail (any case); cancelled orders do not count; 'everyone' ignores orders", async () => {
    await inRollback(async (tx) => {
      const byEmail = await makeUser(tx, "ordered-mail");
      const byId = await makeUser(tx, "ordered-id");
      const cancelled = await makeUser(tx, "cancelled");
      await paidOrder(tx, byEmail.email.toUpperCase());
      await paidOrder(tx, `other-${RUN}@test.local`, "paid", byId.id);
      await paidOrder(tx, cancelled.email, "cancelled");
      const now = new Date();
      let config = await setWheel(tx);
      assert.equal((await resolveWheelVisitor(tx, { config, userId: byEmail.id, cookieSpinId: null, now })).reason, "has_ordered");
      assert.equal((await resolveWheelVisitor(tx, { config, userId: byId.id, cookieSpinId: null, now })).reason, "has_ordered");
      assert.equal((await resolveWheelVisitor(tx, { config, userId: cancelled.id, cookieSpinId: null, now })).reason, "eligible");
      config = await setWheel(tx, { audience: "everyone" });
      assert.equal((await resolveWheelVisitor(tx, { config, userId: byEmail.id, cookieSpinId: null, now })).reason, "eligible");
    });
  });
});

describe("one prize per account per round", () => {
  test("a signed-in spin is bound at once, claimed once; a second spin in the round is refused; a new round re-opens", async () => {
    await inRollback(async (tx) => {
      let config = await setWheel(tx);
      const a = await makeUser(tx, "round");
      const now = new Date();
      const first = await createSpin(tx, { config, account: { id: a.id }, locale: "tr", ipHash: null, pagePath: null, now, randomInt: TEN });
      assert.ok(first.ok);
      assert.deepEqual([first.spin.status, first.spin.userId, first.spin.boundVia], ["bound", a.id, "signed_in"]);
      const again = await createSpin(tx, { config, account: { id: a.id }, locale: "tr", ipHash: null, pagePath: null, now, randomInt: () => 0 });
      assert.deepEqual(again, { ok: false, reason: "already_bound" }, "the unique index refuses a second bound spin");
      const visitor = await resolveWheelVisitor(tx, { config, userId: a.id, cookieSpinId: null, now });
      assert.equal(visitor.held?.id, first.spin.id, "the account's own spin, on any device");

      const claim = await claimSpinForAccount(tx, { userId: a.id, cookieSpinId: null, via: "signed_in", config, now });
      assert.ok(claim.ok);
      assert.equal((await resolveWheelVisitor(tx, { config, userId: a.id, cookieSpinId: null, now })).reason, "already_claimed");
      const third = await createSpin(tx, { config, account: { id: a.id }, locale: "tr", ipHash: null, pagePath: null, now, randomInt: TEN });
      assert.equal(third.ok, false);
      // A guest spin from another browser cannot become a second prize this round either.
      const guest = await guestSpin(tx, config, now);
      assert.deepEqual(await claimSpinForAccount(tx, { userId: a.id, cookieSpinId: guest.id, via: "signed_in", config, now }), { ok: false, error: "already_claimed" });
      assert.equal(await bindSpin(tx, { spinId: guest.id, userId: a.id, via: "sign_in", config, now }), "already_claimed");
      assert.equal((await spinRow(tx, guest.id)).status, "spun");

      config = await setWheel(tx, { round: 2 });
      assert.equal((await resolveWheelVisitor(tx, { config, userId: a.id, cookieSpinId: null, now })).reason, "eligible");
      assert.ok((await createSpin(tx, { config, account: { id: a.id }, locale: "tr", ipHash: null, pagePath: null, now, randomInt: TEN })).ok);
    });
  });

  test("an unclaimed bound spin whose hold ran out never blocks the account's next spin or bind", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const a = await makeUser(tx, "stale");
      const now = new Date();
      const old = await createSpin(tx, { config, account: { id: a.id }, locale: "tr", ipHash: null, pagePath: null, now: new Date(now.getTime() - 8 * DAY), randomInt: TEN });
      assert.ok(old.ok);
      assert.equal((await resolveWheelVisitor(tx, { config, userId: a.id, cookieSpinId: null, now })).held, null, "not held any more");
      const fresh = await createSpin(tx, { config, account: { id: a.id }, locale: "tr", ipHash: null, pagePath: null, now, randomInt: TEN });
      assert.ok(fresh.ok, "the stale row was expired first");
      assert.equal((await spinRow(tx, old.spin.id)).status, "expired");
      // The same for a bind (sign-in with a guest spin while an old bound row lingers).
      const b = await makeUser(tx, "stale-bind");
      await createSpin(tx, { config, account: { id: b.id }, locale: "tr", ipHash: null, pagePath: null, now: new Date(now.getTime() - 8 * DAY), randomInt: TEN });
      const guest = await guestSpin(tx, config, now);
      assert.equal(await bindSpin(tx, { spinId: guest.id, userId: b.id, via: "sign_in", config, now }), "bound");
    });
  });

  test("issue: coupon row as specified, idempotent (one mail), a taken code is retried", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx, { validityHours: 48 });
      const a = await makeUser(tx, "issue", { locale: "en" });
      const now = new Date();
      // Occupy CARK-AAAAAA so the first generated code collides.
      await tx.insert(schema.coupons).values({ code: "CARK-AAAAAA", type: "percent", value: 5, source: "wheel", userId: a.id, isActive: false });
      const spin = (await createSpin(tx, { config, account: { id: a.id }, locale: "en", ipHash: null, pagePath: null, now, randomInt: () => 99 })) as { ok: true; spin: WheelSpinRow };
      const account = (await loadWheelAccount(tx, a.id))!;
      let calls = 0;
      const rng = () => (calls++ < 6 ? 0 : 1); // CARK-AAAAAA (taken), then CARK-BBBBBB
      const issued = await issueSpinPrize(tx, { spinId: spin.spin.id, account, config, now, randomInt: rng });
      assert.ok(issued);
      assert.equal(issued.code, "CARK-BBBBBB");
      assert.equal(issued.created, true);
      const [coupon] = await tx.select().from(schema.coupons).where(eq(schema.coupons.id, issued.couponId));
      assert.equal(coupon.source, "wheel");
      assert.equal(coupon.userId, a.id);
      assert.deepEqual([coupon.type, coupon.value, coupon.minOrderTotal], ["percent", 20, 75000]);
      assert.deepEqual([coupon.maxUses, coupon.usedCount, coupon.perCustomerLimit, coupon.isActive], [1, 0, 1, true]);
      assert.deepEqual([coupon.productIds, coupon.categoryIds, coupon.customerGroupIds], [null, null, null], "unscoped");
      assert.equal(coupon.startsAt?.getTime(), now.getTime());
      assert.equal(coupon.endsAt!.getTime() - coupon.startsAt!.getTime(), 48 * HOUR, "valid validityHours from the claim");
      assert.equal(coupon.description, "Hediye çarkı · %20 indirim · 1. tur");
      const row = await spinRow(tx, spin.spin.id);
      assert.deepEqual([row.status, row.couponId], ["claimed", coupon.id]);
      assert.equal(row.claimedAt?.getTime(), now.getTime());

      const twice = await issueSpinPrize(tx, { spinId: spin.spin.id, account, config, now });
      assert.deepEqual(twice && [twice.code, twice.created], ["CARK-BBBBBB", false], "a double click gets the same prize");
      const mails = (await mailsTo(tx, a.email)).filter((m) => m.template === "wheel_prize");
      assert.equal(mails.length, 1, "one prize mail");
      assert.equal(mails[0].locale, "en");
      assert.equal(mails[0].subject, "Your gift wheel prize is in your account: 20% off");
      assert.ok(mails[0].text.includes("CARK-BBBBBB"));
      assert.equal(await getBestWheelCode(tx, a.id, now), "CARK-BBBBBB");
    });
  });
});

describe("claim paths", () => {
  test("cross-device: bound at sign-up with the cookie spin, issued at verification without any cookie, auto-applied after sign-in", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      // Device A (laptop): a guest spins; the cookie holds the spin id.
      const spin = await guestSpin(tx, config);
      // Device A: signs up (new, unverified account) → registerAction binds the cookie spin.
      const u = await makeUser(tx, "crossdevice", { emailVerified: false, locale: "en" });
      let limiterCalls = 0;
      const bound = await bindSpinAtRegistration(tx, { existedBefore: false, spinId: spin.id, userId: u.id, consumeClaimLimit: async () => (limiterCalls++, true) });
      assert.equal(bound, "bound");
      assert.equal(limiterCalls, 1, "the per-IP claim limit counts the bind");
      let row = await spinRow(tx, spin.id);
      assert.deepEqual([row.status, row.userId, row.boundVia], ["bound", u.id, "register"]);
      assert.deepEqual(await issueBoundPrizes(tx, u.id), [], "nothing before the address is verified");

      // Device B (phone): opens the mail link. Only the user id travels: no cookie, no spin id.
      await tx.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, u.id));
      const result = await completeEmailVerification(tx, u.id);
      assert.deepEqual(result, { linkedOrders: 0, welcomeQueued: true, wheelPrizes: 1 });
      row = await spinRow(tx, spin.id);
      assert.equal(row.status, "claimed");
      const [coupon] = await tx.select().from(schema.coupons).where(eq(schema.coupons.id, row.couponId!));
      assert.match(coupon.code, WHEEL_CODE_PATTERN);
      assert.deepEqual([coupon.userId, coupon.source, coupon.value], [u.id, "wheel", 10]);
      const mails = await mailsTo(tx, u.email);
      assert.deepEqual(mails.map((m) => m.template).sort(), ["welcome", "wheel_prize"]);
      assert.ok(mails.find((m) => m.template === "wheel_prize")!.text.includes(coupon.code));
      assert.deepEqual(await completeEmailVerification(tx, u.id), { linkedOrders: 0, welcomeQueued: false }, "a second verification issues nothing");

      // Device B: the automatic sign-in attaches this browser's cart → the prize goes onto it.
      const cartId = await makeCart(tx, u.id);
      const effects = await wheelSignInEffects(tx, { userId: u.id, cartId, cookieSpinId: null, now: new Date() });
      assert.deepEqual(effects, { claimed: false, applied: true, clearCookie: false });
      assert.equal(await cartCode(tx, cartId), coupon.code);
      // Device A later signs in with the old cookie: nothing new, the cookie can go.
      const laptop = await wheelSignInEffects(tx, { userId: u.id, cartId: null, cookieSpinId: spin.id, now: new Date() });
      assert.deepEqual(laptop, { claimed: false, applied: false, clearCookie: true });
    });
  });

  test("an existing e-mail's sign-up never binds (and a 'register' bind refuses any older or verified account)", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const spin = await guestSpin(tx, config);
      const existing = await makeUser(tx, "existing", { createdAt: new Date(Date.now() - 30 * DAY) });
      assert.equal(await bindSpinAtRegistration(tx, { existedBefore: true, spinId: spin.id, userId: existing.id, consumeClaimLimit: allow }), null);
      assert.equal(await bindSpinAtRegistration(tx, { existedBefore: false, spinId: spin.id, userId: existing.id, consumeClaimLimit: allow }), "not_eligible", "defence in depth");
      const fresh = await makeUser(tx, "fresh-verified");
      assert.equal(await bindSpinAtRegistration(tx, { existedBefore: false, spinId: spin.id, userId: fresh.id }), "not_eligible", "verified already: not this sign-up");
      const row = await spinRow(tx, spin.id);
      assert.deepEqual([row.status, row.userId], ["spun", null]);
    });
  });

  test("the audience is enforced again at verification: a guest buyer's new account gets no prize", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const spin = await guestSpin(tx, config);
      const u = await makeUser(tx, "guestbuyer", { emailVerified: false });
      await paidOrder(tx, u.email);
      // has_ordered by e-mail already blocks the bind at sign-up …
      assert.equal(await bindSpinAtRegistration(tx, { existedBefore: false, spinId: spin.id, userId: u.id }), "not_eligible");
      // … and a spin bound before the order (or by an older rule) is not issued at verification either.
      await tx.update(schema.wheelSpins).set({ status: "bound", userId: u.id, boundVia: "register", boundAt: new Date() }).where(eq(schema.wheelSpins.id, spin.id));
      await tx.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, u.id));
      const result = await completeEmailVerification(tx, u.id);
      assert.deepEqual(result, { linkedOrders: 1, welcomeQueued: true });
      assert.equal((await spinRow(tx, spin.id)).couponId, null);
    });
  });

  test("unverified sign-in binds only; the prize waits for the verification", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const spin = await guestSpin(tx, config);
      const u = await makeUser(tx, "unverified", { emailVerified: false, createdAt: new Date(Date.now() - 10 * DAY) });
      assert.equal(await bindSpinToAccount(tx, { spinId: spin.id, userId: u.id, via: "sign_in", consumeClaimLimit: allow }), "bound");
      const row = await spinRow(tx, spin.id);
      assert.deepEqual([row.status, row.boundVia, row.couponId], ["bound", "sign_in", null]);
      await tx.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, u.id));
      assert.equal((await completeEmailVerification(tx, u.id)).wheelPrizes, 1);
    });
  });

  test("sign-in claim: issued, auto-applied, cookie cleared; a typed code is never overwritten; the claim limit refuses", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const now = new Date();
      // 1. An existing customer signs in holding a guest spin.
      const a = await makeUser(tx, "signin");
      const cartA = await makeCart(tx, a.id);
      const spinA = await guestSpin(tx, config, now);
      let calls = 0;
      const effects = await wheelSignInEffects(tx, { userId: a.id, cartId: cartA, cookieSpinId: spinA.id, now, consumeClaimLimit: async () => (calls++, true) });
      assert.deepEqual(effects, { claimed: true, applied: true, clearCookie: true });
      assert.equal(calls, 1);
      const rowA = await spinRow(tx, spinA.id);
      assert.deepEqual([rowA.status, rowA.boundVia, rowA.userId], ["claimed", "sign_in", a.id]);
      const [couponA] = await tx.select({ code: schema.coupons.code }).from(schema.coupons).where(eq(schema.coupons.id, rowA.couponId!));
      assert.equal(await cartCode(tx, cartA), couponA.code);
      assert.deepEqual(await wheelSignInEffects(tx, { userId: a.id, cartId: cartA, cookieSpinId: spinA.id, now, consumeClaimLimit: allow }), { claimed: false, applied: false, clearCookie: true }, "a second sign-in changes nothing");

      // 2. A cart with a code the buyer typed keeps it; the prize is kept for later.
      const b = await makeUser(tx, "typed");
      const typed = CODE("TYPED");
      await tx.insert(schema.coupons).values({ code: typed, type: "percent", value: 5 });
      const cartB = await makeCart(tx, b.id, typed);
      const spinB = await guestSpin(tx, config, now);
      const kept = await wheelSignInEffects(tx, { userId: b.id, cartId: cartB, cookieSpinId: spinB.id, now });
      assert.deepEqual(kept, { claimed: true, applied: false, clearCookie: true });
      assert.equal(await cartCode(tx, cartB), typed, "never overwrite a typed code");

      // 3. The per-IP claim limit.
      const c = await makeUser(tx, "limited");
      const spinC = await guestSpin(tx, config, now);
      assert.deepEqual(await claimSpinForAccount(tx, { userId: c.id, cookieSpinId: spinC.id, via: "sign_in", config, now, consumeClaimLimit: async () => false }), { ok: false, error: "claim_limit" });
      assert.deepEqual([(await spinRow(tx, spinC.id)).status, (await spinRow(tx, spinC.id)).userId], ["spun", null]);
      assert.equal(await bindSpinToAccount(tx, { spinId: spinC.id, userId: c.id, via: "sign_in", consumeClaimLimit: async () => false }), "limited");

      // 4. Never onto someone else's cart (or a guest cart).
      const foreign = await makeCart(tx, b.id);
      assert.equal(await autoApplyWheelPrize(tx, { userId: a.id, cartId: foreign, now }), null);
      assert.equal(await autoApplyWheelPrize(tx, { userId: a.id, cartId: await makeCart(tx, null), now }), null);
      // A spin bound to another account (shared browser) is left alone.
      assert.equal(await bindSpin(tx, { spinId: spinA.id, userId: c.id, via: "sign_in", config, now }), "taken");
    });
  });
});

describe("maintenance", () => {
  test("purge: over-hold spins expire, unclaimed spins older than 30 days go, old claimed spins lose the IP hash", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const now = new Date();
      const u = await makeUser(tx, "purge");
      const winner = await makeUser(tx, "purge-winner");
      const fresh = await guestSpin(tx, config, new Date(now.getTime() - DAY));
      const overHold = await guestSpin(tx, config, new Date(now.getTime() - 8 * DAY));
      const old = await guestSpin(tx, config, new Date(now.getTime() - 31 * DAY));
      const oldBound = await guestSpin(tx, config, new Date(now.getTime() - 40 * DAY));
      await tx.update(schema.wheelSpins).set({ status: "bound", userId: u.id, boundVia: "register" }).where(eq(schema.wheelSpins.id, oldBound.id));
      const claimed = await guestSpin(tx, config, new Date(now.getTime() - 35 * DAY));
      const [coupon] = await tx.insert(schema.coupons).values({ code: CODE("PURGE"), type: "percent", value: 10, source: "wheel", userId: winner.id }).returning({ id: schema.coupons.id });
      await tx.update(schema.wheelSpins).set({ status: "claimed", userId: winner.id, couponId: coupon.id }).where(eq(schema.wheelSpins.id, claimed.id));
      const spinIds = [fresh.id, overHold.id, old.id, oldBound.id, claimed.id];

      const result = await purgeWheelSpins(tx, { now, spinIds });
      assert.deepEqual(result, { expired: 3, purged: 2, anonymized: 1 });
      const left = await tx.select({ id: schema.wheelSpins.id, status: schema.wheelSpins.status, ipHash: schema.wheelSpins.ipHash }).from(schema.wheelSpins).where(inArray(schema.wheelSpins.id, spinIds));
      const byId = new Map(left.map((r) => [r.id, r]));
      assert.equal(byId.get(fresh.id)?.status, "spun");
      assert.equal(byId.get(overHold.id)?.status, "expired");
      assert.ok(!byId.has(old.id) && !byId.has(oldBound.id), "unclaimed spins older than 30 days are gone");
      assert.deepEqual([byId.get(claimed.id)?.status, byId.get(claimed.id)?.ipHash], ["claimed", null]);
      assert.deepEqual(await purgeWheelSpins(tx, { now, spinIds }), { expired: 0, purged: 0, anonymized: 0 }, "idempotent");
    });
  });

  test("reminder: once, ~a day before expiry, only to confirmed newsletter subscribers, as a marketing mail", async () => {
    await inRollback(async (tx) => {
      let config = await setWheel(tx);
      const now = new Date();
      const issueAt = new Date(now.getTime() - 48 * HOUR); // validity 72 h → 24 h left
      const subscribed = await makeUser(tx, "remind-yes");
      const notSubscribed = await makeUser(tx, "remind-no");
      const pending = await makeUser(tx, "remind-pending");
      await tx.insert(schema.newsletterSubscribers).values([
        { email: subscribed.email.toUpperCase(), status: "active", unsubscribeToken: randomUUID() },
        { email: pending.email, status: "pending", unsubscribeToken: randomUUID() },
      ]);
      const spinIds: number[] = [];
      for (const user of [subscribed, notSubscribed, pending]) {
        const r = await createSpin(tx, { config, account: { id: user.id }, locale: "tr", ipHash: null, pagePath: null, now: issueAt, randomInt: TEN });
        assert.ok(r.ok);
        const account = (await loadWheelAccount(tx, user.id))!;
        assert.ok(await issueSpinPrize(tx, { spinId: r.spin.id, account, config, now: issueAt }));
        spinIds.push(r.spin.id);
      }
      assert.deepEqual(await queueWheelReminders(tx, { now: new Date(now.getTime() - 24 * HOUR), spinIds }), { queued: 0, skipped: 0, disabled: 0 }, "48 h left: too early");
      assert.deepEqual(await queueWheelReminders(tx, { now, spinIds }), { queued: 1, skipped: 0, disabled: 0 });
      const mail = (await mailsTo(tx, subscribed.email)).find((m) => m.template === "wheel_prize_reminder");
      assert.ok(mail, "queued for the confirmed subscriber");
      assert.equal(mail.subject, "Çark hediyenizin süresi yakında doluyor"); // lead decision D1: "siz"
      assert.ok((mail.headers as Record<string, string> | null)?.["List-Unsubscribe"], "marketing mail: List-Unsubscribe header");
      assert.equal((await mailsTo(tx, notSubscribed.email)).some((m) => m.template === "wheel_prize_reminder"), false);
      assert.equal((await mailsTo(tx, pending.email)).some((m) => m.template === "wheel_prize_reminder"), false, "a pending (unconfirmed) subscription is not consent");
      const [stamped] = await tx.select({ at: schema.wheelSpins.remindedAt }).from(schema.wheelSpins).where(eq(schema.wheelSpins.id, spinIds[0]));
      assert.equal(stamped.at?.getTime(), now.getTime());
      assert.deepEqual(await queueWheelReminders(tx, { now: new Date(now.getTime() + HOUR), spinIds }), { queued: 0, skipped: 0, disabled: 0 }, "once per prize");
      // A used prize is not reminded; the switch turns the job off.
      await tx.update(schema.wheelSpins).set({ remindedAt: null }).where(eq(schema.wheelSpins.id, spinIds[0]));
      await tx.update(schema.coupons).set({ usedCount: 1 }).where(and(eq(schema.coupons.userId, subscribed.id), eq(schema.coupons.source, "wheel")));
      assert.equal((await queueWheelReminders(tx, { now, spinIds })).queued, 0, "used prizes are not reminded");
      config = await setWheel(tx, { reminderEnabled: false });
      assert.deepEqual(await queueWheelReminders(tx, { now, spinIds }), { queued: 0, skipped: 0, disabled: 1 });
      void config;
    });
  });

  test("anonymize: spins lose user and IP hash, unused prizes are switched off, a used one stays", async () => {
    await inRollback(async (tx) => {
      const config = await setWheel(tx);
      const u = await makeUser(tx, "anon");
      const now = new Date();
      const r = await createSpin(tx, { config, account: { id: u.id }, locale: "tr", ipHash: hashWheelIp("203.0.113.9"), pagePath: null, now, randomInt: TEN });
      assert.ok(r.ok);
      const issued = await issueSpinPrize(tx, { spinId: r.spin.id, account: (await loadWheelAccount(tx, u.id))!, config, now });
      assert.ok(issued);
      const [used] = await tx.insert(schema.coupons).values({ code: CODE("USED"), type: "percent", value: 10, source: "wheel", userId: u.id, maxUses: 1, usedCount: 1 }).returning({ id: schema.coupons.id });
      const result = await anonymizeAccount(tx, u.id, { actorId: u.id, reason: "self" });
      assert.equal(result.unlinkedWheelSpins, 1);
      assert.equal(result.deactivatedWheelPrizes, 1);
      const row = await spinRow(tx, r.spin.id);
      assert.deepEqual([row.userId, row.ipHash, row.status, row.couponId], [null, null, "claimed", issued.couponId], "kept for statistics, without personal trace");
      const coupons = await tx.select({ id: schema.coupons.id, isActive: schema.coupons.isActive }).from(schema.coupons).where(eq(schema.coupons.userId, u.id));
      assert.equal(coupons.find((c) => c.id === issued.couponId)?.isActive, false);
      assert.equal(coupons.find((c) => c.id === used.id)?.isActive, true, "a used prize stays as the order's record");
      assert.equal(JSON.stringify(result.audit).includes(u.email), false);
    });
  });
});
