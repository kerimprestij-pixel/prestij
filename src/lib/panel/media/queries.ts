// Media library reads for the panel (uncached) and the reference check behind "delete is blocked while
// the image is in use". Callers have checked the role (editor+).
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema";
import { sectionMeta, isSectionType } from "@/components/sections/schemas";
import { localize } from "@/i18n/localize";
import { mediaColumns } from "@/lib/data/media";
import { toMediaLike, type MediaKind, type MediaLike } from "@/lib/media/types";
import { PanelError } from "../errors";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "../format";
import type { Tx } from "../tx";
import {
  MEDIA_KIND_FILTERS,
  MEDIA_PAGE_SIZE,
  type MediaKindFilter,
  type MediaListInput,
  type MediaListResult,
  type MediaUsage,
  type PanelMedia,
} from "./types";

const m = schema.media;

export const panelMediaColumns = {
  id: m.id,
  url: m.url,
  width: m.width,
  height: m.height,
  alt: m.alt,
  blurDataUrl: m.blurDataUrl,
  dominantColor: m.dominantColor,
  variants: m.variants,
  folder: m.folder,
  bytes: m.bytes,
  mime: m.mime,
  originalName: m.originalName,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
  // Day 6
  kind: m.kind,
  durationMs: m.durationMs,
  posterId: m.posterId,
} as const;

type PanelMediaRow = Omit<PanelMedia, "createdAt" | "updatedAt" | "poster"> & { createdAt: Date; updatedAt: Date };

/** A row as PanelMedia; `poster` is null here (listMedia / getPanelMedia attach it with loadPosters). */
export function toPanelMedia(row: PanelMediaRow): PanelMedia {
  return {
    id: row.id,
    url: row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    alt: row.alt ?? null,
    blurDataUrl: row.blurDataUrl ?? null,
    dominantColor: row.dominantColor ?? null,
    variants: row.variants ?? null,
    folder: row.folder,
    bytes: row.bytes ?? null,
    mime: row.mime,
    originalName: row.originalName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    kind: row.kind ?? "image",
    durationMs: row.durationMs ?? null,
    posterId: row.posterId ?? null,
    poster: null,
  };
}

/** Day 6: SQL filter for a library query's kind ("all" = no filter). */
function kindCondition(kind: MediaKindFilter): SQL | null {
  return kind === "all" ? null : eq(m.kind, kind);
}

/** Day 6: the cover images of the video rows among `rows`, keyed by id (one query; none for images). */
async function loadPosters(rows: readonly { posterId?: number | null }[], executor: Tx): Promise<Map<number, MediaLike>> {
  const ids = [...new Set(rows.map((r) => r.posterId).filter((id): id is number => typeof id === "number"))];
  if (ids.length === 0) return new Map();
  const posters = await executor.select(mediaColumns).from(m).where(inArray(m.id, ids));
  return new Map(posters.map((p) => [p.id, toMediaLike(p)]));
}

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;

/** Distinct folder labels, sorted. */
export async function listMediaFolders(executor: Tx = db): Promise<string[]> {
  const rows = await executor.selectDistinct({ folder: m.folder }).from(m).orderBy(asc(m.folder));
  return rows.map((r) => r.folder);
}

/** Day 6: a valid kind filter, "image" when missing or unknown (pickers never offer videos by accident). */
export function mediaKindFilter(value: unknown): MediaKindFilter {
  return (MEDIA_KIND_FILTERS as readonly unknown[]).includes(value) ? (value as MediaKindFilter) : "image";
}

/**
 * Newest first, MEDIA_PAGE_SIZE per page. `q` matches file name, alt text (any locale), storage key,
 * folder and tags, Turkish-insensitive. `folder` matches the folder and its sub-folders. `cursor` is
 * the last id of the previous page (nextCursor). `kind` (day 6): "image" (default), "video" or "all";
 * video rows come with their `poster`.
 */
