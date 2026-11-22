// Sales-ready IMPL-A against the local PostgreSQL:
//   SR-1  a new account's records (recordNewAccount, what registerAction runs after Better Auth created the
//         user): with the newsletter off a ticked (forged or stale) box subscribes nothing, queues no mail,
//         the audit row says marketingRequested: false and the success line stays off; with it on the double
//         opt-in starts and the line shows; a switch-off between the action's read and the service refuses.
//   SR-4  renewals follow CF-11: a card renewal in the card test mode on a live site is held "card_test_mode"
//         (nothing written, next_run_at unchanged, a server log line) when the test mode is the sole blocker (FIX F7:
//         card on and a provider configured; otherwise it fails with method_unavailable as before); locally the hold
//         does not apply; on a live site the payment simulator is never the renewal's gateway, even with PAYMENT_SIMULATOR=true.
//   FIX F11: before() removes the rows a crashed earlier run left behind (this file's ids and @test.local addresses only).
//
// Shared database. SR-1 writes only inside transactions that are rolled back (users salesready-impl-a-…
// @test.local, the newsletter settings row changed only inside the rollback). SR-4 needs committed rows
// (renewSubscription runs its own transactions): one test user and its subscriptions, due only at a `now`
// passed in (two months ahead, so no real cron run or reminder ever picks them up), deleted afterwards with
// the mails the failed renewals queued. Every public sequence is put back (never below an id in use).
// Settings for SR-4 are passed in, never written. Environment variables are restored after each test.
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/salesready-impl-a.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerMarketingNotice } from "@/lib/account/register-newsletter";
import { recordNewAccount } from "@/lib/account/registration";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { isNewsletterEnabled } from "@/lib/newsletter/service";
import type { Tx } from "@/lib/panel/tx";
import { cardTestModeHidden, getCardGateway, getCardGatewayFor } from "@/lib/payments/gateway";
import { isSimulatorEnabled } from "@/lib/payments/simulator-gateway";
import { parseSettings } from "@/lib/settings/types";
import { renewDueSubscriptions, renewSubscription } from "@/lib/subscriptions/renew";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const TAG = `salesready-impl-a-${randomUUID().slice(0, 8)}`;
const ID = (name: string) => `${TAG}-${name}`;
const EMAIL = (name: string) => `${TAG}-${name}@test.local`;
const SUB_USER = ID("renewal");
const SUB_EMAIL = EMAIL("renewal");
const NO_EFFECTS = { effects: false } as const;
const env = process.env as Record<string, string | undefined>;
const LIVE = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.example" } as const;
/**
 * Fake PayTR keys (the same throwaway values as tests/db/golive-payments.test.ts): getCardGateway then returns a
 * PayTR gateway object, so the card test mode is the sole blocker. Nothing is ever sent: a held renewal stops before
 * any payment call.
 */
const FAKE_PAYTR_KEYS = { PAYTR_MERCHANT_ID: "100001", PAYTR_MERCHANT_KEY: "salesready-test-key", PAYTR_MERCHANT_SALT: "salesready-test-salt", PAYTR_BASE_URL: undefined } as const;
/** No provider can be configured from the environment inside these tests (no network, no real keys). */
const NO_PROVIDER_KEYS = {
  IYZICO_API_KEY: undefined,
  IYZICO_SECRET_KEY: undefined,
  IYZICO_BASE_URL: undefined,
  PAYTR_MERCHANT_ID: undefined,
  PAYTR_MERCHANT_KEY: undefined,
  PAYTR_MERCHANT_SALT: undefined,
  PAYTR_BASE_URL: undefined,
} as const;
const DAY = 86_400_000;

let seqs: SequenceSnapshot;
let settings: CommerceSettings;
let planId = 0;
let variantId = 0;
const subscriptionIds: number[] = [];

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

/** Collects console.error lines while `fn` runs (the renewal hold's server log line). */
async function capturingErrors<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

/**
 * FIX F11: a run that crashed before after() leaves its committed SR-4 rows behind. Remove them first (only rows of
 * this test file: ids salesready-impl-a-…, addresses salesready-impl-a-…@test.local) and say so, instead of failing.
 */
