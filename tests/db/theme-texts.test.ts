// THEME-TEXTS services against the local PostgreSQL. Every scenario runs inside a transaction that is
// rolled back at the end, so no row survives; the id sequences the inserts consumed are put back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/theme-texts.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { executePanelAction } from "@/lib/panel/action-core";
import { PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { themeSaveSchema } from "@/lib/panel/theme/schemas";
import { createTheme, deleteTheme, saveTheme, setDefaultTheme } from "@/lib/panel/theme/service";
import { uiStringsSaveSchema } from "@/lib/panel/ui-strings/schemas";
import { saveUiStrings } from "@/lib/panel/ui-strings/service";
import type { StaffSession } from "@/lib/session";
import { queryActiveThemeState } from "@/lib/theme/query-active-theme";

const ACTOR_ID = "theme-texts-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Theme Texts Test", email: "theme-texts@test.local", role: "editor", banned: false },
  session: { id: "theme-texts-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;

const ROLLBACK = new Error("rollback");
/** Runs `fn` in a transaction that is always rolled back. */
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

async function expectPanelError(promise: Promise<unknown>, code: string, field?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PanelError, String(error));
    assert.equal(error.code, code);
    if (field) assert.ok(error.fieldErrors?.[field], `field error at ${field}: ${JSON.stringify(error.fieldErrors)}`);
    return true;
  });
}

const SEQ_TABLES = ["themes", "campaigns", "audit_log"] as const;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];
let counts: Record<string, number> = {};

