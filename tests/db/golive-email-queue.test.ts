// Go-live CF-14: the e-mail queue claims transactional mails (verification, password reset, order mails…)
// before campaign mails, so a large campaign can never delay them. Rows are inserted directly (rendered
// content is not what is tested), due in 2036 so that only this file's flushes (with `ids` and `now`) see them,
// for golive-test-…@test.local; they are deleted afterwards and the id sequence is put back.
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { listEmailTemplates, type EmailDriver, type OutgoingEmail } from "@/lib/email";
import { CAMPAIGN_EMAIL_TEMPLATES, flushEmailQueue } from "@/lib/email/queue";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const PREFIX = "golive-test-mail-";
const t = schema.emailMessages;
const DUE = new Date("2036-03-01T00:00:00.000Z");
const minutesBefore = (n: number) => new Date(DUE.getTime() - n * 60_000);
let seqs: SequenceSnapshot;

async function insert(template: string, sendAfter: Date): Promise<number> {
  const [row] = await db
    .insert(t)
    .values({ template, toEmail: `${PREFIX}${template}@test.local`, subject: `golive ${template}`, html: "<p>x</p>", text: "x", status: "queued", sendAfter })
    .returning({ id: t.id });
  return row.id;
}

function recorder() {
  const sent: OutgoingEmail[] = [];
  const driver: EmailDriver = {
    name: "golive-test",
    async send(message) {
      sent.push(message);
      return { messageId: `golive-${message.id}` };
    },
  };
  return { driver, sent };
}

before(async () => {
  const left = await db.select({ id: t.id }).from(t).where(like(t.toEmail, `${PREFIX}%`));
  assert.equal(left.length, 0, "rows left over from an earlier run");
  seqs = await snapshotSequences();
});

after(async () => {
  await db.delete(t).where(like(t.toEmail, `${PREFIX}%`));
  await restoreSequences(seqs);
});

describe("CF-14: transactional mails first", () => {
  test("the campaign list is exactly the marketing templates", () => {
    const marketing = listEmailTemplates()
      .filter((tpl) => tpl.marketing)
      .map((tpl) => tpl.key)
      .sort();
    assert.deepEqual([...CAMPAIGN_EMAIL_TEMPLATES].sort(), marketing);
  });

  test("older campaign rows wait while a newer verification, reset or order mail goes out", async () => {
    const campaignA = await insert("newsletter_campaign", minutesBefore(60));
    const reminder = await insert("wheel_prize_reminder", minutesBefore(50));
    const verify = await insert("account_verify", minutesBefore(5));
    const reset = await insert("password_reset", minutesBefore(4));
    const order = await insert("order_paid", minutesBefore(3));
    const ids = [campaignA, reminder, verify, reset, order];

    const first = recorder();
    const r1 = await flushEmailQueue({ ids, limit: 2, now: DUE, driver: first.driver });
    assert.equal(r1.claimed, 2);
    assert.deepEqual(first.sent.map((m) => m.id), [verify, reset]);

    const second = recorder();
    const r2 = await flushEmailQueue({ ids, limit: 2, now: DUE, driver: second.driver });
    assert.deepEqual(second.sent.map((m) => m.id), [order, campaignA], "the remaining transactional row, then the oldest campaign row");
    assert.equal(r2.sent, 2);

    const third = recorder();
    await flushEmailQueue({ ids, limit: 2, now: DUE, driver: third.driver });
    assert.deepEqual(third.sent.map((m) => m.id), [reminder]);
    const rows = await db.select({ id: t.id, status: t.status }).from(t).where(inArray(t.id, ids));
    assert.ok(rows.every((r) => r.status === "sent"));
  });

  test("within one claimed batch, transactional rows are sent first", async () => {
    const campaign = await insert("newsletter_campaign", minutesBefore(30));
    const verify = await insert("account_verify", minutesBefore(1));
    const run = recorder();
    await flushEmailQueue({ ids: [campaign, verify], limit: 5, now: DUE, driver: run.driver });
    assert.deepEqual(run.sent.map((m) => m.id), [verify, campaign]);
  });
});
