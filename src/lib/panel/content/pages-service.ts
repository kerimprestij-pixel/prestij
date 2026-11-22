// Pages and their sections (page builder): create, save (meta + every section in one transaction,
// locked by the page's updatedAt), delete. Services take (tx, input) and never touch Next APIs, so the
// DB tests call them directly; the Server Actions in /panel/sayfalar wire them to panelAction.
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { schema } from "@/db";
import type { SeoFields } from "@/db/schema/common";
import { TAGS } from "@/lib/cache-tags";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh, sameInstant } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { canonicalPath, dropRedirectsTo, recordMove } from "@/lib/panel/redirects";
import type { Tx } from "@/lib/panel/tx";
import { canDeletePage, isAlwaysPublished, isFixedSlugPage, isReservedSlug } from "./pages";
import type { PageCreateInput, PageSaveInput, SectionInput } from "./schemas";
import { normalizeSectionContent, sectionRefs, stableJson } from "./sections";
import { mediaAcceptAt, type MediaAccept } from "@/components/sections/field-spec";
import { isSectionType, sectionMeta } from "@/components/sections/schemas";

const p = schema.pages;
const s = schema.pageSections;

const SLUG_TAKEN = "Bu kısa ad başka bir sayfada kullanılıyor.";
const SLUG_RESERVED = "Bu kısa ad sistem sayfalarına ayrılmış; başka bir ad seçin.";

async function assertSlugFree(tx: Tx, slug: string, exceptId?: number) {
  if (isReservedSlug(slug)) throw fieldError("slug", SLUG_RESERVED);
  const [taken] = await tx
    .select({ id: p.id })
    .from(p)
    .where(exceptId ? and(eq(p.slug, slug), ne(p.id, exceptId)) : eq(p.slug, slug))
    .limit(1);
  if (taken) throw fieldError("slug", SLUG_TAKEN);
}

// ---------------------------------------------------------------------------------------------------
// Create

