// Settings documents for the panel: read one key for its editor, save it under an optimistic lock.
// No Next APIs (DB tests call these directly); the Server Actions in /panel/ayarlar wire them up.
import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { ensureMediaExist } from "@/lib/panel/media/queries";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings, settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";
import { TAGS } from "@/lib/cache-tags";
import { settingsPayloadSchema, type SettingsInput } from "./schemas";

export type SettingsRow<K extends SettingsKey> = {
  key: K;
  /** The stored value merged over the defaults (exactly what the storefront reads). */
  value: Settings<K>;
  /** ISO string of the row's updatedAt; null when the key has no row yet. */
  updatedAt: string | null;
};

/** One settings document as the storefront sees it, plus the stamp its editor sends back. */
export async function readSettingsRow<K extends SettingsKey>(key: K, executor: Tx = db): Promise<SettingsRow<K>> {
  const s = schema.settings;
  const [row] = await executor.select({ value: s.value, updatedAt: s.updatedAt }).from(s).where(eq(s.key, key)).limit(1);
  return { key, value: parseSettings(key, row?.value), updatedAt: row ? row.updatedAt.toISOString() : null };
}

/** Every settings document (overview page). */
export async function readAllSettings(executor: Tx = db): Promise<{ [K in SettingsKey]: Settings<K> }> {
  const s = schema.settings;
  const rows = await executor.select({ key: s.key, value: s.value }).from(s);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const keys = Object.keys(settingsSchemas) as SettingsKey[];
  return Object.fromEntries(keys.map((key) => [key, parseSettings(key, byKey.get(key))])) as { [K in SettingsKey]: Settings<K> };
}

/** Carrier keys that orders already reference (removing one would break those orders' tracking links). */
export async function carrierKeysInUse(executor: Tx = db): Promise<Record<string, number>> {
  const o = schema.orders;
  const rows = await executor
    .select({ carrier: o.carrier, n: sql<number>`count(*)::int` })
    .from(o)
    .where(isNotNull(o.carrier))
    .groupBy(o.carrier);
  return Object.fromEntries(rows.filter((r) => r.carrier).map((r) => [r.carrier as string, r.n]));
}

/** Customer groups for the B2B default-group select. */
export async function listCustomerGroups(executor: Tx = db): Promise<{ slug: string; name: string; isBusiness: boolean }[]> {
  const g = schema.customerGroups;
  const rows = await executor.select({ slug: g.slug, name: g.name, isBusiness: g.isBusiness }).from(g).orderBy(asc(g.id));
  return rows.map((r) => ({ slug: r.slug, name: r.name?.tr || r.slug, isBusiness: r.isBusiness }));
}

/** Active sample products (the cart's sample list stays empty without one). */
export async function countActiveSampleProducts(executor: Tx = db): Promise<number> {
  const p = schema.products;
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(p)
    .where(and(eq(p.type, "sample"), eq(p.status, "active")));
  return row?.n ?? 0;
}

export type SaveSettingsInput<K extends SettingsKey> = {
  value: SettingsInput<K>;
  /** The stamp the editor loaded (null: the key had no row). */
  updatedAt: Date | null;
};

/** Checks that need the database (media exists, group exists, carriers still referenced by orders). */
async function checkReferences<K extends SettingsKey>(tx: Tx, key: K, value: Settings<K>, before: Settings<K>): Promise<void> {
  if (key === "general") {
    const v = value as Settings<"general">;
    await ensureMediaExist(tx, [v.logo.lightId], "logo.lightId");
    await ensureMediaExist(tx, [v.logo.darkId], "logo.darkId");
  } else if (key === "seo") {
    await ensureMediaExist(tx, [(value as Settings<"seo">).ogImageId], "ogImageId");
  } else if (key === "payments") {
    // PayTR-fix IMPL-B (S7): the PayTR logo must be an image that still exists.
    await ensureMediaExist(tx, [(value as Settings<"payments">).paytrLogoImageId], "paytrLogoImageId");
  } else if (key === "b2b") {
    const slug = (value as Settings<"b2b">).defaultGroupSlug;
    const [group] = await tx
      .select({ id: schema.customerGroups.id })
      .from(schema.customerGroups)
      .where(eq(schema.customerGroups.slug, slug))
      .limit(1);
    if (!group) throw fieldError("defaultGroupSlug", "Bu müşteri grubu artık yok. Listeden bir grup seçin.");
  } else if (key === "shipping") {
    const kept = new Set((value as Settings<"shipping">).carriers.map((c) => c.key));
    const removed = (before as Settings<"shipping">).carriers.map((c) => c.key).filter((k) => !kept.has(k));
    if (removed.length > 0) {
      const o = schema.orders;
      const used = await tx
        .select({ carrier: o.carrier, n: sql<number>`count(*)::int` })
        .from(o)
        .where(and(inArray(o.carrier, removed), isNotNull(o.carrier)))
        .groupBy(o.carrier);
      if (used.length > 0) {
        const names = (before as Settings<"shipping">).carriers.filter((c) => used.some((u) => u.carrier === c.key)).map((c) => c.name);
        const total = used.reduce((n, u) => n + u.n, 0);
        throw new PanelError(
          "in_use",
          `${names.join(", ")} ${total} siparişte kullanıldı; silinirse bu siparişlerin kargo takip bağlantısı kaybolur. Firmayı listede tutun.`,
        );
      }
    }
  }
}

