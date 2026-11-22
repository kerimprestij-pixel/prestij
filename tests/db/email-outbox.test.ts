// CORE-COMMS against the local PostgreSQL: the transactional e-mail outbox. Enqueue inside the
// caller's transaction (rollback leaves nothing), render at enqueue, dedupe keys, disabled templates,
// invalid recipients, marketing headers, flush (sent / backoff / failed, stale "sending" rows, no
// driver), two concurrent flushes never sending a row twice, the outbox driver files, cancel /
// requeue, test sends and the Better Auth mail hooks.
//
// Other agents share the database and may run flushes at the same time, so every row this file queues
// is either scheduled far in the future (send_after 2036, claimed only by this file's flushes with
// `now` + `ids`) or deleted right away; outbox files of these rows are removed at the end.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/email-outbox.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { defaultMessages } from "@/i18n/messages";
import { greetingName, linkContext, sendPasswordResetMail, sendVerificationMail } from "@/lib/auth-emails";
import {
  adminRecipients,
  cancelQueuedEmail,
  enqueueEmail,
  flushEmailQueue,
  readNewsletterUnsubscribeToken,
  newsletterUnsubscribeLinks,
  renderEmailPreview,
  requeueEmail,
  scheduleEmailFlush,
  sendTestEmail,
} from "@/lib/email";
import { createOutboxDriver, outboxDirectory, type EmailDriver, type OutgoingEmail } from "@/lib/email/drivers";
import { sendErrorReason } from "@/lib/email/queue";
import { REDACTED_VALUE } from "@/lib/email/redact";
import { PanelError } from "@/lib/panel/errors";
import { getEmailMessage, resendEmailMessage } from "@/lib/panel/emails/service";
import { guardTestSend, TEST_SEND_RULE, testSendLimitKey } from "@/lib/panel/emails/test-send";
import { forgetLimits } from "@/lib/rate-limit-store";
import { defineEmailTemplate } from "@/lib/email/registry";
import type { TemplateKey } from "@/lib/email/types";

const PREFIX = "corecomms-test-";
const to = (n: number | string) => `${PREFIX}${n}@test.local`;
const t = schema.emailMessages;

/** Rows queued by this file wait until 2036, so nobody else's flush picks them up. */
const FUTURE = new Date("2036-01-01T00:00:00.000Z");
const minutes = (n: number) => n * 60_000;
const at = (offsetMinutes: number) => new Date(FUTURE.getTime() + minutes(offsetMinutes));

const MARKETING_KEY = "corecomms_test_marketing" as TemplateKey;
defineEmailTemplate({
  key: MARKETING_KEY,
  audience: "customer",
  marketing: true,
  label: "Test kampanyası",
  placeholders: ["name"],
  sample: () => ({ name: "Ayşe" }) as never,
  build: () => ({ subject: "Yeni kokular, {name}", blocks: [{ type: "heading", text: "Merhaba {name}" }, { type: "richText", html: "<p>Kampanya</p>" }] }),
});

const verifyData = (url = "https://prestij.test/tr/hesap/dogrula?token=abc") => ({ name: "Ayşe", url });

let sequence: { name: string; lastValue: string; isCalled: boolean } | null = null;
const tempDirs: string[] = [];

async function myRows() {
  return db.select().from(t).where(like(t.toEmail, `${PREFIX}%@test.local`));
}

async function myIds(): Promise<number[]> {
  return (await myRows()).map((r) => r.id);
}

function fakeDriver(options: { fail?: (m: OutgoingEmail) => Error | null; delayMs?: number } = {}) {
  const sent: OutgoingEmail[] = [];
  const driver: EmailDriver = {
    name: "fake",
    async send(message) {
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const error = options.fail?.(message) ?? null;
      if (error) throw error;
      sent.push(message);
      return { messageId: `fake-${message.id}` };
    },
  };
  return { driver, sent };
}

