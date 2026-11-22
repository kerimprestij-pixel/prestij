// NOTIFY against the local PostgreSQL: order e-mails per payment method and status (and no duplicates
// on replays), the template editor save, newsletter double opt-in, unsubscribe tokens and idempotent
// campaign batching.
//
// The database is shared with other agents: every order, subscriber, campaign and mail of this file
// carries the "notify-t-" prefix and is deleted at the end; settings changes happen only inside
// transactions that are rolled back; mails are never flushed (they stay queued until deleted).
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/notify.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AddressData, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import { defaultMessages } from "@/i18n/messages";
import { newsletterUnsubscribeToken, renderEmailPreview } from "@/lib/email";
import { outboxDirectory } from "@/lib/email/drivers";
import { campaignStats, createCampaign, processCampaigns, scheduleCampaign, sendCampaignBatch } from "@/lib/newsletter/campaigns";
import {
  confirmNewsletter,
  CONFIRM_RESEND_SECONDS,
  CONFIRM_TTL_DAYS,
  hashConsentIp,
  subscribeNewsletter,
  unsubscribeNewsletter,
} from "@/lib/newsletter/service";
import { emailImageUrl, enqueueOrderEmails, notifyOrderEvent, planOrderEmails } from "@/lib/notifications";
import { listOrderEmails, resendEmailMessage, cancelEmailMessage } from "@/lib/panel/emails/service";
import { checkTemplatePlaceholders, saveEmailTemplateSettings } from "@/lib/panel/emails/templates";
import { readSettingsRow } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";

const PREFIX = "notify-t-";
const mail = (tag: string) => `${PREFIX}${tag}@test.local`;
const m = schema.emailMessages;
const o = schema.orders;
const s = schema.newsletterSubscribers;
const c = schema.emailCampaigns;

class Rollback extends Error {}

/** Runs `fn` in a transaction and always rolls it back (settings changes never leave the test). */
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await assert.rejects(
    db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback("rollback");
    }),
    (e: unknown) => e instanceof Rollback,
  );
}

async function setSettings(tx: Tx, key: string, value: unknown) {
  await tx
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: sql`${schema.settings.value} || ${JSON.stringify(value)}::jsonb` } });
}

const SEQ_TABLES = ["orders", "order_items", "order_events", "email_messages", "newsletter_subscribers", "email_campaigns", "companies"] as const;
const sequences: { name: string; lastValue: string; isCalled: boolean; table: string }[] = [];
let media: { id: number; url: string; variants: unknown } | null = null;
let orderSeq = 0;

const address: AddressData = { fullName: "Zeynep Kaya", phone: "+905321112233", city: "Kayseri", district: "Talas", line1: "Gül Sok. No: 4", postalCode: "38280" };

async function createOrder(
  tx: Tx,
  opts: { method: PaymentMethod; status: OrderStatus; locale?: string; paid?: boolean; companyId?: number | null; invoice?: Record<string, unknown> },
) {
  const n = ++orderSeq;
  const [order] = await tx
    .insert(o)
    .values({
      orderNumber: `PR-99${String(9000 + n)}`,
      email: mail(`order${n}`),
      phone: "+905321112233",
      locale: opts.locale ?? "tr",
      status: opts.status,
      paymentMethod: opts.method,
      subtotal: 29980,
      discountTotal: 0,
      shippingTotal: 9990,
      paymentFee: opts.method === "cash_on_delivery" ? 4990 : 0,
      vatTotal: 7495,
      grandTotal: 29980 + 9990 + (opts.method === "cash_on_delivery" ? 4990 : 0),
      shippingAddress: address,
      invoice: (opts.invoice ?? { type: "individual", sameAsShipping: true }) as never,
      paidAt: opts.paid ? new Date() : null,
      companyId: opts.companyId ?? null,
      breakdown: { shippingFlat: 9990, shippingHeavy: 0, heavyKg: 0, freeShipping: false, freeShippingReason: null, itemCount: 2 } as never,
    })
    .returning();
  await tx.insert(schema.orderItems).values([
    {
      orderId: order.id,
      variantId: null,
      snapshot: {
        productId: 1,
        productName: { tr: "Lavanta Latte", en: "Lavender Latte", ar: "لافندر لاتيه" },
        productSubtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" },
        variantTitle: { tr: "500 ml" },
        sku: "NTFY-1",
        accentColor: "#C2ADD1",
        image: media ? ({ id: media.id, url: media.url, variants: media.variants, width: 480, height: 480, alt: null, blurDataUrl: null, dominantColor: null } as never) : null,
      },
      unitPrice: 14990,
      quantity: 2,
      lineTotal: 29980,
    },
    {
      orderId: order.id,
      variantId: null,
      snapshot: { productId: 4, productName: { tr: "Okyanus" }, variantTitle: { tr: "Numune" }, sku: "NTFY-S" },
      unitPrice: 0,
      quantity: 1,
      lineTotal: 0,
      isSample: true,
    },
  ]);
  return order;
}

