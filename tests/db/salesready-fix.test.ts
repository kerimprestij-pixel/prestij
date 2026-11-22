// Sales-ready FIX against the local PostgreSQL:
//   F11  the profile's "E-bültene abone ol" core (profileMarketingSubscribe, what setMarketingAction runs inside its
//        transaction): with the newsletter off it answers "closed" and writes nothing (no subscriber row, no mail);
//        with it on the double opt-in starts (pending row, source "profile", one confirmation mail).
//
// Shared database: everything runs inside transactions that are rolled back (users salesready-fix-…@test.local, the
// newsletter settings row changed only inside the rollback). Every public sequence is put back afterwards (identity
// values are not rolled back).
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/salesready-fix.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { profileMarketingSubscribe } from "@/lib/account/marketing";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const TAG = `salesready-fix-${randomUUID().slice(0, 8)}`;
const EMAIL = (name: string) => `${TAG}-${name}@test.local`;

let seqs: SequenceSnapshot;

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

async function setNewsletter(tx: Tx, enabled: boolean): Promise<void> {
  const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "newsletter")).limit(1);
  const value = { ...parseSettings("newsletter", row?.value), enabled };
  await tx.insert(schema.settings).values({ key: "newsletter", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

const subscriberRows = (tx: Tx, email: string) => tx.select().from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.email, email));
const mailRows = (tx: Tx, email: string) => tx.select().from(schema.emailMessages).where(eq(schema.emailMessages.toEmail, email));

before(async () => {
  seqs = await snapshotSequences();
});

after(async () => {
  try {
    await restoreSequences(seqs);
    // Nothing was committed; this only proves it.
    const [left] = await db.execute<{ subscribers: string; mails: string }>(
      sql`select (select count(*) from newsletter_subscribers where email like ${`${TAG}-%`})::text as subscribers,
                 (select count(*) from email_messages where to_email like ${`${TAG}-%`})::text as mails`,
    );
    assert.deepEqual({ ...left }, { subscribers: "0", mails: "0" });
    const leftovers = await db.select({ id: schema.newsletterSubscribers.id }).from(schema.newsletterSubscribers).where(like(schema.newsletterSubscribers.email, "salesready-fix-%"));
    assert.equal(leftovers.length, 0);
  } finally {
    await db.$client.end();
  }
});

describe("F11: the profile's newsletter subscription core", () => {
  test("newsletter off: 'closed', no subscriber row, no mail", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, false);
      const email = EMAIL("off");
      const outcome = await profileMarketingSubscribe(tx, { email, locale: "tr", ip: "203.0.113.42", marketingConsent: false });
      assert.deepEqual(outcome, { ok: false, reason: "closed" });
      assert.deepEqual(await subscriberRows(tx, email), []);
      assert.deepEqual(await mailRows(tx, email), []);
    });
  });

  test("newsletter on: the double opt-in starts (pending, source profile, one confirmation mail)", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, true);
      const email = EMAIL("on");
      const outcome = await profileMarketingSubscribe(tx, { email, locale: "en", ip: "203.0.113.42", marketingConsent: false });
      assert.deepEqual(outcome, { ok: true, state: "pending" });
      const [sub] = await subscriberRows(tx, email);
      assert.equal(sub?.status, "pending");
      assert.equal(sub?.source, "profile");
      assert.deepEqual((await mailRows(tx, email)).map((m) => m.template), ["newsletter_confirm"]);
    });
  });

  test("newsletter on, an address the service does not accept: 'refused', nothing written", async () => {
    await inRollback(async (tx) => {
      await setNewsletter(tx, true);
      const outcome = await profileMarketingSubscribe(tx, { email: "not an address", locale: "tr", ip: null, marketingConsent: false });
      assert.deepEqual(outcome, { ok: false, reason: "refused" });
    });
  });
});