/** Queues an account_verify row for `n` that only this file's flushes will see. */
async function queueFuture(n: number | string, extra: { dedupeKey?: string } = {}) {
  const row = await db.transaction((tx) =>
    enqueueEmail(tx, { template: "account_verify", to: to(n), locale: "tr", data: verifyData(), sendAfter: FUTURE, related: { type: "user", id: `${PREFIX}${n}` }, ...extra }),
  );
  assert.ok(row);
  return row.id;
}

function removeOutboxFilesFor(ids: number[]) {
  const dir = outboxDirectory();
  if (!existsSync(dir) || ids.length === 0) return;
  const suffixes = ids.map((id) => `-${id}.`);
  for (const file of readdirSync(dir)) {
    if (suffixes.some((s) => file.includes(s)) && /\.(html|txt|json)$/.test(file)) unlinkSync(path.join(dir, file));
  }
}

before(async () => {
  assert.equal((await myRows()).length, 0, "no leftovers from an earlier run");
  const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence('email_messages', 'id') as seq`);
  const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
  sequence = { name: seq, lastValue: row.last_value, isCalled: row.is_called };
});

after(async () => {
  try {
    const ids = await myIds();
    removeOutboxFilesFor(ids);
    await db.delete(t).where(like(t.toEmail, `${PREFIX}%@test.local`));
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    if (sequence) {
      // Put the id sequence back unless another agent inserted rows meanwhile.
      const [{ max }] = await db.execute<{ max: string | null }>(sql`select max(id)::text as max from email_messages`);
      if (max === null || Number(max) <= Number(sequence.lastValue)) {
        await db.execute(sql`select setval(${sequence.name}::regclass, ${sequence.lastValue}::bigint, ${sequence.isCalled})`);
      }
    }
    assert.equal((await myRows()).length, 0, "every row of this file is gone");
  } finally {
    await db.$client.end();
  }
});

describe("enqueueEmail", () => {
  test("a rolled-back transaction leaves nothing", async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        const row = await enqueueEmail(tx, { template: "account_verify", to: to("rollback"), locale: "tr", data: verifyData(), sendAfter: FUTURE });
        assert.ok(row, "queued inside the transaction");
        const [inside] = await tx.select({ id: t.id }).from(t).where(eq(t.id, row.id));
        assert.ok(inside, "visible inside the transaction");
        throw new Error("rollback");
      }),
      /rollback/,
    );
    const rows = await db.select({ id: t.id }).from(t).where(eq(t.toEmail, to("rollback")));
    assert.equal(rows.length, 0);
  });

  test("renders at enqueue time and stores subject, html, text, locale and relation", async () => {
    const row = await db.transaction((tx) =>
      enqueueEmail(tx, {
        template: "account_verify",
        to: ` ${to("render")} `,
        locale: "en",
        data: { name: "Jane <b>", url: "https://prestij.test/en/account/verify?token=xyz" },
        related: { type: "user", id: "corecomms-user-1" },
        sendAfter: FUTURE,
        createdBy: "corecomms-actor",
      }),
    );
    assert.ok(row);
    assert.equal(row.status, "queued");
    const [stored] = await db.select().from(t).where(eq(t.id, row.id));
    assert.equal(stored.toEmail, to("render"), "trimmed");
    assert.equal(stored.locale, "en");
    assert.equal(stored.subject, defaultMessages.en.email.accountVerify.subject);
    assert.ok(stored.html.includes('href="https://prestij.test/en/account/verify?token=xyz"'));
    assert.ok(stored.html.includes("Jane &lt;b&gt;"));
    assert.ok(stored.text.includes("https://prestij.test/en/account/verify?token=xyz"));
    assert.equal(stored.relatedType, "user");
    assert.equal(stored.relatedId, "corecomms-user-1");
    assert.equal(stored.createdBy, "corecomms-actor");
    assert.equal(stored.attempts, 0);
    assert.equal(stored.headers, null, "transactional mails carry no List-Unsubscribe");
    assert.equal(stored.sendAfter.toISOString(), FUTURE.toISOString());
  });

  test("a duplicate dedupe key is a no-op that returns null", async () => {
    const key = `${PREFIX}dedupe:1`;
    const first = await db.transaction((tx) => enqueueEmail(tx, { template: "account_verify", to: to("dedupe"), locale: "tr", data: verifyData(), sendAfter: FUTURE, dedupeKey: key }));
    const second = await db.transaction((tx) => enqueueEmail(tx, { template: "account_verify", to: to("dedupe"), locale: "tr", data: verifyData(), sendAfter: FUTURE, dedupeKey: key }));
    assert.ok(first);
    assert.equal(second, null);
    const rows = await db.select({ id: t.id }).from(t).where(eq(t.dedupeKey, key));
    assert.equal(rows.length, 1);
  });

  test("two transactions racing on one dedupe key queue exactly one mail", async () => {
    const key = `${PREFIX}dedupe:race`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => db.transaction((tx) => enqueueEmail(tx, { template: "account_verify", to: to("race"), locale: "tr", data: verifyData(), sendAfter: FUTURE, dedupeKey: key }))),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await db.select({ id: t.id }).from(t).where(eq(t.dedupeKey, key))).length, 1);
  });

  test("a template switched off in the panel is a no-op (settings read through the transaction)", async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        const [current] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "emails"));
        const value = { ...((current?.value as Record<string, unknown>) ?? {}), templates: { account_verify: { enabled: false } } };
        await tx
          .insert(schema.settings)
          .values({ key: "emails", value })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
        const row = await enqueueEmail(tx, { template: "account_verify", to: to("disabled"), locale: "tr", data: verifyData(), sendAfter: FUTURE });
        assert.equal(row, null);
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal((await db.select({ id: t.id }).from(t).where(eq(t.toEmail, to("disabled")))).length, 0);
  });

  test("an invalid recipient is stored as failed (visible in the log), not sent", async () => {
    const row = await db.transaction((tx) => enqueueEmail(tx, { template: "account_verify", to: `${PREFIX}bad\r\nbcc@test.local`, locale: "tr", data: verifyData(), sendAfter: FUTURE }));
    assert.ok(row);
    assert.equal(row.status, "failed");
    const [stored] = await db.select().from(t).where(eq(t.id, row.id));
    assert.equal(stored.lastError, "Geçersiz alıcı adresi.");
  });

  test("unknown templates and marketing mails without unsubscribe links throw", async () => {
    await assert.rejects(db.transaction((tx) => enqueueEmail(tx, { template: "nope" as TemplateKey, to: to("x"), locale: "tr", data: {} as never })), /Unknown e-mail template/);
    await assert.rejects(db.transaction((tx) => enqueueEmail(tx, { template: MARKETING_KEY, to: to("x"), locale: "tr", data: { name: "A" } as never })), /unsubscribe/);
  });

  test("marketing mails store List-Unsubscribe headers and the footer link", async () => {
    const links = newsletterUnsubscribeLinks(424242, "tr");
    const row = await db.transaction((tx) => enqueueEmail(tx, { template: MARKETING_KEY, to: to("marketing"), locale: "tr", data: { name: "Ayşe" } as never, sendAfter: FUTURE, unsubscribe: links }));
    assert.ok(row);
    const [stored] = await db.select().from(t).where(eq(t.id, row.id));
    assert.deepEqual(stored.headers, { "List-Unsubscribe": `<${links.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    assert.ok(stored.html.includes(links.url.replace(/&/g, "&amp;")));
    assert.equal(stored.subject, "Yeni kokular, Ayşe");
    const token = new URL(links.oneClickUrl).searchParams.get("t");
    assert.equal(readNewsletterUnsubscribeToken(token), 424242);
    assert.equal(readNewsletterUnsubscribeToken(`${token}x`), null);
  });

  test("scheduleEmailFlush is a safe no-op outside a request", () => {
    assert.equal(scheduleEmailFlush(), false);
  });
});