async function removeLeftovers(): Promise<number> {
  const users = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, "salesready-impl-a-%"));
  if (users.length === 0) return 0;
  const ids = users.map((u) => u.id);
  const subs = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(inArray(schema.subscriptions.userId, ids));
  if (subs.length) {
    const orders = await db.select({ id: schema.orders.id }).from(schema.orders).where(inArray(schema.orders.subscriptionId, subs.map((s) => s.id)));
    assert.equal(orders.length, 0, "a leftover renewal order: check by hand, never deleted automatically");
    await db.delete(schema.subscriptions).where(inArray(schema.subscriptions.id, subs.map((s) => s.id)));
  }
  await db.delete(schema.emailMessages).where(like(schema.emailMessages.toEmail, "salesready-impl-a-%@test.local"));
  await db.delete(schema.user).where(inArray(schema.user.id, ids));
  return users.length;
}

before(async () => {
  const removed = await removeLeftovers();
  if (removed) console.error(`[salesready-impl-a] removed ${removed} test user(s) left over from a crashed run (and their subscriptions and mails)`);
  seqs = await snapshotSequences();
  settings = await loadCommerceSettings();
  const [plan] = await db.execute<{ id: number }>(sql`select id from subscription_plans order by is_active desc, id limit 1`);
  assert.ok(plan, "a subscription plan (seeded)");
  planId = Number(plan.id);
  const [variant] = await db.execute<{ id: number }>(
    sql`select v.id from product_variants v join products p on p.id = v.product_id
        where p.status = 'active' and p.type = 'standard' and not p.business_only and v.is_active and v.price > 0
          and (not v.track_stock or v.allow_backorder or v.stock >= 50)
        order by p.allow_subscription desc, v.price, v.id limit 1`,
  );
  assert.ok(variant, "a buyable standard variant");
  variantId = Number(variant.id);
});