export async function listMedia(input: MediaListInput = {}, executor: Tx = db, pageSize = MEDIA_PAGE_SIZE): Promise<MediaListResult> {
  const where: SQL[] = [];
  const byKind = kindCondition(mediaKindFilter(input.kind));
  if (byKind) where.push(byKind);
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 100) : "";
  if (q) {
    const like = `%${escapeLike(foldText(q))}%`;
    where.push(
      or(
        sql`${fold(sql`${m.originalName}`)} like ${like}`,
        sql`${fold(sql`${m.alt}::text`)} like ${like}`,
        sql`${fold(sql`${m.storageKey}`)} like ${like}`,
        sql`${fold(sql`${m.folder}`)} like ${like}`,
        sql`${fold(sql`array_to_string(${m.tags}, ' ')`)} like ${like}`,
      )!,
    );
  }
  const folder = typeof input.folder === "string" ? input.folder.trim().toLowerCase().slice(0, 60) : "";
  if (folder) where.push(or(eq(m.folder, folder), sql`${m.folder} like ${`${escapeLike(folder)}/%`}`)!);
  const cursor = typeof input.cursor === "number" && Number.isInteger(input.cursor) && input.cursor > 0 ? input.cursor : null;
  if (cursor) where.push(lt(m.id, cursor));

  const size = Math.min(Math.max(pageSize, 1), 200);
  const [rows, folders] = await Promise.all([
    executor
      .select(panelMediaColumns)
      .from(m)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(m.id))
      .limit(size + 1),
    listMediaFolders(executor),
  ]);
  const page = rows.slice(0, size);
  const posters = await loadPosters(page, executor);
  return {
    items: page.map((r) => ({ ...toPanelMedia(r as PanelMediaRow), poster: r.posterId ? (posters.get(r.posterId) ?? null) : null })),
    nextCursor: rows.length > size ? page[page.length - 1].id : null,
    folders,
  };
}

/** Media rows by id in the given order (missing ids are skipped), any kind, videos with their `poster`. */
export async function getPanelMedia(ids: readonly number[], executor: Tx = db): Promise<PanelMedia[]> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
  if (wanted.length === 0) return [];
  const rows = await executor.select(panelMediaColumns).from(m).where(inArray(m.id, wanted));
  const posters = await loadPosters(rows, executor);
  const byId = new Map(
    rows.map((r) => [r.id, { ...toPanelMedia(r as PanelMediaRow), poster: r.posterId ? (posters.get(r.posterId) ?? null) : null }]),
  );
  return wanted.flatMap((id) => byId.get(id) ?? []);
}

/** Day 6: Turkish refusal when a field gets the wrong kind of media. */
export function wrongKindMessage(expected: MediaKind): string {
  return expected === "image"
    ? "Bu alana yalnızca görsel seçilebilir; seçtiğiniz dosya bir video."
    : "Bu alana yalnızca video seçilebilir; seçtiğiniz dosya bir görsel.";
}

/**
 * Throws PanelError("invalid") when one of the ids has no media row (services call this before saving).
 * Day 6: also when a row is of the wrong kind; `kind` defaults to "image", so every image field (logos,
 * covers, share images) refuses a video. Video fields pass "video", mixed lists (product gallery) "all".
 */
export async function ensureMediaExist(
  executor: Tx,
  ids: readonly (number | null | undefined)[],
  field = "media",
  { kind = "image" }: { kind?: MediaKindFilter } = {},
): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (wanted.length === 0) return;
  // FOR SHARE: a concurrent deleteMediaRow (FOR UPDATE, then a usage scan) waits for this save to
  // commit and then sees the new reference; or this check waits for the delete and sees the row gone.
  const rows = await executor.select({ id: m.id, kind: m.kind }).from(m).where(inArray(m.id, wanted)).for("share");
  if (rows.length !== wanted.length) {
    const message =
      kind === "video"
        ? "Seçilen videolardan biri artık kütüphanede yok. Videoyu yeniden seçin."
        : "Seçilen görsellerden biri artık kütüphanede yok. Görseli yeniden seçin.";
    throw new PanelError("invalid", message, { [field]: message });
  }
  if (kind !== "all" && rows.some((r) => r.kind !== kind)) {
    const message = wrongKindMessage(kind);
    throw new PanelError("invalid", message, { [field]: message });
  }
}