async function orderMails(tx: Tx, orderId: number) {
  return tx.select().from(m).where(and(eq(m.relatedType, "order"), eq(m.relatedId, String(orderId))));
}

async function setOrder(tx: Tx, id: number, set: Partial<typeof o.$inferInsert>) {
  await tx.update(o).set(set).where(eq(o.id, id));
}

before(async () => {
  const leftovers = await db.select({ id: m.id }).from(m).where(like(m.toEmail, `${PREFIX}%`));
  assert.equal(leftovers.length, 0, "no leftovers from an earlier run");
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    sequences.push({ name: seq, lastValue: row.last_value, isCalled: row.is_called, table });
  }
  const [row] = await db
    .select({ id: schema.media.id, url: schema.media.url, variants: schema.media.variants })
    .from(schema.media)
    .where(sql`${schema.media.variants}::text like '%webp%'`)
    .limit(1);
  media = row ?? null;
});

/** Another agent's flush may send our queued rows to the outbox meanwhile: remove those files by id. */
function removeOutboxFilesFor(ids: number[]) {
  const dir = outboxDirectory();
  if (!existsSync(dir) || ids.length === 0) return;
  const suffixes = ids.map((id) => `-${id}.`);
  for (const file of readdirSync(dir)) {
    if (suffixes.some((x) => file.includes(x)) && /.(html|txt|json)$/.test(file)) unlinkSync(path.join(dir, file));
  }
}