after(async () => {
  try {
    if (subscriptionIds.length) {
      const orders = await db.select({ id: schema.orders.id }).from(schema.orders).where(inArray(schema.orders.subscriptionId, subscriptionIds));
      assert.equal(orders.length, 0, "no renewal order was ever created");
      await db.delete(schema.subscriptions).where(inArray(schema.subscriptions.id, subscriptionIds));
    }
    await db.delete(schema.emailMessages).where(like(schema.emailMessages.toEmail, `${TAG}-%@test.local`));
    await db.delete(schema.user).where(like(schema.user.id, `${TAG}-%`));
    await restoreSequences(seqs);
    const [own] = await db.execute<{ users: string; subs: string; mails: string; subscribers: string; audits: string }>(
      sql`select (select count(*) from "user" where id like ${`${TAG}-%`})::text as users,
                 (select count(*) from subscriptions where user_id like ${`${TAG}-%`})::text as subs,
                 (select count(*) from email_messages where to_email like ${`${TAG}-%`})::text as mails,
                 (select count(*) from newsletter_subscribers where email like ${`${TAG}-%`})::text as subscribers,
                 (select count(*) from audit_log where entity_id like ${`${TAG}-%`})::text as audits`,
    );
    assert.deepEqual({ ...own }, { users: "0", subs: "0", mails: "0", subscribers: "0", audits: "0" }, "no test rows left");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------
// SR-1

async function setNewsletter(tx: Tx, enabled: boolean): Promise<void> {
  const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "newsletter")).limit(1);
  const value = { ...parseSettings("newsletter", row?.value), enabled };
  await tx.insert(schema.settings).values({ key: "newsletter", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

async function makeUser(tx: Tx, name: string): Promise<{ id: string; email: string }> {
  const user = { id: ID(name), email: EMAIL(name) };
  await tx.insert(schema.user).values({ ...user, name: `Kayıt ${name}`, emailVerified: false, locale: "tr" });
  return user;
}

const VERSIONS = { membership: "test-membership-v", kvkk: "test-kvkk-v" };

async function records(tx: Tx, user: { id: string; email: string }, input: { newsletterEnabled: boolean; marketingTicked: boolean }) {
  return recordNewAccount(tx, { userId: user.id, email: user.email, locale: "tr", ip: "203.0.113.41", versions: VERSIONS, wheelSpinId: null, ...input });
}

async function auditAfter(tx: Tx, userId: string): Promise<Record<string, unknown>> {
  const a = schema.auditLog;
  const rows = await tx.select({ after: a.after }).from(a).where(and(eq(a.entity, "user"), eq(a.entityId, userId), eq(a.action, "create")));
  assert.equal(rows.length, 1, "one consent audit row");
  return rows[0].after as Record<string, unknown>;
}

const subscriberRows = (tx: Tx, email: string) => tx.select().from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.email, email));
const mailRows = (tx: Tx, email: string) => tx.select().from(schema.emailMessages).where(eq(schema.emailMessages.toEmail, email));

describe("SR-1: the register form's newsletter box while the newsletter is off", () => {
  test("newsletter off + a ticked (forged) box: nothing subscribed or queued, audit marketingRequested false, no success line", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, false);
      const newsletterEnabled = await isNewsletterEnabled(tx);
      assert.equal(newsletterEnabled, false);
      const user = await makeUser(tx, "off");
      const r = await records(tx, user, { newsletterEnabled, marketingTicked: true });
      assert.deepEqual(r, { newsletter: "off", newsletterMailQueued: false, wheel: null });
      assert.equal(registerMarketingNotice(r.newsletter), false, "no 'we also sent a confirmation e-mail'");
      assert.deepEqual(await subscriberRows(tx, user.email), []);
      assert.deepEqual(await mailRows(tx, user.email), []);
      const audit = await auditAfter(tx, user.id);
      assert.equal(audit.marketingRequested, false);
      assert.equal(audit.newsletter, "off");
      assert.equal(audit.newsletterMailQueued, false);
      assert.equal(audit.membershipVersion, VERSIONS.membership, "the consent record itself is kept");
      assert.equal(audit.kvkkVersion, VERSIONS.kvkk);
    });
  });

  test("newsletter on + ticked: pending subscriber, confirmation mail queued, audit true, success line", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, true);
      const user = await makeUser(tx, "on");
      const r = await records(tx, user, { newsletterEnabled: await isNewsletterEnabled(tx), marketingTicked: true });
      assert.equal(r.newsletter, "pending");
      assert.equal(r.newsletterMailQueued, true);
      assert.equal(registerMarketingNotice(r.newsletter), true);
      const [sub] = await subscriberRows(tx, user.email);
      assert.equal(sub?.status, "pending");
      assert.equal(sub?.source, "register");
      const mails = await mailRows(tx, user.email);
      assert.deepEqual(mails.map((m) => m.template), ["newsletter_confirm"]);
      const audit = await auditAfter(tx, user.id);
      assert.equal(audit.marketingRequested, true);
      assert.equal(audit.newsletter, "pending");
      assert.equal(audit.newsletterMailQueued, true);
    });
  });

  test("newsletter on, box not ticked: nothing subscribed, no line", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, true);
      const user = await makeUser(tx, "unticked");
      const r = await records(tx, user, { newsletterEnabled: true, marketingTicked: false });
      assert.equal(r.newsletter, "not_requested");
      assert.equal(registerMarketingNotice(r.newsletter), false);
      assert.deepEqual(await subscriberRows(tx, user.email), []);
      assert.equal((await auditAfter(tx, user.id)).marketingRequested, false);
    });
  });

  test("switched off between the action's read and the subscription: refused, no line, the audit says so", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, false);
      const user = await makeUser(tx, "race");
      const r = await records(tx, user, { newsletterEnabled: true, marketingTicked: true });
      assert.equal(r.newsletter, "disabled");
      assert.equal(r.newsletterMailQueued, false);
      assert.equal(registerMarketingNotice(r.newsletter), false);
      assert.deepEqual(await subscriberRows(tx, user.email), []);
      const audit = await auditAfter(tx, user.id);
      assert.equal(audit.marketingRequested, true, "the box was offered and ticked");
      assert.equal(audit.newsletter, "disabled");
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// SR-4