/** Day 6: a JSON key that holds video ids (videoMediaId, videoMediaIds, …); every other media key holds images. */
export function isVideoMediaKey(key: string): boolean {
  return MEDIA_KEY.test(key) && /video/i.test(key);
}

/**
 * Day 6: the media ids referenced in section/settings JSON, split by what the key promises
 * (`videoMediaId` → video, `imageId`/`posterImageId`/`mediaIds` → image), for ensureMediaExist per kind.
 */
export function mediaRefsByKind(value: unknown): { image: number[]; video: number[] } {
  const image = new Set<number>();
  const video = new Set<number>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, v] of Object.entries(node as Record<string, unknown>)) {
      if (MEDIA_KEY.test(key)) {
        const target = isVideoMediaKey(key) ? video : image;
        for (const item of Array.isArray(v) ? v : [v]) {
          const id = asMediaId(item);
          if (id) target.add(id);
        }
      } else if (v && typeof v === "object") {
        walk(v, depth + 1);
      }
    }
  };
  walk(value, 0);
  return { image: [...image], video: [...video] };
}

// ---------------------------------------------------------------------------------------------------
// Usage

const ROLE_LABELS: Record<string, string> = {
  gallery: "Galeri görseli",
  lifestyle: "Yaşam tarzı görseli",
  hero: "Kapak görseli",
  packshot: "Ambalaj görseli",
};

/** Keys in section content / settings JSON that hold media ids: imageId, mobileImageId, ogImageId, mediaIds, … */
const MEDIA_KEY = /(image|media)ids?$/i;