after(async () => {
  try {
    removeOutboxFilesFor((await db.select({ id: m.id }).from(m).where(like(m.toEmail, `${PREFIX}%`))).map((r) => r.id));
    await db.delete(m).where(like(m.toEmail, `${PREFIX}%`));
    await db.delete(o).where(like(o.email, `${PREFIX}%`)); // items + events cascade
    await db.delete(c).where(sql`${c.subject}->>'tr' like ${`${PREFIX}%`}`);
    await db.delete(s).where(like(s.email, `${PREFIX}%`));
    for (const seq of sequences) {
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${seq.table}`));
      if (max === null || Number(max) <= Number(seq.lastValue)) {
        await db.execute(sql`select setval(${seq.name}::regclass, ${seq.lastValue}::bigint, ${seq.isCalled})`);
      }
    }
    assert.equal((await db.select({ id: m.id }).from(m).where(like(m.toEmail, `${PREFIX}%`))).length, 0);
    assert.equal((await db.select({ id: o.id }).from(o).where(like(o.email, `${PREFIX}%`))).length, 0);
    assert.equal((await db.select({ id: s.id }).from(s).where(like(s.email, `${PREFIX}%`))).length, 0);
  } finally {
    await db.$client.end();
  }
});

describe("order e-mail rules (pure)", () => {
  test("card: nothing on placed, paid → customer + admin, payment_failed only while pending", () => {
    assert.deepEqual(planOrderEmails("placed", { paymentMethod: "card", status: "pending_payment", paid: false }), { customer: null, admin: false });
    assert.deepEqual(planOrderEmails("paid", { paymentMethod: "card", status: "paid", paid: true }), { customer: { template: "order_paid", event: "paid" }, admin: true });
    assert.equal(planOrderEmails("payment_failed", { paymentMethod: "card", status: "pending_payment", paid: false }).customer?.template, "order_payment_failed");
    assert.equal(planOrderEmails("payment_failed", { paymentMethod: "card", status: "paid", paid: true }).customer, null, "paid meanwhile: no 'complete your payment'");
    assert.equal(planOrderEmails("cancelled", { paymentMethod: "card", status: "cancelled", paid: false }).customer, null, "an expired unpaid card attempt is silent");
    assert.equal(planOrderEmails("cancelled", { paymentMethod: "card", status: "cancelled", paid: true }).customer?.template, "order_cancelled");
  });

  test("havale, kapıda ödeme, vadeli, shipping events", () => {
    assert.deepEqual(planOrderEmails("placed", { paymentMethod: "bank_transfer", status: "awaiting_transfer", paid: false }), {
      customer: { template: "order_awaiting_transfer", event: "placed" },
      admin: true,
    });
    assert.deepEqual(planOrderEmails("placed", { paymentMethod: "bank_transfer", status: "paid", paid: true }), { customer: null, admin: false }, "already paid: no IBAN mail, no late admin alert");
    assert.equal(planOrderEmails("placed", { paymentMethod: "cash_on_delivery", status: "refunded", paid: true }).admin, false, "a late replay alerts nobody new");
    assert.equal(planOrderEmails("paid", { paymentMethod: "card", status: "shipped", paid: true }).admin, false);
    assert.deepEqual(planOrderEmails("paid", { paymentMethod: "bank_transfer", status: "paid", paid: true }), { customer: { template: "order_paid", event: "paid" }, admin: false });
    assert.deepEqual(planOrderEmails("placed", { paymentMethod: "cash_on_delivery", status: "processing", paid: false }), { customer: { template: "order_received", event: "placed" }, admin: true });
    assert.deepEqual(planOrderEmails("placed", { paymentMethod: "deferred", status: "processing", paid: false }), { customer: { template: "order_received", event: "placed" }, admin: true });
    assert.equal(planOrderEmails("processing", { paymentMethod: "card", status: "processing", paid: true }).customer, null);
    for (const [event, template] of [
      ["shipped", "order_shipped"],
      ["delivered", "order_delivered"],
      ["refunded", "order_refunded"],
    ] as const) {
      assert.equal(planOrderEmails(event, { paymentMethod: "cash_on_delivery", status: "shipped", paid: false }).customer?.template, template);
    }
  });

  test("e-mail images use a small WebP/JPEG/PNG variant, never AVIF", () => {
    const url = emailImageUrl({
      id: 1,
      url: "/media/x/a-1200.webp",
      width: 1200,
      height: 1200,
      alt: null,
      blurDataUrl: null,
      dominantColor: null,
      variants: [
        { width: 480, height: 480, format: "avif", key: "x/a-480.avif", bytes: 1 },
        { width: 480, height: 480, format: "webp", key: "x/a-480.webp", bytes: 1 },
        { width: 1200, height: 1200, format: "webp", key: "x/a-1200.webp", bytes: 1 },
      ],
    });
    assert.ok(url?.endsWith("/media/x/a-480.webp"), String(url));
    assert.ok(/^https?:\/\//.test(url ?? ""), "absolute");
    assert.equal(emailImageUrl({ id: 2, url: "/media/x/b.avif", width: 1, height: 1, alt: null, blurDataUrl: null, dominantColor: null, variants: [] }), null);
  });
});

describe("order e-mails against the database", () => {
  // Every scenario runs inside one transaction that is rolled back, with this file's own admin
  // recipients: nothing is committed, so no other agent's flush can send these mails.
  const ADMINS = [mail("admin1"), mail("admin2")];
  const scenario = (fn: (tx: Tx) => Promise<void>) =>
    inRollback(async (tx) => {
      await setSettings(tx, "emails", { adminRecipients: ADMINS });
      await fn(tx);
    });

  test("card order: placed sends nothing; payment_failed once; paid → customer mail with lines, totals, addresses + admins; replays add nothing", async () => {
    await scenario(async (tx) => {
      const order = await createOrder(tx, { method: "card", status: "pending_payment" });
      assert.deepEqual(await enqueueOrderEmails(tx, "placed", order.id), { queued: 0, skipped: 0 });
      assert.equal((await enqueueOrderEmails(tx, "payment_failed", order.id)).queued, 1);
      assert.deepEqual(await enqueueOrderEmails(tx, "payment_failed", order.id), { queued: 0, skipped: 1 }, "once per order");

      await setOrder(tx, order.id, { status: "paid", paidAt: new Date() });
      assert.equal((await enqueueOrderEmails(tx, "paid", order.id)).queued, 3, "customer + 2 admins");
      assert.equal((await enqueueOrderEmails(tx, "paid", order.id)).queued, 0, "a replayed callback queues nothing");

      const rows = await orderMails(tx, order.id);
      const customer = rows.filter((r) => r.toEmail === order.email);
      assert.deepEqual(customer.map((r) => r.template).sort(), ["order_paid", "order_payment_failed"]);
      assert.deepEqual(rows.filter((r) => r.template === "admin_new_order").map((r) => r.toEmail).sort(), ADMINS);
      assert.ok(rows.every((r) => r.template !== "admin_new_order" || (r.locale === "tr" && r.dedupeKey === `order:${order.id}:new:admin:${r.toEmail}`)));
      const paidMail = customer.find((r) => r.template === "order_paid")!;
      assert.equal(paidMail.dedupeKey, `order:${order.id}:paid:customer`);
      assert.equal(paidMail.status, "queued");
      assert.ok(paidMail.subject.includes(order.orderNumber));
      const html = paidMail.html;
      assert.ok(html.includes("Lavanta Latte"), "line name");
      assert.ok(html.includes("Sıvı El Sabunu · 500 ml"), "subtitle + variant");
      assert.ok(html.includes(defaultMessages.tr.email.orders.sample), "sample badge");
      assert.ok(html.includes("399,70"), "grand total as on the order page");
      assert.ok(html.includes(defaultMessages.tr.cart.summary.vat), "VAT note row");
      assert.ok(html.includes("Gül Sok. No: 4"), "delivery address");
      assert.ok(html.includes(`/tr/siparis/${order.orderNumber}?t=${order.accessToken}`), "token link to the order page");
      if (media) assert.ok(/<img src="https?:[^"]+\.webp"/.test(html), "line image as WebP");
      assert.ok(customer.find((r) => r.template === "order_payment_failed")!.html.includes(defaultMessages.tr.email.orders.paymentFailed.button));
    });
  });

  test("havale: IBANs, amount, reference and deadline on placed; admin mail per recipient; no duplicates", async () => {
    await scenario(async (tx) => {
      const order = await createOrder(tx, { method: "bank_transfer", status: "awaiting_transfer" });
      await setSettings(tx, "payments", {
        bankTransfer: {
          enabled: true,
          discountPercent: 0,
          accounts: [{ bank: "Notify Test Bankası", holder: "PRESTİJ TEST", iban: "TR330006100519786457841326" }],
          instructions: { tr: "Açıklamaya sipariş numarasını yazın." },
        },
      });
      assert.equal((await enqueueOrderEmails(tx, "placed", order.id)).queued, 3, "customer + 2 admins");
      const rows = await orderMails(tx, order.id);
      const customer = rows.find((x) => x.template === "order_awaiting_transfer")!;
      assert.ok(customer.html.includes("TR33 0006 1005 1978 6457 8413 26"), "formatted IBAN");
      assert.ok(customer.html.includes("Notify Test Bankası"));
      assert.ok(customer.html.includes(order.orderNumber), "reference");
      assert.ok(customer.html.includes("399,70"), "amount");
      assert.ok(customer.html.includes(defaultMessages.tr.email.orders.awaitingTransfer.deadline), "pay-by date row");
      assert.ok(customer.html.includes("Açıklamaya sipariş numarasını yazın."), "panel instructions");
      assert.equal((await enqueueOrderEmails(tx, "placed", order.id)).queued, 0, "no duplicates");
      await setOrder(tx, order.id, { status: "paid", paidAt: new Date() });
      assert.equal((await enqueueOrderEmails(tx, "paid", order.id)).queued, 1, "the customer's paid mail; the admins already know the order");
      assert.ok((await orderMails(tx, order.id)).find((x) => x.template === "order_paid")!.html.includes(defaultMessages.tr.email.orders.paid.bankTransfer));
    });
  });

  test("kapıda ödeme in Arabic: RTL order_received with the COD fee; ship, deliver, refund mails once each", async () => {
    await scenario(async (tx) => {
      const order = await createOrder(tx, { method: "cash_on_delivery", status: "processing", locale: "ar" });
      await enqueueOrderEmails(tx, "placed", order.id);
      await setOrder(tx, order.id, { status: "shipped", carrier: "yurtici", trackingNumber: "YK12345678", shippedAt: new Date() });
      await enqueueOrderEmails(tx, "shipped", order.id);
      await enqueueOrderEmails(tx, "shipped", order.id);
      await setOrder(tx, order.id, { status: "delivered", deliveredAt: new Date(), paidAt: new Date() });
      await enqueueOrderEmails(tx, "delivered", order.id);
      await setOrder(tx, order.id, { status: "refunded" });
      await enqueueOrderEmails(tx, "refunded", order.id);
      await enqueueOrderEmails(tx, "placed", order.id);

      const rows = await orderMails(tx, order.id);
      const customer = rows.filter((r) => r.toEmail === order.email);
      assert.deepEqual(customer.map((r) => r.template).sort(), ["order_delivered", "order_received", "order_refunded", "order_shipped"]);
      assert.equal(rows.filter((r) => r.template === "admin_new_order").length, 2, "one per admin, not repeated by the late replay");
      const received = customer.find((r) => r.template === "order_received")!;
      assert.equal(received.locale, "ar");
      assert.ok(received.html.includes('dir="rtl"'));
      assert.ok(received.subject.includes(order.orderNumber));
      assert.ok(received.html.includes(defaultMessages.ar.email.orders.received.codTitle));
      assert.ok(received.html.includes("لافندر لاتيه"), "localized product name");
      const shipped = customer.find((r) => r.template === "order_shipped")!;
      assert.ok(shipped.html.includes("yurticikargo.com"), "carrier tracking link");
      assert.ok(shipped.html.includes("YK12345678"));
      assert.ok(shipped.text.includes("code=YK12345678"));
    });
  });

  test("cancelled: refund note when paid, 'no charge' otherwise; unpaid card attempt is silent", async () => {
    await scenario(async (tx) => {
      const paid = await createOrder(tx, { method: "card", status: "cancelled", paid: true });
      const unpaidCod = await createOrder(tx, { method: "cash_on_delivery", status: "cancelled" });
      const unpaidCard = await createOrder(tx, { method: "card", status: "cancelled" });
      for (const order of [paid, unpaidCod, unpaidCard]) await enqueueOrderEmails(tx, "cancelled", order.id);
      const [a] = await orderMails(tx, paid.id);
      assert.ok(a.html.includes(defaultMessages.tr.email.orders.cancelled.refundNote.split("{amount}")[0].trim().slice(0, 30)));
      const [b] = await orderMails(tx, unpaidCod.id);
      assert.ok(b.html.includes(defaultMessages.tr.email.orders.cancelled.noCharge));
      assert.equal((await orderMails(tx, unpaidCard.id)).length, 0);
    });
  });

  test("vadeli: the company's payment term in days; masked VKN for the customer, full VKN for the admin", async () => {
    await scenario(async (tx) => {
      const [company] = await tx
        .insert(schema.companies)
        .values({ name: `${PREFIX}Otel`, status: "approved", paymentTerms: { allowDeferred: true, days: 45 } })
        .returning({ id: schema.companies.id });
      const order = await createOrder(tx, {
        method: "deferred",
        status: "processing",
        locale: "en",
        companyId: company.id,
        invoice: { type: "corporate", companyName: "Test Otel A.Ş.", taxOffice: "Talas", taxNumber: "1234567890" },
      });
      await enqueueOrderEmails(tx, "placed", order.id);
      const rows = await orderMails(tx, order.id);
      const customer = rows.find((r) => r.template === "order_received")!;
      assert.ok(customer.html.includes("45-day payment terms"), "deferred terms in the mail");
      assert.ok(customer.html.includes("••••••••90"), "VKN masked for the customer");
      assert.ok(!customer.html.includes("1234567890"));
      const admin = rows.find((r) => r.template === "admin_new_order")!;
      assert.ok(admin.html.includes("1234567890") && admin.html.includes(`${PREFIX}Otel`), "the shop sees the full VKN and the company");
    });
  });

  test("notifyOrderEvent never throws and ignores unknown orders", async () => {
    await notifyOrderEvent("paid", 987654321);
  });

  test("panel log: list per order, resend makes a copy, cancel only queued", async () => {
    await scenario(async (tx) => {
      const order = await createOrder(tx, { method: "cash_on_delivery", status: "processing" });
      await enqueueOrderEmails(tx, "placed", order.id);
      const list = (await listOrderEmails(tx, order.id)).filter((r) => r.toEmail === order.email);
      assert.equal(list.length, 1);
      const copy = await resendEmailMessage(tx, list[0].id, "notify-test-actor");
      const [copyRow] = await tx.select().from(m).where(eq(m.id, copy.id));
      assert.equal(copyRow.dedupeKey, null);
      assert.equal(copyRow.html, (await tx.select().from(m).where(eq(m.id, list[0].id)))[0].html);
      await cancelEmailMessage(tx, copy.id);
      await assert.rejects(cancelEmailMessage(tx, copy.id), /kuyrukta değil/);
      assert.equal((await listOrderEmails(tx, order.id)).filter((r) => r.toEmail === order.email).length, 2);
    });
  });
});

describe("template editor", () => {
  test("placeholders are validated per field and locale", () => {
    assert.throws(() => checkTemplatePlaceholders("order_paid", { subject: { tr: "Ödeme {foo}" }, intro: null }), (e: { fieldErrors?: Record<string, string> }) => Boolean(e.fieldErrors?.["subject.tr"]));
    assert.doesNotThrow(() => checkTemplatePlaceholders("order_paid", { subject: { tr: "{orderNumber} ödendi · {siteName}" }, intro: { tr: "", en: "Hi {name}" } }));
  });

  test("a saved subject override renders, an English-only override leaves Turkish built in; required templates stay on", async () => {
    await inRollback(async (tx) => {
      const row = await readSettingsRow("emails", tx);
      const saved = await saveEmailTemplateSettings(tx, { key: "order_shipped", enabled: true, subject: { tr: "", en: "On its way: {orderNumber}" }, intro: null, updatedAt: row.updatedAt ? new Date(row.updatedAt) : null });
      const after1 = await readSettingsRow("emails", tx);
      assert.deepEqual(after1.value.templates.order_shipped, { enabled: true, subject: { tr: "", en: "On its way: {orderNumber}" } });
      await assert.rejects(
        saveEmailTemplateSettings(tx, { key: "account_verify", enabled: false, subject: null, intro: null, updatedAt: saved.updatedAt }),
        (e: { fieldErrors?: Record<string, string> }) => Boolean(e.fieldErrors?.enabled),
      );
      await assert.rejects(saveEmailTemplateSettings(tx, { key: "order_paid", enabled: true, subject: null, intro: null, updatedAt: new Date("2001-01-01") }), /değiştirildi/);
    });
    const preview = await renderEmailPreview("order_shipped", "en", { subject: "On its way: {orderNumber}" });
    assert.equal(preview?.subject, "On its way: PR-261001");
    const tr = await renderEmailPreview("order_shipped", "tr");
    assert.equal(tr?.subject, "Siparişiniz kargoya verildi · PR-261001");
  });
});

describe("newsletter double opt-in", () => {
  const tokenOf = async (subscriberId: number) => {
    const rows = await db
      .select({ text: m.text, id: m.id })
      .from(m)
      .where(and(eq(m.relatedType, "newsletter"), eq(m.relatedId, String(subscriberId)), eq(m.template, "newsletter_confirm")))
      .orderBy(sql`${m.id} desc`)
      .limit(1);
    const match = /[?&]t=([A-Za-z0-9_-]+)/.exec(rows[0]?.text ?? "");
    assert.ok(match, "confirmation link in the mail");
    return match[1];
  };

  test("pending → confirm link → active; single use; active unchanged; unsubscribe; re-subscribe goes through pending", async () => {
    const email = mail("sub1");
    const first = await db.transaction((tx) => subscribeNewsletter(tx, { email: ` ${email.toUpperCase()} `, locale: "en", source: "footer", ip: "203.0.113.7" }));
    assert.ok(first.ok && first.outcome === "pending" && first.emailId);
    const [row] = await db.select().from(s).where(eq(s.email, email));
    assert.equal(row.status, "pending");
    assert.equal(row.locale, "en");
    assert.equal(row.consentSource, "footer");
    assert.equal(row.consentIpHash, hashConsentIp("203.0.113.7"));
    assert.ok(row.consentIpHash && !row.consentIpHash.includes("203.0"), "IP stored only as a keyed hash");
    const [confirmMail] = await db.select().from(m).where(eq(m.id, first.emailId!));
    assert.equal(confirmMail.locale, "en");
    assert.ok(confirmMail.text.includes("/en/newsletter/confirm?t="));
    assert.equal(confirmMail.headers, null, "the confirmation is transactional");

    const throttled = await db.transaction((tx) => subscribeNewsletter(tx, { email, locale: "en", source: "footer" }));
    assert.ok(throttled.ok && throttled.outcome === "throttled", `no second mail within ${CONFIRM_RESEND_SECONDS} s`);

    const token = await tokenOf(row.id);
    assert.deepEqual(await db.transaction((tx) => confirmNewsletter(tx, "x".repeat(43))), { ok: false, reason: "invalid" });
    const confirmed = await db.transaction((tx) => confirmNewsletter(tx, token));
    assert.ok(confirmed.ok && !confirmed.alreadyActive);
    const [active] = await db.select().from(s).where(eq(s.id, row.id));
    assert.equal(active.status, "active");
    assert.ok(active.confirmedAt);
    assert.equal(active.confirmTokenHash, null);
    assert.deepEqual(await db.transaction((tx) => confirmNewsletter(tx, token)), { ok: false, reason: "invalid" }, "single use");

    const known = await db.transaction((tx) => subscribeNewsletter(tx, { email, locale: "tr", source: "section" }));
    assert.ok(known.ok && known.outcome === "already_active" && known.emailId === null);
    assert.equal((await db.select().from(s).where(eq(s.id, row.id)))[0].locale, "en", "an active row is unchanged");

    const unsub = await db.transaction((tx) => unsubscribeNewsletter(tx, newsletterUnsubscribeToken(row.id)));
    assert.deepEqual(unsub, { ok: true, subscriberId: row.id, changed: true });
    const again = await db.transaction((tx) => unsubscribeNewsletter(tx, newsletterUnsubscribeToken(row.id)));
    assert.deepEqual(again, { ok: true, subscriberId: row.id, changed: false }, "idempotent");
    const [gone] = await db.select().from(s).where(eq(s.id, row.id));
    assert.equal(gone.status, "unsubscribed");
    assert.ok(gone.unsubscribedAt);

    const back = await db.transaction((tx) => subscribeNewsletter(tx, { email, locale: "ar", source: "register" }));
    assert.ok(back.ok && back.outcome === "pending" && back.emailId);
    const [pendingAgain] = await db.select().from(s).where(eq(s.id, row.id));
    assert.equal(pendingAgain.status, "pending");
    assert.equal(pendingAgain.source, "register");
  });

  test("expired confirmation links and a switched-off newsletter", async () => {
    const email = mail("sub2");
    const r = await db.transaction((tx) => subscribeNewsletter(tx, { email, locale: "tr", source: "checkout" }));
    assert.ok(r.ok);
    const token = await tokenOf(r.subscriberId);
    const later = new Date(Date.now() + (CONFIRM_TTL_DAYS + 1) * 86_400_000);
    assert.deepEqual(await db.transaction((tx) => confirmNewsletter(tx, token, { now: later })), { ok: false, reason: "expired" });
    assert.deepEqual(await db.transaction((tx) => subscribeNewsletter(tx, { email: "not-an-email", locale: "tr", source: "footer" })), { ok: false, reason: "invalid_email" });
    await inRollback(async (tx) => {
      await setSettings(tx, "newsletter", { enabled: false });
      assert.deepEqual(await subscribeNewsletter(tx, { email: mail("sub3"), locale: "tr", source: "footer" }), { ok: false, reason: "disabled" });
    });
  });

  test("unsubscribe tokens: forged or malformed are refused; a valid token of a deleted row answers ok", async () => {
    assert.deepEqual(await db.transaction((tx) => unsubscribeNewsletter(tx, "v1.abc.def")), { ok: false, reason: "invalid" });
    const forged = newsletterUnsubscribeToken(1).replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
    assert.deepEqual(await db.transaction((tx) => unsubscribeNewsletter(tx, forged)), { ok: false, reason: "invalid" });
    assert.deepEqual(await db.transaction((tx) => unsubscribeNewsletter(tx, newsletterUnsubscribeToken(2_000_000_000))), { ok: true, subscriberId: null, changed: false });
  });
});

describe("campaigns", () => {
  test("batches of N to active subscribers only, idempotent across repeated and concurrent runs, then sent", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [row] = await db
        .insert(s)
        .values({ email: mail(`camp${i}`), locale: i === 4 ? "ar" : "tr", status: i === 3 ? "pending" : "active", source: "footer", unsubscribeToken: `${PREFIX}${i}` })
        .returning({ id: s.id });
      ids.push(row.id);
    }
    const created = await db.transaction((tx) =>
      createCampaign(tx, { subject: { tr: `${PREFIX}Kış koleksiyonu`, ar: "مجموعة الشتاء" }, body: { tr: "<p>Merhaba</p>", ar: "<p>مرحبًا</p>" }, audience: "all" }, "notify-test-actor"),
    );
    // Draft campaigns are not sent by a run.
    assert.equal((await processCampaigns({ only: [created.id], onlySubscribers: ids })).queued, 0);
    await db.update(c).set({ status: "sending", scheduledAt: new Date() }).where(eq(c.id, created.id));

    const first = await db.transaction((tx) => sendCampaignBatch(tx, created.id, { batchSize: 2, onlySubscribers: ids }));
    assert.deepEqual(first, { queued: 2, done: false });
    // Two runs at once: SKIP LOCKED + dedupe keys, never a second mail per subscriber.
    const [a, b] = await Promise.all([
      processCampaigns({ only: [created.id], batchSize: 2, onlySubscribers: ids }),
      processCampaigns({ only: [created.id], batchSize: 2, onlySubscribers: ids }),
    ]);
    assert.equal(a.queued + b.queued, 2, "the remaining two active subscribers");
    const rows = await db.select().from(m).where(and(eq(m.relatedType, "campaign"), eq(m.relatedId, String(created.id))));
    assert.equal(rows.length, 4, "4 active subscribers, the pending one is skipped");
    assert.equal(new Set(rows.map((r) => r.toEmail)).size, 4);
    assert.ok(rows.every((r) => r.headers?.["List-Unsubscribe"]?.includes("/api/newsletter/unsubscribe?t=")), "one-click headers");
    assert.ok(rows.every((r) => r.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"));
    const arabic = rows.find((r) => r.toEmail === mail("camp4"))!;
    assert.equal(arabic.subject, "مجموعة الشتاء");
    assert.ok(arabic.html.includes('dir="rtl"'));
    assert.ok(arabic.html.includes("/ar/newsletter/unsubscribe?t="));
    const turkish = rows.find((r) => r.toEmail === mail("camp0"))!;
    assert.equal(turkish.subject, `${PREFIX}Kış koleksiyonu`);

    // Another run finds nobody new and marks it sent.
    await processCampaigns({ only: [created.id], batchSize: 2, onlySubscribers: ids });
    const [done] = await db.select().from(c).where(eq(c.id, created.id));
    assert.equal(done.status, "sent");
    assert.ok(done.sentAt);
    assert.equal(done.stats?.recipients, 4);
    const stats = (await campaignStats(db, [created.id])).get(created.id);
    assert.deepEqual(stats, { recipients: 4, queued: 4, sent: 0, failed: 0 });
    assert.equal((await processCampaigns({ only: [created.id], onlySubscribers: ids })).queued, 0, "a sent campaign stays sent");
  });

  test("scheduling: needs recipients, a future time, and a fresh view", async () => {
    const created = await db.transaction((tx) => createCampaign(tx, { subject: { tr: `${PREFIX}Planlı` }, body: { tr: "<p>x</p>" }, audience: "business" }, null));
    await assert.rejects(
      db.transaction((tx) => scheduleCampaign(tx, { id: created.id, updatedAt: created.updatedAt, at: new Date(Date.now() + 3600_000) })),
      /aktif\) abone yok|abone yok/,
    );
    await assert.rejects(db.transaction((tx) => scheduleCampaign(tx, { id: created.id, updatedAt: created.updatedAt, at: new Date(Date.now() - 1000) })), /bir dakika/);
    await assert.rejects(db.transaction((tx) => scheduleCampaign(tx, { id: created.id, updatedAt: new Date("2001-01-01"), at: null })), /değiştirildi/);
    const [row] = await db.select({ status: c.status }).from(c).where(eq(c.id, created.id));
    assert.equal(row.status, "draft");
  });
});
