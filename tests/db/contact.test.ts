// SITE-PAGES against the local PostgreSQL: the public contact form (store, honeypot, validation, rate
// limits per IP and per e-mail) and the panel inbox (list/filter/search, read state, mark all read,
// delete without personal data in the audit). Every message and audit row it creates is removed again,
// the id sequences are put back, and the final hook checks the row counts.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/contact.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { submitContactForm } from "@/lib/contact/service";
import { CONTACT_RULES, contactLimitKeys } from "@/lib/contact/throttle";
import { INITIAL_CONTACT_STATE } from "@/lib/contact/types";
import { executePanelAction } from "@/lib/panel/action-core";
import {
  deleteMessageSchema,
  markAllMessagesReadSchema,
  runDeleteMessage,
  runMarkAllMessagesRead,
  runSetMessageRead,
  setMessageReadSchema,
} from "@/lib/panel/messages/definitions";
import { countUnreadMessages, getContactMessage, listContactMessages, listRecentMessages } from "@/lib/panel/messages/queries";
import { resetRateLimits } from "@/lib/rate-limit";
import { forgetLimits } from "@/lib/rate-limit-store";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "sitepages-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Site Pages Test", email: "sitepages@test.local", role: "staff", banned: false },
  session: { id: "sitepages-test-session" },
  staffRole: "staff",
} as unknown as StaffSession;

/** Every message this file creates uses an e-mail under this prefix. */
const PREFIX = "sitepages-test-";
const email = (n: number | string) => `${PREFIX}${n}@test.local`;
const m = schema.contactMessages;

const form = (overrides: Record<string, string> = {}) => ({
  name: "Sitepages Test Kişi",
  email: email("base"),
  phone: "0532 000 00 00",
  subject: "quote",
  message: "Otelimiz için 5 L ve 20 L bidon fiyatı rica ediyoruz.",
  locale: "tr",
  website: "",
  ...overrides,
});

let counts: Record<string, number>;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];

async function countRows() {
  const out: Record<string, number> = {};
  for (const t of ["contact_messages", "audit_log"]) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of ["contact_messages", "audit_log"]) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

/** Puts the id sequences back unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

/** email_messages id before the run: contact_message mails queued by this file have higher ids. */
let emailIdBefore: number | null = null;