export async function createPage(tx: Tx, input: PageCreateInput): Promise<{ id: number; audit: AuditEntry }> {
  await assertSlugFree(tx, input.slug);
  const [row] = await tx
    .insert(p)
    .values({ slug: input.slug, kind: "custom", title: input.title, seo: null, isPublished: false })
    .returning({ id: p.id });
  return {
    id: row.id,
    audit: { action: "create", entity: "page", entityId: row.id, after: { slug: input.slug, title: input.title, kind: "custom", isPublished: false } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Save

export type SavePageResult = {
  updatedAt: string;
  slug: string;
  /** The saved sections in order: ids (new ones included) and the stored, normalized content. */
  sections: { id: number; content: Record<string, unknown> }[];
};

type SectionRow = typeof s.$inferSelect;

function seoToStore(seo: PageSaveInput["seo"]): SeoFields | null {
  const out: SeoFields = {};
  if (seo.title) out.title = seo.title;
  if (seo.description) out.description = seo.description;
  if (seo.ogImageId) out.ogImageId = seo.ogImageId;
  if (seo.noIndex) out.noIndex = true;
  return Object.keys(out).length > 0 ? out : null;
}

/** The stored row's content as the panel would store it (or the raw JSON when it no longer validates). */
function normalizedStored(row: SectionRow): string {
  if (isSectionType(row.type)) {
    const result = normalizeSectionContent(row.type, row.content);
    if (result.ok) return stableJson(result.content);
  }
  return stableJson(row.content);
}

/** Day 6: messages for a media field holding the wrong kind (field specs' `accept`). */
export const MEDIA_KIND_MESSAGES = {
  image: "Bu alana video değil, görsel seçilmeli.",
  video: "Bu alana görsel değil, video seçilmeli.",
} as const;
const MEDIA_GONE_MESSAGES = {
  image: "Bu görsel artık kütüphanede yok. Yeniden seçin.",
  video: "Bu video artık kütüphanede yok. Yeniden seçin.",
} as const;

/**
 * Checks that every media and product a changed section references still exists (precise field paths)
 * and, day 6, that each media field holds the kind its spec accepts: an image field never takes a video
 * (it would render nothing) and a video field never takes an image. The share image is an image field.
 */
async function assertReferencesExist(tx: Tx, changed: { index: number; section: SectionInput }[], ogImageId: number | null) {
  const media: { id: number; path: string; accept: MediaAccept }[] = [];
  const products: { id: number; path: string }[] = [];
  for (const { index, section } of changed) {
    if (!isSectionType(section.type)) continue;
    const refs = sectionRefs(section.type, section.content);
    const fields = sectionMeta[section.type].fields;
    for (const r of refs.media) media.push({ id: r.id, path: `sections.${index}.content.${r.path}`, accept: mediaAcceptAt(fields, r.path) ?? "image" });
    for (const r of refs.products) products.push({ id: r.id, path: `sections.${index}.content.${r.path}` });
  }
  if (ogImageId) media.push({ id: ogImageId, path: "seo.ogImageId", accept: "image" });

  const fieldErrors: Record<string, string> = {};
  let gone = 0;
  let wrongKind = 0;
  if (media.length > 0) {
    const found = await tx
      .select({ id: schema.media.id, kind: schema.media.kind })
      .from(schema.media)
      .where(inArray(schema.media.id, [...new Set(media.map((r) => r.id))]))
      .for("share"); // serializes with a concurrent media delete (see ensureMediaExist)
    const kinds = new Map(found.map((r) => [r.id, r.kind]));
    for (const r of media) {
      if (fieldErrors[r.path]) continue;
      const kind = kinds.get(r.id);
      if (kind === undefined) {
        fieldErrors[r.path] = MEDIA_GONE_MESSAGES[r.accept];
        gone += 1;
      } else if (kind !== r.accept) {
        fieldErrors[r.path] = MEDIA_KIND_MESSAGES[r.accept];
        wrongKind += 1;
      }
    }
  }
  if (products.length > 0) {
    const found = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(inArray(schema.products.id, [...new Set(products.map((r) => r.id))]));
    const ok = new Set(found.map((r) => r.id));
    for (const r of products) {
      if (ok.has(r.id) || fieldErrors[r.path]) continue;
      fieldErrors[r.path] = "Bu ürün artık mevcut değil. Başka bir ürün seçin.";
      gone += 1;
    }
  }
  if (gone > 0) {
    throw new PanelError("invalid", gone === 1 ? "Seçilen bir öğe artık mevcut değil." : `Seçilen ${gone} öğe artık mevcut değil.`, fieldErrors);
  }
  if (wrongKind > 0) {
    throw new PanelError(
      "invalid",
      wrongKind === 1 ? "Seçilen dosyanın türü bu alana uymuyor." : `${wrongKind} alanda seçilen dosyanın türü uymuyor.`,
      fieldErrors,
    );
  }
}

const legalKeyOf = (content: unknown): string | null =>
  content && typeof content === "object" && typeof (content as { key?: unknown }).key === "string" ? (content as { key: string }).key : null;

/**
 * Legal pages (/sayfa/kvkk, … linked from checkout) must keep their legal text: exactly one
 * legal_document section, visible, for everyone, unscheduled, showing the page's own document. The
 * text itself is admin-only (legal editor); editors may still change the page's other sections.
 */
function assertLegalSectionKept(existing: SectionRow[], sections: SectionInput[]) {
  const stored = existing.find((row) => row.type === "legal_document");
  const expectedKey = stored ? legalKeyOf(stored.content) : null;
  const legal = sections.flatMap((section, index) => (section.type === "legal_document" ? [{ section, index }] : []));
  if (legal.length !== 1) {
    throw new PanelError(
      "invalid",
      legal.length === 0 ? "Yasal metin bölümü bu sayfadan kaldırılamaz." : "Bu sayfada yalnızca bir yasal metin bölümü olabilir.",
    );
  }
  const { section, index } = legal[0];
  const at = (field: string) => `sections.${index}.${field}`;
  if (!section.isVisible) throw fieldError(at("isVisible"), "Yasal metin bölümü gizlenemez.");
  if (section.audience !== "all") throw fieldError(at("audience"), "Yasal metin bölümü herkese görünmeli.");
  if (section.schedule.startsAt || section.schedule.endsAt) throw fieldError(at("schedule.startsAt"), "Yasal metin bölümü zamanlanamaz; her zaman görünür.");
  if (expectedKey && legalKeyOf(section.content) !== expectedKey) throw fieldError(at("content.key"), "Bu sayfanın gösterdiği yasal metin değiştirilemez.");
}

/** A changed legal_document section must point at an existing legal document key. */
async function assertLegalKeysExist(tx: Tx, changed: { index: number; section: SectionInput }[]) {
  const wanted = changed.flatMap(({ index, section }) => (section.type === "legal_document" ? [{ index, key: legalKeyOf(section.content) }] : []));
  if (wanted.length === 0) return;
  const rows = await tx.selectDistinct({ key: schema.legalDocuments.key }).from(schema.legalDocuments);
  const known = new Set(rows.map((r) => r.key));
  for (const { index, key } of wanted) {
    if (!key || !known.has(key)) throw fieldError(`sections.${index}.content.key`, "Böyle bir yasal metin yok. Yasal Metinler listesindeki anahtarlardan birini seçin.");
  }
}

/** Same instant, or both empty (sameInstant treats a missing value as never equal). */
const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : sameInstant(a, b));

const sectionMetaOf = (row: Pick<SectionRow, "position" | "isVisible" | "audience" | "startsAt" | "endsAt">) => ({
  position: row.position,
  isVisible: row.isVisible,
  audience: row.audience,
  startsAt: row.startsAt ? row.startsAt.toISOString() : null,
  endsAt: row.endsAt ? row.endsAt.toISOString() : null,
});

/** Top-level content keys that differ (for a compact audit entry). */
function contentDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: { before: Record<string, unknown>; after: Record<string, unknown> } = { before: {}, after: {} };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (stableJson(before[key]) === stableJson(after[key])) continue;
    if (key in before) out.before[key] = before[key];
    if (key in after) out.after[key] = after[key];
  }
  return out;
}