/**
 * Saves one settings document. Locked by the row's `updatedAt`; the value is re-validated with the
 * storefront schema (so the storefront never falls back to defaults) and only changed top-level
 * fields go into the audit entry.
 */
export async function saveSettings<K extends SettingsKey>(
  tx: Tx,
  key: K,
  input: SaveSettingsInput<K>,
): Promise<{ updatedAt: Date; value: Settings<K>; audit: AuditEntry }> {
  const s = schema.settings;
  const [row] = await tx.select({ value: s.value, updatedAt: s.updatedAt }).from(s).where(eq(s.key, key)).for("update");
  if (row) assertFresh(row.updatedAt, input.updatedAt);
  else if (input.updatedAt !== null) assertFresh(null, input.updatedAt);

  const checked = settingsSchemas[key].safeParse(input.value);
  if (!checked.success) throw new PanelError("invalid", "Ayarlar kaydedilemedi: değerlerden biri geçersiz.");
  const value = checked.data as Settings<K>;
  const before = parseSettings(key, row?.value);
  await checkReferences(tx, key, value, before);

  const now = new Date();
  if (row) {
    await tx.update(s).set({ value, updatedAt: now }).where(eq(s.key, key));
  } else {
    await tx.insert(s).values({ key, value, updatedAt: now });
  }

  const changes = auditChanges(before as Record<string, unknown>, value as Record<string, unknown>, { ignore: [] });
  return { updatedAt: now, value, audit: { action: "update", entity: "settings", entityId: key, ...changes } };
}

const SAVED_MESSAGE: Record<SettingsKey, string> = {
  general: "Firma bilgileri kaydedildi.",
  shipping: "Kargo ayarları kaydedildi.",
  payments: "Ödeme ayarları kaydedildi.",
  seo: "SEO ayarları kaydedildi.",
  locales: "Dil ayarları kaydedildi.",
  b2b: "Kurumsal satış ayarları kaydedildi.",
  samples: "Numune ayarları kaydedildi.",
  newsletter: "E-bülten ayarları kaydedildi.",
  whatsapp: "WhatsApp ayarları kaydedildi.",
  emails: "E-posta ayarları kaydedildi.",
  reviews: "Yorum ayarları kaydedildi.",
  subscriptions: "Abonelik ayarları kaydedildi.",
  giftWheel: "Hediye çarkı ayarları kaydedildi.",
};

/** Cache tags a key invalidates besides `settings` (day 6: the storefront's wheel teaser reads TAGS.wheel). */
const EXTRA_TAGS: Partial<Record<SettingsKey, readonly string[]>> = {
  giftWheel: [TAGS.wheel],
};

/**
 * `panelAction` options for saving one settings key (admin only, tag `settings` plus EXTRA_TAGS). The
 * Server Actions in /panel/ayarlar/actions.ts wrap these; DB tests run them with executePanelAction.
 * The Hediye Çarkı page spreads them with `minRole: "editor"` for `giftWheel`.
 */
export function settingsActionOptions<K extends SettingsKey>(key: K) {
  return {
    minRole: "admin" as const,
    schema: settingsPayloadSchema(key),
    run: async (input: { value: SettingsInput<K>; updatedAt: Date | null }, { tx }: { tx: Tx }) => {
      const saved = await saveSettings(tx, key, input);
      return {
        data: { updatedAt: saved.updatedAt.toISOString() },
        message: SAVED_MESSAGE[key],
        tags: [TAGS.settings, ...(EXTRA_TAGS[key] ?? [])],
        audit: saved.audit,
      };
    },
  };
}