async function snapshot() {
  const seqs: SeqState[] = [];
  const n: Record<string, number> = {};
  for (const table of [...SEQ_TABLES, "ui_strings"]) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${table}`));
    n[table] = Number(rows[0].n);
  }
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    seqs.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return { seqs, n };
}

let themesBefore: unknown;

before(async () => {
  const s = await snapshot();
  sequences = s.seqs;
  counts = s.n;
  themesBefore = await db.select().from(schema.themes).orderBy(schema.themes.id);
});

after(async () => {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
  const now = await snapshot();
  assert.deepEqual(now.n, counts, "row counts unchanged");
  assert.deepEqual(await db.select().from(schema.themes).orderBy(schema.themes.id), themesBefore, "themes unchanged");
  await db.$client.end();
});

async function defaultTheme(tx: Tx) {
  const [row] = await tx.select().from(schema.themes).where(eq(schema.themes.isDefault, true));
  assert.ok(row, "a default theme exists (seed)");
  return row;
}

function savePayload(row: typeof schema.themes.$inferSelect, over: Record<string, unknown> = {}) {
  return themeSaveSchema.parse({
    id: row.id,
    name: row.name,
    colors: { brand: "#0E3B2E", accent: "#B4232C", background: "#FAF7F0", surface: "#FFFFFF", text: "#10261E" },
    dark: { brand: "", accent: "", background: "#081C15", surface: "", text: "" },
    radius: "lg",
    fonts: { heading: "manrope", body: "manrope" },
    isScheduled: false,
    schedule: { startsAt: null, endsAt: null },
    priority: 5,
    updatedAt: row.updatedAt.toISOString(),
    ...over,
  });
}

describe("theme services", () => {
  test("create copies the default, keeps slugs unique and refuses duplicate names", async () => {
    await inRolledBackTx(async (tx) => {
      const base = await defaultTheme(tx);
      const a = await createTheme(tx, { name: "Test Tema" });
      const [rowA] = await tx.select().from(schema.themes).where(eq(schema.themes.id, a.id));
      assert.equal(rowA.slug, "test-tema");
      assert.deepEqual(rowA.tokens, base.tokens);
      assert.equal(rowA.isDefault, false);
      assert.equal(rowA.isScheduled, false);
      const b = await createTheme(tx, { name: "Test  tema 2", fromId: a.id });
      const [rowB] = await tx.select().from(schema.themes).where(eq(schema.themes.id, b.id));
      assert.equal(rowB.slug, "test-tema-2");
      await expectPanelError(createTheme(tx, { name: "test TEMA" }), "invalid", "name");
      assert.equal(JSON.stringify(a.audit).includes('"tokens"'), false, "audit keeps token parts, not a 'tokens' key");
    });
  });

  test("save writes tokens and schedule, is locked by updatedAt, and the default cannot be scheduled", async () => {
    await inRolledBackTx(async (tx) => {
      const { id } = await createTheme(tx, { name: "Test Kaydet" });
      const [row] = await tx.select().from(schema.themes).where(eq(schema.themes.id, id));
      const startsAt = "2030-01-01T00:00";
      const endsAt = "2030-01-10T00:00";
      const { updatedAt, audit } = await saveTheme(tx, savePayload(row, { isScheduled: true, schedule: { startsAt, endsAt } }));
      const [saved] = await tx.select().from(schema.themes).where(eq(schema.themes.id, id));
      assert.equal(saved.isScheduled, true);
      assert.equal(saved.startsAt?.toISOString(), "2029-12-31T21:00:00.000Z");
      assert.deepEqual(saved.tokens.dark, { background: "#081C15" });
      assert.deepEqual(saved.tokens.fonts, { heading: "manrope", body: "manrope" });
      assert.equal(saved.tokens.radius, "lg");
      assert.equal(saved.updatedAt.getTime(), updatedAt.getTime());
      assert.ok((audit.after as Record<string, unknown>).colors, "audit has the changed colors");
      // Stale updatedAt → conflict.
      await expectPanelError(saveTheme(tx, savePayload(row)), "conflict");
      // The default theme refuses a schedule.
      const def = await defaultTheme(tx);
      await expectPanelError(
        saveTheme(tx, savePayload(def, { isScheduled: true, schedule: { startsAt, endsAt } })),
        "invalid",
        "isScheduled",
      );
    });
  });

  test("set default keeps exactly one default and turns the schedule off", async () => {
    await inRolledBackTx(async (tx) => {
      const old = await defaultTheme(tx);
      const { id } = await createTheme(tx, { name: "Test Varsayılan" });
      const [row] = await tx.select().from(schema.themes).where(eq(schema.themes.id, id));
      const { updatedAt } = await saveTheme(
        tx,
        savePayload(row, { isScheduled: true, schedule: { startsAt: "2030-01-01T00:00", endsAt: "2030-01-10T00:00" } }),
      );
      const result = await setDefaultTheme(tx, { id, updatedAt });
      assert.equal(result.changed, true);
      const defaults = await tx.select().from(schema.themes).where(eq(schema.themes.isDefault, true));
      assert.deepEqual(defaults.map((d) => d.id), [id]);
      assert.equal(defaults[0].isScheduled, false);
      const [previous] = await tx.select().from(schema.themes).where(eq(schema.themes.id, old.id));
      assert.equal(previous.isDefault, false);
      // Again on the (new) default: no change.
      const again = await setDefaultTheme(tx, { id, updatedAt: defaults[0].updatedAt });
      assert.equal(again.changed, false);
    });
  });

  test("delete refuses the default and clears campaign links first", async () => {
    await inRolledBackTx(async (tx) => {
      const def = await defaultTheme(tx);
      await expectPanelError(deleteTheme(tx, { id: def.id, updatedAt: def.updatedAt }), "in_use");
      const { id } = await createTheme(tx, { name: "Test Silinecek" });
      const [campaign] = await tx
        .insert(schema.campaigns)
        .values({ name: "theme-texts test campaign", discountPercent: 10, themeId: id })
        .returning({ id: schema.campaigns.id });
      const [row] = await tx.select().from(schema.themes).where(eq(schema.themes.id, id));
      const { clearedCampaigns } = await deleteTheme(tx, { id, updatedAt: row.updatedAt });
      assert.deepEqual(clearedCampaigns.map((c) => c.id), [campaign.id]);
      const [after] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaign.id));
      assert.equal(after.themeId, null);
      assert.equal((await tx.select().from(schema.themes).where(eq(schema.themes.id, id))).length, 0);
    });
  });

  test("the storefront query picks a campaign-linked theme and reports the next change", async () => {
    await inRolledBackTx(async (tx) => {
      const { id } = await createTheme(tx, { name: "Test Kampanya Teması" });
      await tx.update(schema.themes).set({ priority: 50 }).where(eq(schema.themes.id, id));
      const now = new Date();
      const endsAt = new Date(now.getTime() + 2 * 3600_000);
      await tx.insert(schema.campaigns).values({
        name: "theme-texts running campaign",
        discountPercent: 10,
        themeId: id,
        isActive: true,
        startsAt: new Date(now.getTime() - 3600_000),
        endsAt,
      });
      const state = await queryActiveThemeState(now, tx);
      assert.equal(state.theme?.name, "Test Kampanya Teması");
      assert.equal(state.reason, "campaign");
      assert.ok(state.nextChangeAt && state.nextChangeAt.getTime() <= endsAt.getTime());
      // Inactive campaign → back to the default (or a running scheduled theme).
      await tx.update(schema.campaigns).set({ isActive: false }).where(eq(schema.campaigns.themeId, id));
      const fallback = await queryActiveThemeState(now, tx);
      assert.notEqual(fallback.theme?.name, "Test Kampanya Teması");
    });
  });
});

describe("ui string services", () => {
  test("create, update, conflict and delete (empty value)", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.delete(schema.uiStrings).where(eq(schema.uiStrings.key, "header.cart"));
      const created = await saveUiStrings(tx, [{ key: "header.cart", value: { tr: "Sepetim", en: "", ar: "السلة" }, updatedAt: null }]);
      assert.equal(created.changed, 1);
      const [row] = await tx.select().from(schema.uiStrings).where(eq(schema.uiStrings.key, "header.cart"));
      assert.deepEqual(row.value, { tr: "Sepetim", ar: "السلة" });
      const version = created.versions["header.cart"]!;
      assert.equal(row.updatedAt.toISOString(), version);

      // A second editor who saw no override → conflict.
      await expectPanelError(saveUiStrings(tx, [{ key: "header.cart", value: { tr: "Çanta", en: "", ar: "" }, updatedAt: null }]), "conflict");
      // Stale version → conflict.
      await expectPanelError(
        saveUiStrings(tx, [{ key: "header.cart", value: { tr: "Çanta", en: "", ar: "" }, updatedAt: new Date("2020-01-01T00:00:00Z") }]),
        "conflict",
      );
      // Same text again: nothing to write.
      const same = await saveUiStrings(tx, [{ key: "header.cart", value: { tr: "Sepetim", en: "", ar: "السلة" }, updatedAt: row.updatedAt }]);
      assert.equal(same.changed, 0);
      // Update, then delete by clearing every language.
      const updated = await saveUiStrings(tx, [{ key: "header.cart", value: { tr: "Çantam", en: "Bag", ar: "" }, updatedAt: row.updatedAt }]);
      assert.equal(updated.audit[0].action, "update");
      const removed = await saveUiStrings(tx, [
        { key: "header.cart", value: { tr: "", en: "", ar: "" }, updatedAt: new Date(updated.versions["header.cart"]!) },
      ]);
      assert.equal(removed.versions["header.cart"], null);
      assert.equal((await tx.select().from(schema.uiStrings).where(eq(schema.uiStrings.key, "header.cart"))).length, 0);
    });
  });

  test("placeholder errors and unknown keys come back per item and language", async () => {
    await inRolledBackTx(async (tx) => {
      await assert.rejects(
        saveUiStrings(tx, [
          { key: "header.cart", value: { tr: "Sepet", en: "", ar: "" }, updatedAt: null },
          { key: "header.cartWithCount", value: { tr: "Sepet", en: "Cart {count}", ar: "" }, updatedAt: null },
          { key: "nope.key", value: { tr: "x", en: "", ar: "" }, updatedAt: null },
        ]),
        (error: unknown) => {
          assert.ok(error instanceof PanelError);
          assert.equal(error.code, "invalid");
          assert.deepEqual(Object.keys(error.fieldErrors ?? {}).sort(), ["items.1.en", "items.1.tr", "items.2.key"]);
          return true;
        },
      );
    });
  });

  test("through the panel action core: field errors and nothing written", async () => {
    const before = await db.select().from(schema.uiStrings);
    const { result, tags } = await executePanelAction(
      {
        schema: uiStringsSaveSchema,
        run: async (input, { tx }) => {
          const { audit } = await saveUiStrings(tx, input.items);
          return { audit, tags: ["ui-strings"] };
        },
      },
      ACTOR,
      { items: [{ key: "product.lowStockCount", value: { tr: "Az kaldı" }, updatedAt: null }] },
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.fieldErrors?.["items.0.tr"]);
    assert.deepEqual(tags, []);
    assert.deepEqual(await db.select().from(schema.uiStrings), before);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    assert.equal(audit.length, 0);
  });
});
