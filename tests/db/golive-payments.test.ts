// Go-live payment fixes against the local DB: the simulator never runs on a live site (CF-1), orders never
// store a draft contract (CF-4), card in test mode only for staff on a live site (CF-11), test payments are
// flagged on the panel order page and in the admin new-order mail data (CF-11), and PayTR's refusal reason is
// logged and kept in payments.raw.lastError (CF-12, against a local stand-in for PayTR's get-token).
//
// Shared database: only rows this file creates are touched (orders by golive-test+…@test.local, their carts;
// payments, items and events cascade). Stock and updated_at of the variant used and every sequence are put
// back (never below what other writers used meanwhile). Settings are passed in, never written. Environment
// variables are restored after each test. No network call leaves the machine.
import "./setup/local-only";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addItem } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { loadOrderEmailData } from "@/lib/notifications/order-emails";
import { placeOrder, type PlaceOrderContext, type PlaceOrderResult } from "@/lib/orders/place";
import { getOrderByToken, getOrderDetail } from "@/lib/orders/read";
import { cardTestModeHidden, gatewayFor, getCardGateway, getCardGatewayFor, isCardPaymentReadyFor } from "@/lib/payments/gateway";
import { isSimulatorEnabled } from "@/lib/payments/simulator-gateway";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const EMAIL_PREFIX = "golive-test";
const DOMAIN = "test.local";
const SKU = "PR-LVL-500";
const NO_EFFECTS = { effects: false } as const;
const STAFF: CustomerContext = { ...RETAIL_CUSTOMER, staff: true };
const env = process.env as Record<string, string | undefined>;
const LIVE = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example" } as const;

let settings: CommerceSettings;
let seqs: SequenceSnapshot;
let variant: { id: number; stock: number; updatedAt: string };
const createdCarts = new Set<string>();
let emailSeq = 0;

/** Runs `fn` with these environment variables (undefined = unset), then puts the old values back. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

const withCard = (card: Partial<CommerceSettings["payments"]["card"]>): CommerceSettings => ({
  ...settings,
  payments: { ...settings.payments, card: { ...settings.payments.card, enabled: true, installments: false, maxInstallments: 1, ...card } },
});

/** Card off, cash on delivery on (whatever the local panel says), no limit in the way. */
const codOnly = (): CommerceSettings => {
  const s = withCard({ enabled: false });
  return { ...s, payments: { ...s.payments, cashOnDelivery: { ...s.payments.cashOnDelivery, enabled: true, maxOrderTotal: 0 } } };
};

async function newCart(s: CommerceSettings, customer: CustomerContext = RETAIL_CUSTOMER): Promise<string> {
  const r = await addItem(null, { variantId: variant.id, quantity: 1 }, { customer, locale: "tr", settings: s });
  assert.ok(r.ok, `addItem: ${JSON.stringify(r)}`);
  createdCarts.add(r.cartId);
  return r.cartId;
}

function checkout(paymentMethod: "card" | "cash_on_delivery") {
  return {
    locale: "tr",
    contact: { email: `${EMAIL_PREFIX}+${++emailSeq}@${DOMAIN}`, phone: "0532 123 45 67" },
    shippingAddress: { fullName: "Golive Test Alıcı", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" },
    invoice: { type: "individual", sameAsShipping: true },
    paymentMethod,
    consents: { preInformation: true, distanceSales: true },
  };
}

async function place(cartId: string, method: "card" | "cash_on_delivery", ctx: Partial<PlaceOrderContext> & { settings: CommerceSettings }): Promise<PlaceOrderResult> {
  return placeOrder(checkout(method), { cartId, customer: RETAIL_CUSTOMER, clientIp: "203.0.113.90", ...NO_EFFECTS, ...ctx });
}

before(async () => {
  const leftovers = await db.select({ id: schema.orders.id }).from(schema.orders).where(like(schema.orders.email, `${EMAIL_PREFIX}+%@${DOMAIN}`));
  assert.equal(leftovers.length, 0, "golive test orders left over from an earlier run");
  seqs = await snapshotSequences();
  const v = schema.productVariants;
  const [row] = await db.select({ id: v.id, stock: v.stock, updatedAt: sql<string>`${v.updatedAt}::text` }).from(v).where(eq(v.sku, SKU));
  assert.ok(row, `seed variant ${SKU}`);
  variant = row;
  settings = await loadCommerceSettings();
});

after(async () => {
  const o = schema.orders;
  const ids = (await db.select({ id: o.id }).from(o).where(like(o.email, `${EMAIL_PREFIX}+%@${DOMAIN}`))).map((r) => r.id);
  if (ids.length) await db.delete(o).where(inArray(o.id, ids));
  if (createdCarts.size) await db.delete(schema.carts).where(inArray(schema.carts.id, [...createdCarts]));
  await db.execute(sql`update product_variants set stock = ${variant.stock}, updated_at = ${variant.updatedAt}::timestamptz where id = ${variant.id}`);
  await restoreSequences(seqs);
});

describe("CF-1: the payment simulator never runs on a live site", () => {
  test("NODE_ENV=production + an https site + PAYMENT_SIMULATOR=true: simulator off, getCardGateway is not the simulator", async () => {
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: "true", IYZICO_API_KEY: undefined, IYZICO_SECRET_KEY: undefined }, async () => {
      assert.equal(isSimulatorEnabled(), false);
      assert.equal(gatewayFor("simulator"), null);
      const gateway = await getCardGateway(withCard({ provider: "iyzico", testMode: false }).payments);
      assert.notEqual(gateway?.provider, "simulator");
      assert.equal(gateway, null, "no iyzico keys: card fails closed");
    });
  });

  test("still on for local work: development, or a production build on a local origin", async () => {
    await withEnv({ PAYMENT_SIMULATOR: "true" }, () => assert.equal(isSimulatorEnabled(), true));
    await withEnv({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://check.localhost:3470", PAYMENT_SIMULATOR: "true" }, async () => {
      assert.equal(isSimulatorEnabled(), true);
      assert.equal((await getCardGateway(settings.payments))?.provider, "simulator");
    });
    await withEnv({ PAYMENT_SIMULATOR: "false" }, () => assert.equal(isSimulatorEnabled(), false));
  });
});

