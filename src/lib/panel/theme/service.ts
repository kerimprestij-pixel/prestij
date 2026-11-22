// Theme mutations for the panel. Services take a transaction and never touch Next APIs, so DB tests can
// call them directly; the actions in src/app/panel/(dashboard)/tema/actions.ts add the session, audit
// and cache tags (TAGS.theme, plus TAGS.campaigns when campaign links were cleared).
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { ThemeTokens } from "@/db/schema";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { slugify } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import { DEFAULT_THEME_TOKENS } from "@/lib/theme/defaults";
import { THEME_COLOR_KEYS, tokensFromInput, type ThemeCreateInput, type ThemeRefInput, type ThemeSaveInput } from "./schemas";

type ThemeRow = typeof schema.themes.$inferSelect;

const NOT_FOUND = "Tema bulunamadı. Silinmiş olabilir; listeyi yenileyin.";
const NAME_TAKEN = "Bu adda bir tema zaten var. Farklı bir ad seçin.";

/**
 * What the audit log stores for a theme. The tokens are spread into their parts on purpose: the audit
 * scrubber drops any key that contains "token".
 */
function auditView(row: Pick<ThemeRow, "name" | "tokens" | "isDefault" | "isScheduled" | "startsAt" | "endsAt" | "priority">) {
  const tokens = (row.tokens ?? {}) as Partial<ThemeTokens>;
  // Fixed key order (jsonb reorders keys), so unchanged colors do not show up as changes.
  const ordered = (colors: Partial<Record<string, string>> | undefined) => {
    if (!colors) return null;
    const out: Record<string, string> = {};
    for (const key of THEME_COLOR_KEYS) if (colors[key]) out[key] = colors[key];
    return out;
  };
  return {
    name: row.name,
    colors: ordered(tokens.colors),
    darkColors: ordered(tokens.dark),
    radius: tokens.radius ?? null,
    fonts: tokens.fonts ? { heading: tokens.fonts.heading ?? null, body: tokens.fonts.body ?? null } : null,
    isDefault: row.isDefault,
    isScheduled: row.isScheduled,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    priority: row.priority,
  };
}

async function lockTheme(tx: Tx, id: number): Promise<ThemeRow> {
  const [row] = await tx.select().from(schema.themes).where(eq(schema.themes.id, id)).for("update");
  if (!row) throw new PanelError("not_found", NOT_FOUND);
  return row;
}

const foldName = (name: string) => name.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");

async function assertNameFree(tx: Tx, name: string, exceptId?: number): Promise<void> {
  const rows = await tx.select({ id: schema.themes.id, name: schema.themes.name }).from(schema.themes);
  if (rows.some((r) => r.id !== exceptId && foldName(r.name) === foldName(name))) throw fieldError("name", NAME_TAKEN);
}