function asMediaId(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Every media id referenced under a media-like key anywhere in `value`. */
export function mediaIdsInJson(value: unknown, out: Set<number> = new Set(), depth = 0): Set<number> {
  if (!value || typeof value !== "object" || depth > 12) return out;
  if (Array.isArray(value)) {
    for (const item of value) mediaIdsInJson(item, out, depth + 1);
    return out;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (MEDIA_KEY.test(key)) {
      for (const item of Array.isArray(v) ? v : [v]) {
        const id = asMediaId(item);
        if (id) out.add(id);
      }
    } else if (v && typeof v === "object") {
      mediaIdsInJson(v, out, depth + 1);
    }
  }
  return out;
}

const ogId = (seo: SeoFields | null | undefined) => asMediaId(seo?.ogImageId);
const tr = (text: LocalizedText | null | undefined, fallback = "") => localize(text, "tr") || fallback;

const SETTINGS_LABELS: Record<string, { label: string; href: string }> = {
  general: { label: "Ayarlar › Genel", href: "/panel/ayarlar/genel" },
  seo: { label: "Ayarlar › SEO", href: "/panel/ayarlar/seo" },
  payments: { label: "Ayarlar › Ödeme yöntemleri", href: "/panel/ayarlar/odeme" },
};

/** What a media id under a settings document is used for (the usage list's detail line). */
const SETTINGS_MEDIA_DETAIL: Record<string, string> = {
  seo: "Varsayılan paylaşım görseli",
  payments: "PayTR logosu",
};

/**
 * Every reference to the given media ids: product images, variant images, option swatches, category
 * images, page-section content, settings (logos, share image), blog covers and SEO share images of
 * products, categories, pages, blog posts and legal texts.
 */
export async function collectMediaUsage(ids: readonly number[], executor: Tx = db): Promise<Map<number, MediaUsage[]>> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map<number, MediaUsage[]>(wanted.map((id) => [id, []]));
  if (wanted.length === 0) return out;
  const want = new Set(wanted);
  const add = (id: number | null, usage: MediaUsage) => {
    if (id !== null && want.has(id)) out.get(id)!.push(usage);
  };

  const p = schema.products;
  const c = schema.categories;
  const [productMedia, variants, swatches, products, categories, sections, pages, settings, posts, legal, videos] = await Promise.all([
    executor
      .select({ mediaId: schema.productMedia.mediaId, role: schema.productMedia.role, productId: p.id, name: p.name, kind: m.kind })
      .from(schema.productMedia)
      .innerJoin(p, eq(p.id, schema.productMedia.productId))
      .innerJoin(m, eq(m.id, schema.productMedia.mediaId))
      .where(inArray(schema.productMedia.mediaId, wanted)),
    executor
      .select({ mediaId: schema.productVariants.imageId, sku: schema.productVariants.sku, productId: p.id, name: p.name })
      .from(schema.productVariants)
      .innerJoin(p, eq(p.id, schema.productVariants.productId))
      .where(inArray(schema.productVariants.imageId, wanted)),
    executor
      .select({
        mediaId: schema.productOptionValues.swatchMediaId,
        value: schema.productOptionValues.value,
        option: schema.productOptions.name,
        productId: p.id,
        name: p.name,
      })
      .from(schema.productOptionValues)
      .innerJoin(schema.productOptions, eq(schema.productOptions.id, schema.productOptionValues.optionId))
      .innerJoin(p, eq(p.id, schema.productOptions.productId))
      .where(inArray(schema.productOptionValues.swatchMediaId, wanted)),
    executor.select({ id: p.id, name: p.name, seo: p.seo }).from(p).where(isNotNull(p.seo)),
    executor.select({ id: c.id, name: c.name, imageId: c.imageId, seo: c.seo }).from(c),
    executor
      .select({ pageId: schema.pageSections.pageId, type: schema.pageSections.type, content: schema.pageSections.content, title: schema.pages.title })
      .from(schema.pageSections)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageSections.pageId))
      .orderBy(asc(schema.pageSections.pageId), asc(schema.pageSections.position)),
    executor.select({ id: schema.pages.id, title: schema.pages.title, seo: schema.pages.seo }).from(schema.pages).where(isNotNull(schema.pages.seo)),
    executor.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings),
    executor
      .select({ id: schema.blogPosts.id, title: schema.blogPosts.title, coverId: schema.blogPosts.coverId, seo: schema.blogPosts.seo })
      .from(schema.blogPosts),
    executor
      .select({ key: schema.legalDocuments.key, title: schema.legalDocuments.title, version: schema.legalDocuments.version, seo: schema.legalDocuments.seo })
      .from(schema.legalDocuments)
      .where(isNotNull(schema.legalDocuments.seo)),
    // Day 6: videos whose cover image is one of the ids.
    executor
      .select({ id: m.id, posterId: m.posterId, alt: m.alt, originalName: m.originalName })
      .from(m)
      .where(inArray(m.posterId, wanted)),
  ]);

  for (const r of productMedia) {
    const detail = r.kind === "video" ? "Ürün videosu" : (ROLE_LABELS[r.role] ?? "Ürün görseli");
    add(r.mediaId, { kind: "product_media", label: tr(r.name, "Ürün"), detail, href: `/panel/urunler/${r.productId}` });
  }
  for (const r of variants) {
    add(r.mediaId, { kind: "variant", label: tr(r.name, "Ürün"), detail: `Varyant görseli · ${r.sku}`, href: `/panel/urunler/${r.productId}` });
  }
  for (const r of swatches) {
    add(r.mediaId, {
      kind: "option_swatch",
      label: tr(r.name, "Ürün"),
      detail: `Seçenek görseli · ${tr(r.option)}: ${tr(r.value)}`,
      href: `/panel/urunler/${r.productId}`,
    });
  }
  for (const r of products) {
    add(ogId(r.seo), { kind: "product", label: tr(r.name, "Ürün"), detail: "SEO paylaşım görseli", href: `/panel/urunler/${r.id}` });
  }
  for (const r of categories) {
    const href = `/panel/kategoriler/${r.id}`;
    add(r.imageId, { kind: "category", label: tr(r.name, "Kategori"), detail: "Kategori görseli", href });
    add(ogId(r.seo), { kind: "category", label: tr(r.name, "Kategori"), detail: "SEO paylaşım görseli", href });
  }
  for (const r of sections) {
    const label = isSectionType(r.type) ? sectionMeta[r.type].label : r.type;
    for (const id of mediaIdsInJson(r.content)) {
      add(id, { kind: "section", label: tr(r.title, "Sayfa"), detail: `Bölüm: ${label}`, href: `/panel/sayfalar/${r.pageId}` });
    }
  }
  for (const r of pages) {
    add(ogId(r.seo), { kind: "section", label: tr(r.title, "Sayfa"), detail: "SEO paylaşım görseli", href: `/panel/sayfalar/${r.id}` });
  }
  for (const r of settings) {
    const meta = SETTINGS_LABELS[r.key] ?? { label: `Ayarlar › ${r.key}`, href: "/panel/ayarlar" };
    const value = (r.value ?? {}) as { logo?: { lightId?: unknown; darkId?: unknown } };
    const light = asMediaId(value.logo?.lightId);
    const dark = asMediaId(value.logo?.darkId);
    if (r.key === "general") {
      add(light, { kind: "settings", label: meta.label, detail: "Logo (açık zemin)", href: meta.href });
      add(dark, { kind: "settings", label: meta.label, detail: "Logo (koyu zemin)", href: meta.href });
    }
    for (const id of mediaIdsInJson(r.value)) {
      add(id, { kind: "settings", label: meta.label, detail: SETTINGS_MEDIA_DETAIL[r.key] ?? "Görsel", href: meta.href });
    }
  }
  for (const r of posts) {
    const href = `/panel/blog/${r.id}`;
    add(r.coverId, { kind: "blog", label: tr(r.title, "Blog yazısı"), detail: "Kapak görseli", href });
    add(ogId(r.seo), { kind: "blog", label: tr(r.title, "Blog yazısı"), detail: "SEO paylaşım görseli", href });
  }
  for (const r of legal) {
    add(ogId(r.seo), { kind: "legal", label: tr(r.title, r.key), detail: `SEO paylaşım görseli · sürüm ${r.version}`, href: "/panel/yasal" });
  }
  for (const r of videos) {
    add(r.posterId, {
      kind: "video_poster",
      label: r.alt?.tr?.trim() || r.originalName || `Video #${r.id}`,
      detail: "Video kapak görseli",
      href: `/panel/medya?medya=${r.id}`,
    });
  }

  // One entry per place (a section that shows the same image twice is listed once).
  for (const [id, list] of out) {
    const seen = new Set<string>();
    out.set(
      id,
      list.filter((u) => {
        const key = `${u.kind}|${u.label}|${u.detail}|${u.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    );
  }
  return out;
}

/** Every place that references one media row (empty = safe to delete). */
export async function mediaUsage(mediaId: number, executor: Tx = db): Promise<MediaUsage[]> {
  return (await collectMediaUsage([mediaId], executor)).get(mediaId) ?? [];
}

/** "Lavanta Latte (Galeri görseli), Ana Sayfa (Bölüm: Kapak) ve 3 yer daha" for messages. */
export function describeUsage(usage: readonly MediaUsage[], max = 4): string {
  const parts = usage.slice(0, max).map((u) => `${u.label} (${u.detail})`);
  const rest = usage.length - parts.length;
  return rest > 0 ? `${parts.join(", ")} ve ${rest} yer daha` : parts.join(", ");
}
