// PayTR-fix IMPL-B against the local PostgreSQL (S7, the PayTR logo slot):
//   save    settings.payments.paytrLogoImageId goes through the panel's settings save: a media id that does not
//           exist or is a video is refused on that field; an image is stored, and the audit entry names the field.
//   usage   the media library sees the reference ("Ayarlar › Ödeme yöntemleri", "PayTR logosu"), so the logo cannot
//           be deleted while it is in use; with no logo picked, nothing references it.
// The storefront rule, the notice and the samples filter are pure: tests/unit/paytr-fix-b.test.ts.
//
// Shared database: the media rows and the payments settings change are written inside transactions that are rolled
// back (one per test); the sequences those inserts advanced are put back afterwards. Media rows use a folder named
// after this run, so they can never meet the owner's library.
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/paytr-fix-b.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { PanelError } from "@/lib/panel/errors";
import { collectMediaUsage, mediaUsage } from "@/lib/panel/media/queries";
import { readSettingsRow, saveSettings } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const FOLDER = `paytr-fix-b-${randomUUID().slice(0, 8)}`;
let seqs: SequenceSnapshot;
let settingsBefore: string;

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

async function expectFieldError(promise: Promise<unknown>, field: string, message: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PanelError, String(error));
    assert.equal(error.code, "invalid");
    assert.match(error.fieldErrors?.[field] ?? "", message);
    return true;
  });
}

const media = async (tx: Tx, name: string, kind: "image" | "video") => {
  const mime = kind === "video" ? "video/mp4" : "image/png";
  const [row] = await tx
    .insert(schema.media)
    .values({ storageKey: `${FOLDER}/${name}`, url: `/uploads/${FOLDER}/${name}`, mime, kind, folder: FOLDER })
    .returning({ id: schema.media.id });
  return row.id;
};

const settingsRows = async () => JSON.stringify(await db.select().from(schema.settings).orderBy(schema.settings.key));

before(async () => {
  seqs = await snapshotSequences();
  settingsBefore = await settingsRows();
});

after(async () => {
  await restoreSequences(seqs);
  assert.equal(await settingsRows(), settingsBefore, "the settings rows are unchanged");
  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.media).where(eq(schema.media.folder, FOLDER));
  assert.equal(left.n, 0, "no test media left");
});

describe("S7: the PayTR logo setting", () => {
  test("a missing image or a video is refused on the field; an image is saved and audited", async () => {
    await inRollback(async (tx) => {
      const row = await readSettingsRow("payments", tx);
      const updatedAt = row.updatedAt ? new Date(row.updatedAt) : null;
      assert.equal(row.value.paytrLogoImageId, null, "nothing picked today");

      const [max] = await tx.select({ m: sql<number>`coalesce(max(id), 0)::int` }).from(schema.media);
      await expectFieldError(saveSettings(tx, "payments", { value: { ...row.value, paytrLogoImageId: max.m + 1000 }, updatedAt }), "paytrLogoImageId", /artık kütüphanede yok/);

      const video = await media(tx, "clip.mp4", "video");
      await expectFieldError(saveSettings(tx, "payments", { value: { ...row.value, paytrLogoImageId: video }, updatedAt }), "paytrLogoImageId", /./);

      const logo = await media(tx, "paytr-logo.png", "image");
      const saved = await saveSettings(tx, "payments", { value: { ...row.value, paytrLogoImageId: logo }, updatedAt });
      assert.equal(saved.value.paytrLogoImageId, logo);
      assert.deepEqual(saved.audit.before, { paytrLogoImageId: null }, "only the logo changed");
      assert.deepEqual(saved.audit.after, { paytrLogoImageId: logo });
      assert.deepEqual(saved.value.card, row.value.card, "the card settings are untouched");
      assert.equal((await readSettingsRow("payments", tx)).value.paytrLogoImageId, logo, "read back");
    });
  });

  test("the media library lists the reference, so the logo cannot be deleted while it is in use", async () => {
    await inRollback(async (tx) => {
      const logo = await media(tx, "paytr-logo.png", "image");
      assert.deepEqual(await mediaUsage(logo, tx), [], "not referenced before it is picked");

      const row = await readSettingsRow("payments", tx);
      await saveSettings(tx, "payments", { value: { ...row.value, paytrLogoImageId: logo }, updatedAt: row.updatedAt ? new Date(row.updatedAt) : null });
      const usage = (await collectMediaUsage([logo], tx)).get(logo) ?? [];
      assert.deepEqual(usage, [{ kind: "settings", label: "Ayarlar › Ödeme yöntemleri", detail: "PayTR logosu", href: "/panel/ayarlar/odeme" }]);
    });
  });
});