const withCard = (card: Partial<CommerceSettings["payments"]["card"]>, base: CommerceSettings = settings): CommerceSettings => ({
  ...base,
  payments: { ...base.payments, card: { ...base.payments.card, enabled: true, installments: false, maxInstallments: 1, ...card } },
});

/** A committed subscription of the test user, due two months from now (renewSubscription gets that `now`). */
async function makeSubscription(paymentMethod: "card" | "bank_transfer"): Promise<{ id: number; due: Date }> {
  if (subscriptionIds.length === 0) {
    await db.insert(schema.user).values({ id: SUB_USER, name: "Abonelik Yenileme", email: SUB_EMAIL, emailVerified: true, locale: "tr" });
  }
  const nextRunAt = new Date(Date.now() + 60 * DAY);
  const address = { fullName: "Abonelik Yenileme", phone: "0532 123 45 67", city: "Kayseri", district: "Kocasinan", line1: "Cumhuriyet Mah. Test Sok. No: 1", postalCode: "38010" };
  const [row] = await db
    .insert(schema.subscriptions)
    .values({ userId: SUB_USER, planId, status: "active", items: [{ variantId, quantity: 1 }], shippingAddress: address, invoice: { type: "individual" }, nextRunAt, email: SUB_EMAIL, locale: "tr", paymentMethod })
    .returning({ id: schema.subscriptions.id });
  subscriptionIds.push(row.id);
  return { id: row.id, due: new Date(nextRunAt.getTime() + 60 * 60_000) };
}

const subRow = async (id: number) => (await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)))[0];
const renewalOrders = (id: number) => db.select({ id: schema.orders.id, provider: schema.orders.paymentProvider }).from(schema.orders).where(eq(schema.orders.subscriptionId, id));
const mailsTo = () => db.select({ template: schema.emailMessages.template }).from(schema.emailMessages).where(eq(schema.emailMessages.toEmail, SUB_EMAIL));

