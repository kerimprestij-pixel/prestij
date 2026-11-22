// Settings saves against the local PostgreSQL: optimistic lock on settings.updatedAt, insert when the
// key has no row, media/group/carrier reference checks, the cart reading the new values, and the Server
// Action path (top-level error paths, audit of changed fields only). Every change runs in a transaction
// that is rolled back, except one identical-value save that is undone right away.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/settings.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { executePanelAction } from "@/lib/panel/action-core";
import { PanelError } from "@/lib/panel/errors";
import { readAllSettings, readSettingsRow, saveSettings, settingsActionOptions } from "@/lib/panel/settings/service";
import { SETTINGS_INPUTS } from "@/lib/panel/settings/schemas";
import type { Tx } from "@/lib/panel/tx";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "settings-legal-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Settings Legal Test", email: "settings-legal@test.local", role: "admin", banned: false },
  session: { id: "settings-legal-test-session" },
  staffRole: "admin",
} as unknown as StaffSession;
const IBAN = "TR330006100519786457841326";
const S = schema.settings;
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

async function expectPanelError(promise: Promise<unknown>, code: string, field?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PanelError, String(error));
    assert.equal(error.code, code);
    if (field) assert.ok(error.fieldErrors?.[field], `field error at ${field}`);
    return true;
  });
}

const snapshot = async () => JSON.stringify(await db.select().from(S).orderBy(S.key));
type Seq = { last_value: string; is_called: boolean };
async function readSequence(name: string): Promise<Seq> {
  const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
}
async function restoreSequence(table: string, name: string, snap: Seq) {
  const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
  if (max === null || Number(max) <= Number(snap.last_value)) {
    await db.execute(sql`select setval(${name}::regclass, ${snap.last_value}::bigint, ${snap.is_called})`);
  }
}

let settingsBefore: string;
let auditSeq: Seq;
let orderSeq: Seq;

/** The input a settings editor sends: the stored value run through the panel schema. */
async function inputFor<K extends keyof typeof SETTINGS_INPUTS>(executor: Tx, key: K) {
  const row = await readSettingsRow(key, executor);
  return { row, value: SETTINGS_INPUTS[key].parse(row.value) as never, updatedAt: row.updatedAt ? new Date(row.updatedAt) : null };
}

before(async () => {
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
  settingsBefore = await snapshot();
  auditSeq = await readSequence("audit_log_id_seq");
  orderSeq = await readSequence("orders_id_seq");
});

after(async () => {
  try {
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    await restoreSequence("audit_log", "audit_log_id_seq", auditSeq);
    await restoreSequence("orders", "orders_id_seq", orderSeq);
    assert.equal(await snapshot(), settingsBefore, "settings rows are back to the start");
  } finally {
    await db.$client.end();
  }
});