describe("flushEmailQueue", () => {
  test("marks rows sent, re-queues failures with backoff and fails them after 5 attempts", async () => {
    const ok = await queueFuture("flush-ok");
    const bad = await queueFuture("flush-bad");
    const failing = (m: OutgoingEmail) => (m.id === bad ? Object.assign(new Error(`550 <${to("flush-bad")}> rejected by smtps://user:secret@mail.example`), { responseCode: 550, code: "EENVELOPE" }) : null);

    const first = fakeDriver({ fail: failing });
    const r1 = await flushEmailQueue({ ids: [ok, bad], now: at(1), driver: first.driver });
    assert.deepEqual(r1, { claimed: 2, sent: 1, retried: 1, failed: 0, notConfigured: 0 });
    assert.deepEqual(first.sent.map((m) => m.id), [ok]);
    assert.equal(first.sent[0].to, to("flush-ok"));
    assert.ok(first.sent[0].from.includes("@"), "From header built at send time");

    const [sentRow] = await db.select().from(t).where(eq(t.id, ok));
    assert.equal(sentRow.status, "sent");
    assert.ok(sentRow.sentAt);
    assert.equal(sentRow.attempts, 1);
    const [retryRow] = await db.select().from(t).where(eq(t.id, bad));
    assert.equal(retryRow.status, "queued");
    assert.equal(retryRow.attempts, 1);
    assert.equal(retryRow.sendAfter.toISOString(), at(2).toISOString(), "1st retry after 1 minute");
    assert.ok(retryRow.lastError?.includes("EENVELOPE") && retryRow.lastError.includes("550"));
    assert.ok(!retryRow.lastError?.includes("secret") && !retryRow.lastError?.includes(to("flush-bad")), "no credentials or addresses in last_error");

    // Not due yet (send_after = +2 min): nothing happens at +1.5 min.
    const early = await flushEmailQueue({ ids: [bad], now: new Date(at(1).getTime() + 30_000), driver: fakeDriver({ fail: failing }).driver });
    assert.equal(early.claimed, 0);

    // 2nd, 3rd, 4th failures: 5, 15, 60 minutes.
    let clock = 2;
    for (const wait of [5, 15, 60]) {
      const r = await flushEmailQueue({ ids: [bad], now: at(clock), driver: fakeDriver({ fail: failing }).driver });
      assert.equal(r.retried, 1);
      const [row] = await db.select().from(t).where(eq(t.id, bad));
      assert.equal(row.sendAfter.toISOString(), at(clock + wait).toISOString(), `retry after ${wait} minutes`);
      clock += wait;
    }
    // 5th failure: failed for good.
    const last = await flushEmailQueue({ ids: [bad], now: at(clock), driver: fakeDriver({ fail: failing }).driver });
    assert.deepEqual(last, { claimed: 1, sent: 0, retried: 0, failed: 1, notConfigured: 0 });
    const [failedRow] = await db.select().from(t).where(eq(t.id, bad));
    assert.equal(failedRow.status, "failed");
    assert.equal(failedRow.attempts, 5);
    // A sent or failed row is never claimed again.
    const again = await flushEmailQueue({ ids: [ok, bad], now: at(clock + 1000), driver: fakeDriver().driver });
    assert.equal(again.claimed, 0);
  });

  test("two concurrent flushes never send a row twice", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(await queueFuture(`concurrent-${i}`));
    const shared = fakeDriver({ delayMs: 15 });
    const results = await Promise.all([
      flushEmailQueue({ ids, now: at(1), driver: shared.driver, limit: 5 }),
      flushEmailQueue({ ids, now: at(1), driver: shared.driver, limit: 5 }),
      flushEmailQueue({ ids, now: at(1), driver: shared.driver, limit: 5 }),
    ]);
    // Anything left (all three may have started before any claim) goes in a final round.
    await flushEmailQueue({ ids, now: at(1), driver: shared.driver, limit: 50 });
    const sentIds = shared.sent.map((m) => m.id);
    assert.equal(new Set(sentIds).size, sentIds.length, "no duplicates");
    assert.deepEqual([...sentIds].sort((a, b) => a - b), [...ids].sort((a, b) => a - b), "every row sent once");
    assert.equal(results.reduce((n, r) => n + r.claimed, 0) <= 12, true);
    const rows = await db.select({ status: t.status, attempts: t.attempts }).from(t).where(inArray(t.id, ids));
    assert.ok(rows.every((r) => r.status === "sent" && r.attempts === 1), "each row claimed exactly once");
  });

  test("a row stuck in 'sending' (crashed sender) is claimed again after 10 minutes", async () => {
    const id = await queueFuture("stale");
    // Staleness is measured in real time since the claim (the test clock `now` only moves send_after).
    await db.execute(sql`update email_messages set status = 'sending', attempts = 1, updated_at = now() - interval '9 minutes' where id = ${id}`);
    const tooSoon = await flushEmailQueue({ ids: [id], now: at(1), driver: fakeDriver().driver });
    assert.equal(tooSoon.claimed, 0, "a fresh claim (9 minutes) is left alone");
    await db.execute(sql`update email_messages set updated_at = now() - interval '11 minutes' where id = ${id}`);
    const later = fakeDriver();
    const r = await flushEmailQueue({ ids: [id], now: at(1), driver: later.driver });
    assert.equal(r.sent, 1);
    const [row] = await db.select().from(t).where(eq(t.id, id));
    assert.equal(row.status, "sent");
    assert.equal(row.attempts, 2);
  });

  test("without a driver nothing is claimed (production without SMTP keeps mails queued)", async () => {
    const id = await queueFuture("nodriver");
    const r = await flushEmailQueue({ ids: [id], now: at(1), driver: null });
    assert.deepEqual(r, { claimed: 0, sent: 0, retried: 0, failed: 0, notConfigured: 1 });
    const [row] = await db.select().from(t).where(eq(t.id, id));
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
  });

  test("the outbox driver writes .html, .txt and a .json header file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corecomms-outbox-"));
    tempDirs.push(dir);
    const id = await queueFuture("outbox");
    const r = await flushEmailQueue({ ids: [id], now: at(1), driver: createOutboxDriver({ dir }) });
    assert.equal(r.sent, 1);
    const files = readdirSync(dir).filter((f) => f.endsWith(`-account_verify-${id}.html`) || f.endsWith(`-account_verify-${id}.txt`) || f.endsWith(`-account_verify-${id}.json`));
    assert.equal(files.length, 3, files.join(", "));
    const header = JSON.parse(readFileSync(path.join(dir, files.find((f) => f.endsWith(".json"))!), "utf8"));
    assert.equal(header.to, to("outbox"));
    assert.equal(header.id, id);
    assert.equal(header.template, "account_verify");
    assert.ok(/^\d{8}T\d{9}Z-account_verify-\d+\.html$/.test(files.find((f) => f.endsWith(".html"))!), "timestamp-template-id naming");
  });

  test("sendErrorReason keeps codes and masks URLs and addresses", () => {
    assert.equal(sendErrorReason(Object.assign(new Error("Invalid login: 535 for smtps://u:p@h.example and a@b.example"), { code: "EAUTH", responseCode: 535 })), "EAUTH 535 Invalid login: 535 for <url> and <adres>");
    assert.equal(sendErrorReason(null), "Gönderilemedi");
  });
});