describe("CF-4: no order with a draft contract", () => {
  test("the seeded 'taslak' texts refuse the order (legal_unavailable) and the cart survives; tests opt in explicitly", async () => {
    const docs = await db.execute<{ version: string }>(sql`select version from legal_documents where is_current and key in ('pre_information', 'distance_sales')`);
    assert.equal(docs.length, 2);
    assert.ok(docs.every((d) => d.version.toLocaleLowerCase("tr-TR").startsWith("taslak")), "the local texts are still drafts");
    const cod = codOnly();
    const cartId = await newCart(cod);
    assert.deepEqual(await place(cartId, "cash_on_delivery", { settings: cod }), { ok: false, code: "legal_unavailable", fieldErrors: {} });
    const [cart] = await db.select({ id: schema.carts.id }).from(schema.carts).where(eq(schema.carts.id, cartId));
    assert.ok(cart, "the cart is kept");
    const placed = await place(cartId, "cash_on_delivery", { settings: cod, allowDraftContracts: true });
    assert.equal(placed.ok, true, JSON.stringify(placed));
  });
});

describe("CF-11: card in test mode on a live site", () => {
  const paytrKeys = { PAYTR_MERCHANT_ID: "100001", PAYTR_MERCHANT_KEY: "golive-test-key", PAYTR_MERCHANT_SALT: "golive-test-salt", PAYTR_BASE_URL: undefined };

  test("hidden for visitors and customers, available to staff; nothing changes in live mode or locally", async () => {
    const test = withCard({ provider: "paytr", testMode: true }).payments;
    const liveMode = withCard({ provider: "paytr", testMode: false }).payments;
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: undefined, ...paytrKeys }, async () => {
      assert.equal(cardTestModeHidden(test, RETAIL_CUSTOMER), true);
      assert.equal(cardTestModeHidden(test, null), true);
      assert.equal(cardTestModeHidden(test, STAFF), false);
      assert.equal(cardTestModeHidden(liveMode, RETAIL_CUSTOMER), false);
      assert.equal(await isCardPaymentReadyFor(test, RETAIL_CUSTOMER), false);
      assert.equal((await getCardGatewayFor(test, STAFF))?.provider, "paytr");
      assert.equal(await isCardPaymentReadyFor(liveMode, RETAIL_CUSTOMER), true);
    });
    await withEnv({ ...paytrKeys, PAYMENT_SIMULATOR: "false" }, async () => {
      assert.equal(cardTestModeHidden(test, RETAIL_CUSTOMER), false, "development: test mode is the normal way to work");
      assert.equal(await isCardPaymentReadyFor(test, RETAIL_CUSTOMER), true);
    });
  });

  test("placeOrder refuses a non-staff card order as card_not_configured (before any provider call)", async () => {
    const s = withCard({ provider: "paytr", testMode: true });
    const cartId = await newCart(s);
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: undefined, ...paytrKeys }, async () => {
      const r = await place(cartId, "card", { settings: s, allowDraftContracts: true });
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.code, "card_not_configured");
    });
  });

  test("a simulator payment is a test payment: badge data on the panel order page and in the admin mail", async () => {
    await withEnv({ PAYMENT_SIMULATOR: "true" }, async () => {
      const s = withCard({ provider: "iyzico", testMode: true });
      const cartId = await newCart(s);
      const placed = await place(cartId, "card", { settings: s, allowDraftContracts: true });
      assert.ok(placed.ok, JSON.stringify(placed));
      const before = await getOrderDetail(placed.orderId);
      assert.equal(before?.testPayment, false, "not paid yet");
      const { simulateCardPayment } = await import("@/lib/payments/simulator");
      const paid = await simulateCardPayment({ orderNumber: placed.orderNumber, token: placed.accessToken, outcome: "success" }, NO_EFFECTS);
      assert.equal(paid.ok && paid.status, "paid");
      const detail = await getOrderDetail(placed.orderId);
      assert.equal(detail?.testPayment, true);
      assert.ok(detail?.payments.some((p) => p.status === "succeeded" && p.test));
      const mail = await loadOrderEmailData(db, placed.orderId);
      assert.equal(mail?.data.admin?.testPayment, true);
    });
  });

  test("the order page offers 'retry payment' to staff in test mode on a live site, never to visitors (same rule as retryCardPayment)", async (t) => {
    // getOrderByToken reads the payment settings from the database (as the order page does): this needs the
    // local panel's card test mode on, which is how the local data is set up.
    if (!settings.payments.card.testMode) return t.skip("the local card test mode is off");
    const placed = await withEnv({ PAYMENT_SIMULATOR: "true" }, async () => {
      const s = withCard({ testMode: true });
      const r = await place(await newCart(s), "card", { settings: s, allowDraftContracts: true });
      assert.ok(r.ok, JSON.stringify(r));
      return r;
    });
    const anyKeys = { ...paytrKeys, IYZICO_API_KEY: "sandbox-golive-test", IYZICO_SECRET_KEY: "sandbox-golive-test", IYZICO_BASE_URL: undefined };
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: undefined, ...anyKeys }, async () => {
      const visitor = await getOrderByToken(placed.orderNumber, placed.accessToken);
      assert.equal(visitor?.status, "pending_payment");
      assert.equal(visitor?.payment.canRetry, false, "a visitor never starts a test payment");
      assert.equal((await getOrderByToken(placed.orderNumber, placed.accessToken, RETAIL_CUSTOMER))?.payment.canRetry, false);
      assert.equal((await getOrderByToken(placed.orderNumber, placed.accessToken, STAFF))?.payment.canRetry, true, "staff may retry the test payment");
    });
    await withEnv({ PAYMENT_SIMULATOR: undefined, ...anyKeys }, async () => {
      assert.equal((await getOrderByToken(placed.orderNumber, placed.accessToken))?.payment.canRetry, true, "development: unchanged");
    });
  });

  test("a cash-on-delivery order carries no test flag", async () => {
    const cod = codOnly();
    const cartId = await newCart(cod);
    const placed = await place(cartId, "cash_on_delivery", { settings: cod, allowDraftContracts: true });
    assert.ok(placed.ok, JSON.stringify(placed));
    assert.equal((await getOrderDetail(placed.orderId))?.testPayment, false);
    const mail = await loadOrderEmailData(db, placed.orderId);
    assert.equal(mail?.data.admin && "testPayment" in mail.data.admin, false);
  });
});