export async function savePage(tx: Tx, input: PageSaveInput): Promise<{ result: SavePageResult; audit: AuditEntry; tags: string[] }> {
  const [page] = await tx.select().from(p).where(eq(p.id, input.id)).for("update");
  if (!page) throw new PanelError("not_found", "Sayfa bulunamadı. Silinmiş olabilir.");
  assertFresh(page.updatedAt, input.updatedAt);

  // Address and visibility rules.
  const slug = input.slug;
  if (slug !== page.slug) {
    if (isFixedSlugPage(page)) throw fieldError("slug", "Bu sayfanın adresi sabittir; değiştirilemez.");
    await assertSlugFree(tx, slug, page.id);
  }
  if (!input.isPublished && isAlwaysPublished(page)) {
    throw fieldError("isPublished", page.kind === "home" ? "Ana sayfa her zaman yayında kalmalı." : "Yasal metin sayfaları yayından kaldırılamaz.");
  }

  // Sections: ids must belong to this page, appear once, and keep their type.
  const existing = await tx.select().from(s).where(eq(s.pageId, page.id)).for("update");
  const byId = new Map(existing.map((row) => [row.id, row]));
  const seen = new Set<number>();
  input.sections.forEach((section, index) => {
    if (section.id === null) return;
    const row = byId.get(section.id);
    if (!row || seen.has(section.id)) {
      throw new PanelError("conflict", "Sayfanın bölümleri siz düzenlerken değişti. Sayfayı yenileyin.", { [`sections.${index}`]: "Bu bölüm artık bu sayfada değil." });
    }
    if (row.type !== section.type) throw fieldError(`sections.${index}.type`, "Mevcut bir bölümün türü değiştirilemez; yeni bölüm ekleyin.");
    seen.add(section.id);
  });
  if (page.kind === "legal") assertLegalSectionKept(existing, input.sections);

  const changed: { index: number; section: SectionInput }[] = [];
  const plan = input.sections.map((section, index) => {
    const row = section.id === null ? undefined : byId.get(section.id);
    const meta = {
      position: index,
      isVisible: section.isVisible,
      audience: section.audience,
      startsAt: section.schedule.startsAt,
      endsAt: section.schedule.endsAt,
    };
    if (!row) {
      changed.push({ index, section });
      return { kind: "insert" as const, section, meta };
    }
    const contentChanged = normalizedStored(row) !== stableJson(section.content);
    const metaChanged =
      row.position !== meta.position ||
      row.isVisible !== meta.isVisible ||
      row.audience !== meta.audience ||
      !sameTime(row.startsAt, meta.startsAt) ||
      !sameTime(row.endsAt, meta.endsAt);
    if (contentChanged) changed.push({ index, section });
    return { kind: contentChanged || metaChanged ? ("update" as const) : ("keep" as const), section, meta, row, contentChanged };
  });

  await assertReferencesExist(tx, changed, input.seo.ogImageId);
  await assertLegalKeysExist(tx, changed);

  // Write: deletions first, then updates and inserts in order.
  const removed = existing.filter((row) => !seen.has(row.id));
  if (removed.length > 0) await tx.delete(s).where(inArray(s.id, removed.map((row) => row.id)));

  const savedSections: SavePageResult["sections"] = [];
  const auditSections: { added: unknown[]; removed: unknown[]; changed: unknown[] } = {
    added: [],
    removed: removed.map((row) => ({ id: row.id, type: row.type })),
    changed: [],
  };

  for (const step of plan) {
    if (step.kind === "insert") {
      const [row] = await tx
        .insert(s)
        .values({ pageId: page.id, type: step.section.type, content: step.section.content, ...step.meta })
        .returning({ id: s.id });
      savedSections.push({ id: row.id, content: step.section.content });
      auditSections.added.push({ id: row.id, type: step.section.type, position: step.meta.position });
      continue;
    }
    const row = step.row;
    if (step.kind === "update") {
      const set: Partial<typeof s.$inferInsert> = { ...step.meta };
      if (step.contentChanged) set.content = step.section.content;
      await tx.update(s).set(set).where(eq(s.id, row.id));
      const metaBefore = sectionMetaOf(row);
      const metaAfter = sectionMetaOf({ ...step.meta });
      const entry: Record<string, unknown> = { id: row.id, type: row.type };
      const metaKeys = (Object.keys(metaAfter) as (keyof typeof metaAfter)[]).filter((k) => metaBefore[k] !== metaAfter[k]);
      if (metaKeys.length > 0) {
        entry.before = Object.fromEntries(metaKeys.map((k) => [k, metaBefore[k]]));
        entry.after = Object.fromEntries(metaKeys.map((k) => [k, metaAfter[k]]));
      }
      if (step.contentChanged) {
        const diff = contentDiff((row.content ?? {}) as Record<string, unknown>, step.section.content);
        entry.contentBefore = diff.before;
        entry.contentAfter = diff.after;
      }
      // Pure position shifts (caused by another section moving) are not worth an audit line each.
      if (!(metaKeys.length === 1 && metaKeys[0] === "position" && !step.contentChanged)) auditSections.changed.push(entry);
    }
    // Unchanged content is not rewritten; its normalized form equals what was sent.
    savedSections.push({ id: row.id, content: step.section.content });
  }

  // Page row (always bumps updatedAt: it is the lock for the whole page, sections included).
  const seo = seoToStore(input.seo);
  const nextPage = { title: input.title, slug, isPublished: input.isPublished, seo };
  const [saved] = await tx
    .update(p)
    .set({ ...nextPage, updatedAt: new Date() })
    .where(eq(p.id, page.id))
    .returning({ updatedAt: p.updatedAt });

  const tags: string[] = [TAGS.pages, TAGS.page(page.slug), TAGS.page(slug)];
  if (slug !== page.slug && (await recordMove(tx, canonicalPath.page(page.slug), canonicalPath.page(slug)))) tags.push(TAGS.redirects);

  const pageBefore: Record<string, unknown> = { title: page.title, slug: page.slug, isPublished: page.isPublished, seo: page.seo ?? null };
  const pageAfter: Record<string, unknown> = { ...nextPage };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(pageAfter)) {
    if (stableJson(pageBefore[key]) === stableJson(pageAfter[key])) continue;
    before[key] = pageBefore[key];
    after[key] = pageAfter[key];
  }
  const order = (rows: { id: number }[]) => rows.map((r) => r.id);
  const oldOrder = order([...existing].sort((a, b) => a.position - b.position || a.id - b.id));
  const newOrder = order(savedSections);
  if (stableJson(oldOrder) !== stableJson(newOrder)) {
    before.order = oldOrder;
    after.order = newOrder;
  }
  if (auditSections.added.length || auditSections.removed.length || auditSections.changed.length) after.sections = auditSections;

  return {
    result: { updatedAt: saved.updatedAt.toISOString(), slug, sections: savedSections },
    audit: { action: "update", entity: "page", entityId: page.id, before, after },
    tags,
  };
}