describe("settings", () => {
  test("every stored settings document passes the panel rules (the editors open without errors)", async () => {
    const all = await readAllSettings();
    for (const [key, value] of Object.entries(all)) {
      const parsed = SETTINGS_INPUTS[key as keyof typeof SETTINGS_INPUTS].safeParse(value);
      assert.ok(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues)}`);
    }
  });

  test("a shipping save is what the cart reads next (uncached), with the audit of changed fields only", async () => {
    await inRollback(async (tx) => {
      const { value, updatedAt } = await inputFor(tx, "shipping");
      const next = { ...(value as object), flatFee: 12345 } as never;
      const saved = await saveSettings(tx, "shipping", { value: next, updatedAt });
      assert.ok(saved.updatedAt.getTime() > (updatedAt?.getTime() ?? 0));
      assert.deepEqual(Object.keys(saved.audit.after as object), ["flatFee"]);
      assert.equal(saved.audit.entity, "settings");
      assert.equal(saved.audit.entityId, "shipping");
      assert.equal((await loadCommerceSettings(tx)).shipping.flatFee, 12345);
    });
  });

  test("a bank account makes havale available in the cart's settings", async () => {
    await inRollback(async (tx) => {
      const { value, updatedAt } = await inputFor(tx, "payments");
      const v = structuredClone(value) as { bankTransfer: { enabled: boolean; accounts: unknown[] } };
      v.bankTransfer.enabled = true;
      v.bankTransfer.accounts = [{ bank: "Test Bankası (settings-legal)", holder: "PRESTİJ", iban: IBAN }];
      await saveSettings(tx, "payments", { value: v as never, updatedAt });
      const loaded = await loadCommerceSettings(tx);
      assert.deepEqual(loaded.payments.bankTransfer.accounts, [{ bank: "Test Bankası (settings-legal)", holder: "PRESTİJ", iban: IBAN }]);
    });
  });

  test("optimistic lock: a stale updatedAt is a conflict", async () => {
    await inRollback(async (tx) => {
      const { value, updatedAt } = await inputFor(tx, "seo");
      assert.ok(updatedAt);
      await expectPanelError(saveSettings(tx, "seo", { value, updatedAt: new Date(updatedAt.getTime() - 1) }), "conflict");
      await expectPanelError(saveSettings(tx, "seo", { value, updatedAt: null }), "conflict");
      await saveSettings(tx, "seo", { value, updatedAt });
      await expectPanelError(saveSettings(tx, "seo", { value, updatedAt }), "conflict");
    });
  });

  test("a key without a row is inserted on save (updatedAt null), never with a stale stamp", async () => {
    await inRollback(async (tx) => {
      const { value } = await inputFor(tx, "newsletter");
      await tx.delete(S).where(eq(S.key, "newsletter"));
      assert.equal((await readSettingsRow("newsletter", tx)).updatedAt, null);
      await expectPanelError(saveSettings(tx, "newsletter", { value, updatedAt: new Date() }), "conflict");
      await saveSettings(tx, "newsletter", { value, updatedAt: null });
      assert.ok((await readSettingsRow("newsletter", tx)).updatedAt);
    });
  });

  test("references: missing logo media, unknown customer group", async () => {
    await inRollback(async (tx) => {
      const general = await inputFor(tx, "general");
      const v = structuredClone(general.value) as { logo: { lightId: number | null } };
      v.logo.lightId = 2_000_000_000;
      await expectPanelError(saveSettings(tx, "general", { value: v as never, updatedAt: general.updatedAt }), "invalid", "logo.lightId");
    });
    await inRollback(async (tx) => {
      const b2b = await inputFor(tx, "b2b");
      await expectPanelError(
        saveSettings(tx, "b2b", { value: { ...(b2b.value as object), defaultGroupSlug: "yok-boyle-grup" } as never, updatedAt: b2b.updatedAt }),
        "invalid",
        "defaultGroupSlug",
      );
    });
  });

  test("a carrier that orders reference cannot be removed", async () => {
    await inRollback(async (tx) => {
      const { value, updatedAt } = await inputFor(tx, "shipping");
      const carriers = (value as { carriers: { key: string }[] }).carriers;
      assert.ok(carriers.length > 0);
      await tx.insert(schema.orders).values({
        orderNumber: "SL-TEST-1",
        email: "settings-legal@test.local",
        paymentMethod: "bank_transfer",
        subtotal: 1000,
        grandTotal: 1000,
        carrier: carriers[0].key,
        shippingAddress: { fullName: "Test", phone: "", city: "Kayseri", district: "Kocasinan", line1: "Test" } as never,
        invoice: { type: "individual" } as never,
      });
      await expectPanelError(
        saveSettings(tx, "shipping", { value: { ...(value as object), carriers: carriers.slice(1) } as never, updatedAt }),
        "in_use",
      );
      // Removing an unused one is fine.
      if (carriers.length > 1) await saveSettings(tx, "shipping", { value: { ...(value as object), carriers: [carriers[0]] } as never, updatedAt });
    });
  });

  test("Server Action path: top-level error paths; an identical save writes no audit row (undone)", async () => {
    const opts = settingsActionOptions("locales");
    const row = await readSettingsRow("locales");
    const bad = await executePanelAction(opts, ACTOR, { enabled: ["en"], updatedAt: row.updatedAt });
    assert.equal(bad.result.ok, false);
    if (!bad.result.ok) assert.ok(bad.result.fieldErrors?.enabled);

    const shipping = await readSettingsRow("shipping");
    const badShipping = await executePanelAction(settingsActionOptions("shipping"), ACTOR, {
      ...shipping.value,
      carriers: [{ key: "x", name: "X", trackingUrl: "https://x.example.com/takip" }],
      updatedAt: shipping.updatedAt,
    });
    assert.equal(!badShipping.result.ok && badShipping.result.fieldErrors?.["carriers.0.trackingUrl"] !== undefined, true);

    const [stored] = await db.select().from(S).where(eq(S.key, "locales"));
    try {
      const { result, tags } = await executePanelAction(opts, ACTOR, { ...row.value, updatedAt: row.updatedAt });
      assert.ok(result.ok, JSON.stringify(result));
      assert.deepEqual(tags, ["settings"]);
      assert.equal(result.ok && result.message, "Dil ayarları kaydedildi.");
      // Nothing changed: no misleading "update" row with empty before/after (day-3 review fix).
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
      assert.equal(audit.length, 0);
    } finally {
      await db.update(S).set({ value: stored.value, updatedAt: stored.updatedAt }).where(eq(S.key, "locales"));
      await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    }
  });
});