/** A slug that no theme uses yet ("yaz", "yaz-2", …). Slugs only label the <style> tag. */
async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name, 60) || "tema";
  const taken = new Set((await tx.select({ slug: schema.themes.slug }).from(schema.themes)).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** New theme as a copy of `fromId` (default: the default theme), not scheduled. */
export async function createTheme(tx: Tx, input: ThemeCreateInput): Promise<{ id: number; audit: AuditEntry }> {
  let source: Pick<ThemeRow, "tokens" | "priority"> | undefined;
  if (input.fromId) {
    const [row] = await tx.select().from(schema.themes).where(eq(schema.themes.id, input.fromId));
    if (!row) throw new PanelError("not_found", "Kopyalanacak tema bulunamadı. Listeyi yenileyin.");
    source = row;
  } else {
    [source] = await tx.select().from(schema.themes).where(eq(schema.themes.isDefault, true)).orderBy(asc(schema.themes.id)).limit(1);
  }
  await assertNameFree(tx, input.name);
  const values = {
    name: input.name,
    slug: await uniqueSlug(tx, input.name),
    tokens: structuredClone(source?.tokens ?? DEFAULT_THEME_TOKENS),
    isDefault: false,
    isScheduled: false,
    startsAt: null,
    endsAt: null,
    priority: input.fromId ? (source?.priority ?? 0) : 0,
  };
  const [created] = await tx.insert(schema.themes).values(values).returning({ id: schema.themes.id });
  return {
    id: created.id,
    audit: { action: input.fromId ? "duplicate" : "create", entity: "theme", entityId: created.id, after: auditView(values) },
  };
}

/** Saves the editor state (colors, dark overrides, radius, fonts, schedule, priority), locked by updatedAt. */
export async function saveTheme(tx: Tx, input: ThemeSaveInput): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const row = await lockTheme(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.isDefault && input.isScheduled) {
    throw fieldError("isScheduled", "Varsayılan tema planlanamaz: planlı tema bitince site ona döner. Planlama için yeni bir tema oluşturun.");
  }
  await assertNameFree(tx, input.name, row.id);

  const next = {
    name: input.name,
    tokens: tokensFromInput(input, row.tokens),
    isScheduled: input.isScheduled,
    startsAt: input.schedule.startsAt,
    endsAt: input.schedule.endsAt,
    priority: input.priority,
  };
  const [saved] = await tx
    .update(schema.themes)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(schema.themes.id, row.id))
    .returning({ updatedAt: schema.themes.updatedAt });
  return {
    updatedAt: saved.updatedAt,
    audit: { action: "update", entity: "theme", entityId: row.id, ...auditChanges(auditView(row), auditView({ ...row, ...next })) },
  };
}

/**
 * Makes a theme the default (exactly one): the old default is cleared first (partial unique index), and
 * the new default stops being scheduled (it is the fallback, always available).
 */
export async function setDefaultTheme(tx: Tx, input: ThemeRefInput): Promise<{ changed: boolean; audit: AuditEntry[] }> {
  const row = await lockTheme(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.isDefault) return { changed: false, audit: [] };

  const previous = await tx.select().from(schema.themes).where(eq(schema.themes.isDefault, true)).for("update");
  const now = new Date();
  if (previous.length > 0) {
    await tx
      .update(schema.themes)
      .set({ isDefault: false, updatedAt: now })
      .where(inArray(schema.themes.id, previous.map((p) => p.id)));
  }
  await tx.update(schema.themes).set({ isDefault: true, isScheduled: false, updatedAt: now }).where(eq(schema.themes.id, row.id));

  const audit: AuditEntry[] = previous.map((p) => ({
    action: "update",
    entity: "theme",
    entityId: p.id,
    before: { isDefault: true },
    after: { isDefault: false },
  }));
  audit.push({
    action: "update",
    entity: "theme",
    entityId: row.id,
    before: { isDefault: false, isScheduled: row.isScheduled },
    after: { isDefault: true, isScheduled: false },
  });
  return { changed: true, audit };
}

/** Deletes a non-default theme; campaigns that switched it on lose the link first. */
export async function deleteTheme(
  tx: Tx,
  input: ThemeRefInput,
): Promise<{ clearedCampaigns: { id: number; name: string }[]; audit: AuditEntry }> {
  const row = await lockTheme(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.isDefault) {
    throw new PanelError("in_use", "Varsayılan tema silinemez. Önce başka bir temayı varsayılan yapın.");
  }
  const clearedCampaigns = await tx
    .update(schema.campaigns)
    .set({ themeId: null, updatedAt: new Date() })
    .where(eq(schema.campaigns.themeId, row.id))
    .returning({ id: schema.campaigns.id, name: schema.campaigns.name });
  await tx.delete(schema.themes).where(eq(schema.themes.id, row.id));
  return {
    clearedCampaigns,
    audit: {
      action: "delete",
      entity: "theme",
      entityId: row.id,
      before: { ...auditView(row), slug: row.slug, campaigns: clearedCampaigns.map((c) => c.name) },
    },
  };
}