// ---------------------------------------------------------------------------------------------------
// Delete

/** Places that link to a page path: menus, announcements and section content (CTAs, gallery links). */
export async function findLinksTo(tx: Tx, path: string): Promise<string[]> {
  const matches = (href: unknown) => typeof href === "string" && (href === path || href.startsWith(`${path}#`) || href.startsWith(`${path}?`));
  const places: string[] = [];

  const menuLabels: Record<string, string> = {
    header: "Üst menü",
    footer_shop: "Alt bilgi · Alışveriş",
    footer_corporate: "Alt bilgi · Kurumsal",
    footer_legal: "Alt bilgi · Yasal",
  };
  const menus = await tx.select({ key: schema.menus.key, items: schema.menus.items }).from(schema.menus);
  for (const menu of menus) {
    const walk = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const item of items as { href?: unknown; label?: { tr?: string }; children?: unknown }[]) {
        if (matches(item?.href)) places.push(`${menuLabels[menu.key] ?? menu.key}: “${item.label?.tr ?? ""}”`);
        walk(item?.children);
      }
    };
    walk(menu.items);
  }

  const announcements = await tx.select({ text: schema.announcements.text, href: schema.announcements.href }).from(schema.announcements);
  for (const a of announcements) if (matches(a.href)) places.push(`Duyuru: “${a.text.tr}”`);

  const sections = await tx
    .select({ content: s.content, pageTitle: p.title, pagePath: p.slug })
    .from(s)
    .innerJoin(p, eq(p.id, s.pageId));
  for (const section of sections) {
    let found = false;
    const walk = (value: unknown, depth: number) => {
      if (found || depth > 10 || !value || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (key === "href" && matches(v)) {
          found = true;
          return;
        }
        walk(v, depth + 1);
      }
    };
    walk(section.content, 0);
    if (found && canonicalPath.page(section.pagePath) !== path) places.push(`${section.pageTitle.tr} sayfasındaki bir bölüm`);
  }
  return [...new Set(places)];
}