describe("panel helpers", () => {
  test("cancelQueuedEmail cancels queued rows only; requeueEmail copies a stored mail", async () => {
    // A non-account template: password reset / verification mails are never re-sent from a stored copy.
    const queued = await db.transaction((tx) =>
      enqueueEmail(tx, {
        template: "password_changed",
        to: to("cancel"),
        locale: "tr",
        data: { name: "Ayşe", changedAt: new Date().toISOString(), resetUrl: "https://prestij.test/tr/hesap/sifremi-unuttum", via: "reset" },
        sendAfter: FUTURE,
      }),
    );
    assert.ok(queued);
    const id = queued.id;
    assert.equal(await db.transaction((tx) => cancelQueuedEmail(tx, id)), true);
    assert.equal(await db.transaction((tx) => cancelQueuedEmail(tx, id)), false, "already cancelled");
    const [cancelled] = await db.select().from(t).where(eq(t.id, id));
    assert.equal(cancelled.status, "cancelled");

    const copy = await db.transaction((tx) => requeueEmail(tx, id, { createdBy: "corecomms-actor" }));
    assert.ok(copy && copy.id !== id);
    // Keep the copy away from other agents' flushes before checking it.
    await db.update(t).set({ sendAfter: FUTURE }).where(eq(t.id, copy.id));
    const [stored] = await db.select().from(t).where(eq(t.id, copy.id));
    assert.equal(stored.subject, cancelled.subject);
    assert.equal(stored.html, cancelled.html);
    assert.equal(stored.createdBy, "corecomms-actor");
    assert.equal(stored.dedupeKey, null);
    assert.equal(await db.transaction((tx) => requeueEmail(tx, 2_000_000_000)), null);
  });

  test("account link mails: the log never shows the token, they are never re-sent from it, and the sent copy is scrubbed", async () => {
    const token = "Rk7tq2ZsPwXy9LmN4bVc8aDe";
    const url = `https://prestij.test/tr/hesap/sifre-sifirla?token=${token}`;
    const queued = await db.transaction((tx) =>
      enqueueEmail(tx, { template: "password_reset", to: to("redact"), locale: "tr", data: { name: "Ayşe", url }, sendAfter: FUTURE, related: { type: "user", id: `${PREFIX}redact` } }),
    );
    assert.ok(queued);
    const [stored] = await db.select().from(t).where(eq(t.id, queued.id));
    assert.ok(stored.html.includes(token) && stored.text.includes(token), "the queued body still carries the live link (the driver needs it)");

    const shown = await getEmailMessage(db, queued.id);
    assert.ok(shown);
    assert.equal(shown.redacted, true);
    assert.equal(shown.authLink, true);
    assert.ok(!shown.html.includes(token) && !shown.text.includes(token), "the panel never receives the token");
    assert.ok(shown.html.includes(`token=${REDACTED_VALUE}`));

    // "Tekrar gönder" refuses account link mails (panel service and the core helper).
    await db.update(t).set({ status: "failed" }).where(eq(t.id, queued.id));
    await assert.rejects(
      db.transaction((tx) => resendEmailMessage(tx, queued.id, "corecomms-actor")),
      (e: unknown) => e instanceof PanelError && e.code === "invalid",
    );
    assert.equal(await db.transaction((tx) => requeueEmail(tx, queued.id)), null);
    assert.equal((await db.select().from(t).where(eq(t.toEmail, to("redact")))).length, 1, "no copy was queued");

    // Once sent, the stored copy keeps no usable link; the driver got the real one.
    await db.update(t).set({ status: "queued" }).where(eq(t.id, queued.id));
    const { driver, sent } = fakeDriver();
    const r = await flushEmailQueue({ ids: [queued.id], now: at(1), driver });
    assert.equal(r.sent, 1);
    assert.ok(sent[0].html.includes(token) && sent[0].text.includes(token), "the customer still gets the working link");
    const [after] = await db.select().from(t).where(eq(t.id, queued.id));
    assert.equal(after.status, "sent");
    assert.ok(!after.html.includes(token) && !after.text.includes(token), "the sent row is scrubbed");
    const scrubbed = await getEmailMessage(db, queued.id);
    assert.ok(scrubbed?.redacted, "the log still says the links are hidden");

    // Other mails keep their stored body (needed for "Tekrar gönder"), but the log still hides their secret links.
    const order = await db.transaction((tx) =>
      enqueueEmail(tx, {
        template: "password_changed",
        to: to("redact"),
        locale: "tr",
        data: { name: "Ayşe", changedAt: new Date().toISOString(), resetUrl: "https://prestij.test/tr/siparis/PR-261001?t=0c4bd1f2-55aa-4c3e-9f00-6a1b2c3d4e5f", via: "reset" },
        sendAfter: FUTURE,
      }),
    );
    assert.ok(order);
    const view = await getEmailMessage(db, order.id);
    assert.ok(view && view.redacted && !view.authLink);
    assert.ok(!view.html.includes("0c4bd1f2-55aa-4c3e-9f00-6a1b2c3d4e5f"));
  });

  test("test sends: editors only to themselves or the notification recipients, everyone at most TEST_SEND_RULE per hour", async () => {
    const editor = { userId: `${PREFIX}editor`, email: to("editor"), role: "editor" as const };
    const admin = { userId: `${PREFIX}admin`, email: to("admin"), role: "admin" as const };
    try {
      await assert.rejects(
        db.transaction((tx) => guardTestSend(tx, editor, "someone@example.com")),
        (e: unknown) => e instanceof PanelError && e.code === "invalid" && Boolean(e.fieldErrors?.to),
      );
      await db.transaction((tx) => guardTestSend(tx, editor, to("editor").toUpperCase()));
      const recipients = await adminRecipients();
      if (recipients[0]) await db.transaction((tx) => guardTestSend(tx, editor, recipients[0]));
      await db.transaction((tx) => guardTestSend(tx, admin, "someone@example.com"));
      for (let i = 1; i < TEST_SEND_RULE.limit; i++) await db.transaction((tx) => guardTestSend(tx, admin, "someone@example.com"));
      await assert.rejects(
        db.transaction((tx) => guardTestSend(tx, admin, "someone@example.com")),
        (e: unknown) => e instanceof PanelError && /Saatte en fazla/.test(e.message),
      );
    } finally {
      await forgetLimits([testSendLimitKey(editor.userId), testSendLimitKey(admin.userId)]);
    }
  });

  test("renderEmailPreview uses the sample data and unsaved overrides", async () => {
    const preview = await renderEmailPreview("password_reset", "ar", { subject: "معاينة {name}" });
    assert.ok(preview);
    assert.equal(preview.subject, "معاينة Ayşe");
    assert.ok(preview.html.includes('dir="rtl"'));
    assert.equal(await renderEmailPreview("nope", "tr"), null);
    const marketing = await renderEmailPreview(MARKETING_KEY, "tr");
    assert.ok(marketing?.html.includes("/bulten/ayril?t="), "marketing previews show the unsubscribe link");
  });

  test("sendTestEmail queues the sample (with unsaved overrides) under a [Test] subject", async () => {
    assert.deepEqual(await sendTestEmail("account_verify", "not-an-email", "tr"), { ok: false, error: "Geçerli bir e-posta adresi girin." });
    assert.deepEqual(await sendTestEmail("nope", to("test"), "tr"), { ok: false, error: "Bilinmeyen e-posta şablonu." });
    const result = await sendTestEmail("account_verify", to("test"), "en", { createdBy: "corecomms-actor", overrides: { subject: "Draft {name}" } });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await db.update(t).set({ sendAfter: FUTURE }).where(and(eq(t.id, result.id), eq(t.status, "queued")));
    const [row] = await db.select().from(t).where(eq(t.id, result.id));
    assert.equal(row.subject, "[Test] Draft Ayşe");
    assert.equal(row.relatedType, "test");
    assert.equal(row.relatedId, "account_verify");
    assert.equal(row.locale, "en");
  });

  test("adminRecipients: valid, de-duplicated list from settings, else general.email", async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        const upsert = async (key: string, value: Record<string, unknown>) => {
          const [current] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, key));
          const next = { ...((current?.value as Record<string, unknown>) ?? {}), ...value };
          await tx.insert(schema.settings).values({ key, value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
        };
        await upsert("general", { email: "info@prestij.test" });
        await upsert("emails", { adminRecipients: [" Siparis@prestij.test ", "siparis@prestij.test", "not an email", "muhasebe@prestij.test"] });
        assert.deepEqual(await adminRecipients(tx), ["Siparis@prestij.test", "muhasebe@prestij.test"]);
        await upsert("emails", { adminRecipients: [] });
        assert.deepEqual(await adminRecipients(tx), ["info@prestij.test"]);
        throw new Error("rollback");
      }),
      /rollback/,
    );
  });
});