describe("SR-4: subscription renewals follow CF-11", () => {
  test("live site + card test mode as the sole blocker: the card renewal is held (card_test_mode), nothing written, next_run_at unchanged, logged", async () => {
    const sub = await makeSubscription("card");
    const before = await subRow(sub.id);
    const mailsBefore = (await mailsTo()).length;
    const s = withCard({ provider: "paytr", testMode: true });
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: "true", ...NO_PROVIDER_KEYS, ...FAKE_PAYTR_KEYS }, async () => {
      assert.equal(cardTestModeHidden(s.payments, null), true, "a renewal has no staff viewer");
      assert.notEqual(await getCardGateway(s.payments), null, "card on and PayTR configured: only the test mode blocks it");
      assert.equal(await getCardGatewayFor(s.payments, null), null);
      const { result, lines } = await capturingErrors(() => renewSubscription(sub.id, { ...NO_EFFECTS, now: sub.due, settings: s, allowDraftContracts: true }));
      assert.deepEqual(result, { status: "held", subscriptionId: sub.id, reason: "card_test_mode" });
      assert.ok(lines.some((l) => l.includes(`subscription=${sub.id}`) && l.includes("card_test_mode")), `server log line: ${JSON.stringify(lines)}`);
      const counts = await capturingErrors(() => renewDueSubscriptions({ ...NO_EFFECTS, now: sub.due, settings: s, allowDraftContracts: true, only: [sub.id] }));
      assert.deepEqual(counts.result, { renewed: 0, skipped: 0, failed: 0, busy: 0, held: 1 });
    });
    const afterRow = await subRow(sub.id);
    assert.deepEqual(afterRow, before, "the subscription row is untouched (next_run_at, failed_count, updated_at)");
    assert.deepEqual(await renewalOrders(sub.id), []);
    assert.equal((await mailsTo()).length, mailsBefore, "no renewal-failed or payment-due mail");
  });

  test("FIX F7: test mode on but card switched off, or no provider configured: the renewal fails (method_unavailable), never held", async () => {
    for (const [label, card, keys] of [
      ["card switched off in the panel", { provider: "paytr" as const, testMode: true, enabled: false }, FAKE_PAYTR_KEYS],
      ["card on, no provider keys", { provider: "paytr" as const, testMode: true }, {}],
    ] as const) {
      const sub = await makeSubscription("card");
      const s = withCard(card);
      await withEnv({ ...LIVE, PAYMENT_SIMULATOR: undefined, ...NO_PROVIDER_KEYS, ...keys }, async () => {
        assert.equal(cardTestModeHidden(s.payments, null), true, `${label}: the test mode is on`);
        const { result } = await capturingErrors(() => renewSubscription(sub.id, { ...NO_EFFECTS, now: sub.due, settings: s, allowDraftContracts: true }));
        assert.deepEqual(result, { status: "failed", subscriptionId: sub.id, reason: "method_unavailable" }, label);
      });
      assert.equal((await subRow(sub.id)).failedCount, 1, `${label}: the failure is counted (the customer is told)`);
      assert.deepEqual(await renewalOrders(sub.id), [], label);
    }
  });

  test("a havale renewal is not affected by the card test mode hold", async () => {
    const sub = await makeSubscription("bank_transfer");
    // Havale switched off in the passed settings: the renewal reaches pricing and fails there (no order),
    // which shows the card hold did not stop it.
    const base = withCard({ provider: "paytr", testMode: true });
    const s: CommerceSettings = { ...base, payments: { ...base.payments, bankTransfer: { ...base.payments.bankTransfer, enabled: false } } };
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: undefined, ...NO_PROVIDER_KEYS }, async () => {
      const { result } = await capturingErrors(() => renewSubscription(sub.id, { ...NO_EFFECTS, now: sub.due, settings: s, allowDraftContracts: true }));
      assert.notEqual(result.status, "held");
      assert.equal(result.status, "failed");
    });
    assert.deepEqual(await renewalOrders(sub.id), []);
  });

  test("locally (localPaymentMockAllowed) the card test mode does not hold a renewal", async () => {
    const sub = await makeSubscription("card");
    // Card switched off in the passed settings so nothing is charged or ordered: the renewal fails at pricing.
    const s = withCard({ provider: "paytr", testMode: true, enabled: false });
    await withEnv({ PAYMENT_SIMULATOR: undefined, ...NO_PROVIDER_KEYS }, async () => {
      assert.equal(cardTestModeHidden(withCard({ provider: "paytr", testMode: true }).payments, null), false, "not production: no hold");
      const { result } = await capturingErrors(() => renewSubscription(sub.id, { ...NO_EFFECTS, now: sub.due, settings: s, allowDraftContracts: true }));
      assert.deepEqual(result, { status: "failed", subscriptionId: sub.id, reason: "method_unavailable" });
    });
    assert.deepEqual(await renewalOrders(sub.id), []);
  });

  test("live site, test mode off, PAYMENT_SIMULATOR=true: the simulator is never the renewal's gateway", async () => {
    const sub = await makeSubscription("card");
    const s = withCard({ provider: "iyzico", testMode: false });
    await withEnv({ ...LIVE, PAYMENT_SIMULATOR: "true", ...NO_PROVIDER_KEYS }, async () => {
      assert.equal(isSimulatorEnabled(), false);
      assert.equal(cardTestModeHidden(s.payments, null), false);
      assert.equal(await getCardGatewayFor(s.payments, null), null, "no simulator, no iyzico keys: card fails closed");
      const { result } = await capturingErrors(() => renewSubscription(sub.id, { ...NO_EFFECTS, now: sub.due, settings: s, allowDraftContracts: true }));
      assert.deepEqual(result, { status: "failed", subscriptionId: sub.id, reason: "method_unavailable" });
    });
    const orders = await renewalOrders(sub.id);
    assert.equal(orders.some((o) => o.provider === "simulator"), false);
    assert.deepEqual(orders, []);
  });
});