async function cleanup() {
  // Day 4 (REQUESTS): each stored message queues contact_message admin mails (when admin recipients are
  // set). Remove the ones of this file's messages, also those whose message a test already deleted.
  await db.execute(
    sql`delete from email_messages where related_type = 'contact' and related_id in (select id::text from contact_messages where email like ${`${PREFIX}%`})`,
  );
  if (emailIdBefore !== null) {
    await db.execute(
      sql`delete from email_messages where related_type = 'contact' and id > ${emailIdBefore} and related_id not in (select id::text from contact_messages)`,
    );
  }
  await db.delete(m).where(like(m.email, `${PREFIX}%`));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

const myMessages = () => db.select().from(m).where(like(m.email, `${PREFIX}%`));

/** Every client IP and e-mail the submission tests use: their durable rate-limit counters are forgotten. */
const TEST_IPS = [
  ...["10", "11", "12", "13", "20", "21"].map((n) => `203.0.113.${n}`),
  ...Array.from({ length: 20 }, (_, i) => `198.51.100.${i + 1}`),
  "198.51.100.200",
  "198.51.100.201",
];
const TEST_EMAILS = [1, "base", "fd", "bot", "ip-0", "ip-1", "ip-2", "ip-3", "ip-4", "ip-x", "ip-y", "ip-z", "daily"].map(email);
async function forgetContactLimits() {
  resetRateLimits();
  const keys = [
    ...TEST_IPS.flatMap((ip) => contactLimitKeys({ ip, email: null })),
    ...TEST_EMAILS.flatMap((address) => contactLimitKeys({ ip: TEST_IPS[0], email: address })),
  ].map(([key]) => key);
  await forgetLimits(keys);
}

before(async () => {
  const [{ max }] = await db.execute<{ max: string | null }>(sql`select max(id)::text as max from email_messages`);
  emailIdBefore = Number(max ?? 0);
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
});

beforeEach(() => forgetContactLimits());

after(async () => {
  await cleanup();
  await restoreSequences();
  await forgetContactLimits();
  try {
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
  } finally {
    await db.$client.end();
  }
});

describe("contact form submission", () => {
  test("stores a valid message with its locale, subject and normalized phone", async () => {
    const { state, messageId } = await submitContactForm(form({ email: " SitePages-Test-1@Test.Local ", locale: "ar" }), {
      ip: "203.0.113.10",
      prev: INITIAL_CONTACT_STATE,
    });
    assert.equal(state.status, "success");
    assert.equal(state.attempt, 1);
    assert.equal(state.values, undefined, "nothing is echoed after success");
    assert.ok(messageId);
    const [row] = await db.select().from(m).where(eq(m.id, messageId));
    assert.equal(row.email, email(1));
    assert.equal(row.locale, "ar");
    assert.equal(row.subject, "quote");
    assert.equal(row.phone, "+905320000000");
    assert.equal(row.isRead, false);
  });

  test("a FormData submission works the same way", async () => {
    const data = new FormData();
    for (const [k, v] of Object.entries(form({ email: email("fd"), subject: "sample" }))) data.set(k, v);
    const { state, messageId } = await submitContactForm(data, { ip: "203.0.113.11" });
    assert.equal(state.status, "success");
    const [row] = await db.select({ subject: m.subject }).from(m).where(eq(m.id, messageId!));
    assert.equal(row.subject, "sample");
  });

  test("honeypot: pretends success and stores nothing", async () => {
    const before = (await myMessages()).length;
    const { state, messageId } = await submitContactForm(form({ email: email("bot"), website: "https://spam.example" }), { ip: "203.0.113.12" });
    assert.equal(state.status, "success");
    assert.equal(messageId, null);
    assert.equal((await myMessages()).length, before);
  });

  test("invalid input: field error codes, values echoed, nothing stored", async () => {
    const before = (await myMessages()).length;
    const { state, messageId } = await submitContactForm(form({ email: "not-an-email", message: "kısa", name: "" }), {
      ip: "203.0.113.13",
      prev: { status: "error", attempt: 3 },
    });
    assert.equal(messageId, null);
    assert.equal(state.status, "error");
    assert.equal(state.error, "invalid");
    assert.equal(state.attempt, 4);
    assert.deepEqual(state.fieldErrors, { name: "required", email: "invalid_email", message: "too_short" });
    assert.equal(state.values?.email, "not-an-email");
    assert.equal((await myMessages()).length, before);
  });

  test(`rate limit: ${CONTACT_RULES.ip.limit} per hour per IP`, async () => {
    const ip = "203.0.113.20";
    const t0 = Date.parse("2026-11-09T10:00:00Z");
    for (let i = 0; i < CONTACT_RULES.ip.limit; i++) {
      const { state } = await submitContactForm(form({ email: email(`ip-${i}`) }), { ip, now: t0 + i * 60_000 });
      assert.equal(state.status, "success", `message ${i + 1} goes through`);
    }
    const blocked = await submitContactForm(form({ email: email("ip-x") }), { ip, now: t0 + 10 * 60_000 });
    assert.equal(blocked.state.status, "error");
    assert.equal(blocked.state.error, "too_many");
    assert.equal(blocked.messageId, null);
    assert.ok(blocked.state.retryMinutes! > 0 && blocked.state.retryMinutes! <= 60, `retry in ${blocked.state.retryMinutes} min`);
    assert.equal(blocked.state.values?.message, form().message, "the visitor keeps the text");

    const otherIp = await submitContactForm(form({ email: email("ip-y") }), { ip: "203.0.113.21", now: t0 + 10 * 60_000 });
    assert.equal(otherIp.state.status, "success", "another IP is not affected");
    const later = await submitContactForm(form({ email: email("ip-z") }), { ip, now: t0 + 61 * 60_000 });
    assert.equal(later.state.status, "success", "the window slides: the first message left it");
  });

  test(`rate limit: ${CONTACT_RULES.email.limit} per day per e-mail, across IPs`, async () => {
    const address = email("daily");
    const t0 = Date.parse("2026-11-09T08:00:00Z");
    for (let i = 0; i < CONTACT_RULES.email.limit; i++) {
      const { state } = await submitContactForm(form({ email: address }), { ip: `198.51.100.${i + 1}`, now: t0 + i * 1000 });
      assert.equal(state.status, "success", `message ${i + 1} goes through`);
    }
    const blocked = await submitContactForm(form({ email: address.toUpperCase() }), { ip: "198.51.100.200", now: t0 + 60_000 });
    assert.equal(blocked.state.error, "too_many", "the same address (any case) is blocked");
    assert.ok(blocked.state.retryMinutes! > 60, "for most of a day");
    const nextDay = await submitContactForm(form({ email: address }), { ip: "198.51.100.201", now: t0 + 24 * 60 * 60_000 + 5000 });
    assert.equal(nextDay.state.status, "success");
  });
});

describe("panel inbox", () => {
  let ids: number[] = [];

  before(async () => {
    await db.delete(m).where(like(m.email, `${PREFIX}%`));
    const rows = await db
      .insert(m)
      .values([
        { name: "Öztürk Otel", email: email("inbox-1"), phone: "+905321112233", subject: "quote", message: "20 litrelik bidon için teklif.", locale: "tr" },
        { name: "Spa Hamam", email: email("inbox-2"), phone: null, subject: "sample", message: "Lavanta numunesi rica ederiz.", locale: "en" },
        { name: "Işık Kafe", email: email("inbox-3"), phone: null, subject: "general", message: "Teslimat süresi nedir?", locale: "tr", isRead: true },
      ])
      .returning({ id: m.id });
    ids = rows.map((r) => r.id);
  });

  test("list: unread filter, subject filter, Turkish-insensitive search and counters", async () => {
    const mine = <T extends { email: string }>(rows: T[]) => rows.filter((r) => r.email.startsWith(PREFIX));
    const all = await listContactMessages({ q: PREFIX });
    assert.equal(all.total, 3);
    assert.equal(all.counts.unread, 2);
    assert.equal(all.counts.bySubject.quote, 1);
    assert.deepEqual(
      mine(all.rows).map((r) => r.id),
      [...ids].reverse(),
      "newest first",
    );

    const unread = await listContactMessages({ status: "unread", q: PREFIX });
    assert.deepEqual(unread.rows.map((r) => r.id).sort(), ids.slice(0, 2).sort());

    const samples = await listContactMessages({ subject: "sample", q: PREFIX });
    assert.deepEqual(samples.rows.map((r) => r.id), [ids[1]]);

    const folded = await listContactMessages({ q: "ozturk" });
    assert.ok(folded.rows.some((r) => r.id === ids[0]), "“ozturk” finds “Öztürk”");
    const isik = await listContactMessages({ q: "ISIK kafe" });
    assert.ok(isik.rows.some((r) => r.id === ids[2]), "“ISIK” finds “Işık”");
    const phone = await listContactMessages({ q: "1112233" });
    assert.ok(phone.rows.some((r) => r.id === ids[0]), "phone digits");
    const text = await listContactMessages({ q: "lavanta numunesi" });
    assert.ok(text.rows.some((r) => r.id === ids[1]), "message text");

    assert.ok((await countUnreadMessages()) >= 2);
    const recent = await listRecentMessages(50);
    const recentMine = recent.filter((r) => ids.includes(r.id));
    assert.equal(recentMine.at(-1)?.id, ids[2], "unread messages come before read ones");
  });

  test("read state: toggles with an audit row, a repeat changes nothing, a missing id is not_found", async () => {
    const read = await executePanelAction({ schema: setMessageReadSchema, run: runSetMessageRead }, ACTOR, { id: ids[0], isRead: true });
    assert.ok(read.result.ok);
    assert.deepEqual(read.result.ok && read.result.data, { isRead: true, changed: true });
    assert.equal((await getContactMessage(ids[0]))?.isRead, true);

    const again = await executePanelAction({ schema: setMessageReadSchema, run: runSetMessageRead }, ACTOR, { id: ids[0], isRead: true });
    assert.deepEqual(again.result.ok && again.result.data, { isRead: true, changed: false });

    const unread = await executePanelAction({ schema: setMessageReadSchema, run: runSetMessageRead }, ACTOR, { id: ids[0], isRead: false });
    assert.ok(unread.result.ok);
    assert.equal((await getContactMessage(ids[0]))?.isRead, false);

    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    const forMessage = audits.filter((a) => a.entity === "contact_message" && a.entityId === String(ids[0]));
    assert.equal(forMessage.length, 2, "one row per real change");
    assert.deepEqual(forMessage.map((a) => a.after).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [{ isRead: false }, { isRead: true }]);

    const missing = await executePanelAction({ schema: setMessageReadSchema, run: runSetMessageRead }, ACTOR, { id: 2_000_000_000, isRead: true });
    assert.equal(!missing.result.ok && missing.result.code, "not_found");
  });

  test("mark all read stops at the newest message the user saw", async () => {
    const [late] = await db
      .insert(m)
      .values({ name: "Geç Gelen", email: email("inbox-late"), subject: "other", message: "Sonradan gelen mesaj.", locale: "tr" })
      .returning({ id: m.id });
    const { result } = await executePanelAction({ schema: markAllMessagesReadSchema, run: runMarkAllMessagesRead }, ACTOR, { maxId: late.id - 1 });
    assert.ok(result.ok);
    const rows = await db.select({ id: m.id, isRead: m.isRead }).from(m).where(inArray(m.id, [...ids, late.id]));
    const state = Object.fromEntries(rows.map((r) => [r.id, r.isRead]));
    assert.deepEqual([state[ids[0]], state[ids[1]], state[ids[2]]], [true, true, true]);
    assert.equal(state[late.id], false, "the later message stays unread");
    await db.delete(m).where(eq(m.id, late.id));
  });

  test("delete: row gone, audit keeps no personal data", async () => {
    const { result } = await executePanelAction({ schema: deleteMessageSchema, run: runDeleteMessage }, ACTOR, { id: ids[1] });
    assert.ok(result.ok);
    assert.equal(await getContactMessage(ids[1]), null);
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, ACTOR_ID), eq(schema.auditLog.entity, "contact_message"), eq(schema.auditLog.entityId, String(ids[1]))));
    assert.equal(audit.action, "delete");
    const stored = JSON.stringify(audit.before);
    for (const secret of ["Spa Hamam", email("inbox-2"), "Lavanta numunesi"]) assert.ok(!stored.includes(secret), `audit has no "${secret}"`);
    assert.equal((audit.before as { subject: string }).subject, "sample");

    const again = await executePanelAction({ schema: deleteMessageSchema, run: runDeleteMessage }, ACTOR, { id: ids[1] });
    assert.equal(!again.result.ok && again.result.code, "not_found");
    const bad = await executePanelAction({ schema: deleteMessageSchema, run: runDeleteMessage }, ACTOR, { id: "abc" });
    assert.equal(!bad.result.ok && bad.result.code, "invalid");
  });
});