describe("Better Auth mail hooks", () => {
  const user = { id: `${PREFIX}auth-user`, email: to("auth"), name: "Ayşe Yılmaz", locale: "ar" };

  test("links come from the callback's locale and safe return path, else the user's locale", () => {
    const verifyUrl = (cb: string) => `http://localhost:3000/api/auth/verify-email?token=jwt&callbackURL=${encodeURIComponent(cb)}`;
    assert.deepEqual(linkContext(verifyUrl("/en/account/verify?sonra=%2Fen%2Fcheckout"), user), { locale: "en", sonra: "/en/checkout" });
    assert.deepEqual(linkContext(verifyUrl("/"), user), { locale: "ar", sonra: null });
    assert.deepEqual(linkContext(verifyUrl("/tr/hesap/dogrula?sonra=https%3A%2F%2Fevil.example"), user), { locale: "tr", sonra: null });
    assert.deepEqual(linkContext(verifyUrl("https://evil.example/en/x"), { ...user, locale: undefined }), { locale: "tr", sonra: null });
    assert.equal(greetingName(user), "Ayşe");
    assert.equal(greetingName({ id: "x", email: "jane@test.local", name: " " }), "jane");
  });

  test("verification and reset mails are queued in the right language and throttled per user", async () => {
    const cb = encodeURIComponent("/en/account/verify?sonra=/en/checkout");
    await sendVerificationMail(user, `http://localhost:3000/api/auth/verify-email?token=jwt.part.sig&callbackURL=${cb}`, "jwt.part.sig");
    await sendVerificationMail(user, `http://localhost:3000/api/auth/verify-email?token=jwt.part.sig&callbackURL=${cb}`, "jwt.part.sig");
    await sendPasswordResetMail(user, "http://localhost:3000/api/auth/reset-password/tok123?callbackURL=", "tok123");
    // Keep them away from other agents' flushes (they were queued for now).
    await db.update(t).set({ sendAfter: FUTURE }).where(and(eq(t.toEmail, to("auth")), eq(t.status, "queued")));

    const rows = await db.select().from(t).where(eq(t.toEmail, to("auth")));
    const verify = rows.filter((r) => r.template === "account_verify");
    const reset = rows.filter((r) => r.template === "password_reset");
    assert.equal(verify.length, 1, "the second verification mail within 2 minutes is deduplicated");
    assert.equal(reset.length, 1);
    assert.equal(verify[0].locale, "en");
    assert.ok(verify[0].html.includes("/en/account/verify?token=jwt.part.sig&amp;sonra=%2Fen%2Fcheckout"));
    assert.ok(verify[0].html.includes("Ayşe"));
    assert.equal(verify[0].relatedType, "user");
    assert.equal(verify[0].relatedId, user.id);
    assert.equal(reset[0].locale, "ar", "no callback locale → the user's saved locale");
    assert.ok(reset[0].text.includes("/ar/account/reset-password?token=tok123"));
    assert.equal(reset[0].subject, defaultMessages.ar.email.passwordReset.subject);
  });
});