describe("CF-12: PayTR's refusal reason", () => {
  let server: Server;
  let baseUrl = "";
  const REASON = "Mağaza canlı modda değil (test@example.com 4111 1111 1111 1111)";

  before(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(req.url === "/odeme/api/get-token" ? { status: "failed", reason: REASON } : { status: "error" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test("logged (provider text only, masked) and stored in payments.raw.lastError; the buyer gets the order page", async () => {
    const s = withCard({ provider: "paytr", testMode: true });
    const cartId = await newCart(s);
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    let placed: PlaceOrderResult;
    try {
      placed = await withEnv(
        { PAYMENT_SIMULATOR: "false", PAYTR_MERCHANT_ID: "100001", PAYTR_MERCHANT_KEY: "golive-test-key", PAYTR_MERCHANT_SALT: "golive-test-salt", PAYTR_BASE_URL: baseUrl },
        () => place(cartId, "card", { settings: s, allowDraftContracts: true }),
      );
    } finally {
      console.error = original;
    }
    assert.ok(placed.ok, JSON.stringify(placed));
    assert.match(placed.redirectTo, /^\/tr\/siparis\//, "the order page (payment can be retried)");
    const expected = "Mağaza canlı modda değil ([e-posta] [numara])";
    const line = logged.find((args) => String(args[0]).startsWith(`[payments] initiate failed order=${placed.orderId} provider=paytr`));
    assert.ok(line, JSON.stringify(logged));
    assert.deepEqual(line[1], { name: "GatewayRefusedError", code: null, constraint: null, reason: expected });
    assert.ok(!JSON.stringify(logged).includes("test@example.com") && !JSON.stringify(logged).includes("4111"));
    const [payment] = await db.select({ raw: schema.payments.raw, status: schema.payments.status }).from(schema.payments).where(eq(schema.payments.orderId, placed.orderId));
    assert.equal(payment.status, "initiated");
    const lastError = (payment.raw as { lastError?: { at?: string; message?: string } } | null)?.lastError;
    assert.equal(lastError?.message, expected);
    assert.ok(lastError?.at && !Number.isNaN(Date.parse(lastError.at)));
    const detail = await getOrderDetail(placed.orderId);
    assert.equal(detail?.payments[0]?.lastError, expected);
  });
});