export async function deletePage(tx: Tx, input: { id: number; updatedAt: Date }): Promise<{ audit: AuditEntry; tags: string[] }> {
  const [page] = await tx.select().from(p).where(eq(p.id, input.id)).for("update");
  if (!page) throw new PanelError("not_found", "Sayfa bulunamadı. Silinmiş olabilir.");
  assertFresh(page.updatedAt, input.updatedAt);
  if (!canDeletePage(page)) throw new PanelError("forbidden", "Ana sayfa, yasal sayfalar ve sabit sayfalar silinemez.");

  const path = canonicalPath.page(page.slug);
  const places = await findLinksTo(tx, path);
  if (places.length > 0) {
    const shown = places.slice(0, 4).join(", ");
    const more = places.length > 4 ? ` ve ${places.length - 4} yer daha` : "";
    throw new PanelError("in_use", `Bu sayfaya bağlantı veren yerler var: ${shown}${more}. Önce bu bağlantıları kaldırın.`);
  }

  const sections = await tx.select({ id: s.id, type: s.type }).from(s).where(eq(s.pageId, page.id));
  const dropped = await dropRedirectsTo(tx, path);
  await tx.delete(p).where(eq(p.id, page.id));

  const tags: string[] = [TAGS.pages, TAGS.page(page.slug)];
  if (dropped > 0) tags.push(TAGS.redirects);
  return {
    audit: {
      action: "delete",
      entity: "page",
      entityId: page.id,
      before: { slug: page.slug, title: page.title, kind: page.kind, isPublished: page.isPublished, sections: sections.map((x) => x.type) },
    },
    tags,
  };
}
