"use server";
// Data for the panel pickers (ProductPicker, CategoryPicker, LinkInput). Editor+; uncached (drafts
// and fresh edits included). Names are Turkish strings (the panel language).
import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProductStatus, ProductType } from "@/db/schema/catalog";
import { localize } from "@/i18n/localize";
import { imageOnly } from "@/lib/data/media";
import { toMediaLike, type MediaLike } from "@/lib/media/types";
import { requirePanelActor } from "./action";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "./format";

export type PickerProduct = {
  id: number;
  /** Turkish name, e.g. "Lavanta Latte". */
  name: string;
  /** Turkish subtitle, e.g. "Sıvı El Sabunu". */
  subtitle: string | null;
  slug: string;
  /** SKU of the variant that matched the search, else of the default variant. */
  sku?: string;
  status: ProductStatus;
  type: ProductType;
  thumb: MediaLike | null;
};

export type PickerCategory = { id: number; name: string; slug: string; isVisible: boolean };

export type LinkTarget = { label: string; href: string };
export type LinkTargetGroup = { label: string; items: LinkTarget[] };

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;
const tr = (text: Parameters<typeof localize>[0]) => localize(text, "tr");

const PICKER_LIMIT = 30;

/** Products for pickers: name or subtitle (any locale), slug, SKU or barcode; active first, then position; at most 30. */
export async function pickerProducts(q?: string): Promise<PickerProduct[]> {
  await requirePanelActor("editor");
  const p = schema.products;
  const v = schema.productVariants;
  const term = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const like = term ? `%${escapeLike(foldText(term))}%` : null;

  const variantMatch = like ? sql`(${fold(sql`${v.sku}`)} like ${like} or ${fold(sql`${v.barcode}`)} like ${like})` : null;
  const where = like
    ? or(
        sql`${fold(sql`${p.name}::text`)} like ${like}`,
        sql`${fold(sql`${p.subtitle}::text`)} like ${like}`,
        sql`${fold(sql`${p.slug}`)} like ${like}`,
        // Explicit aliases: drizzle may render columns unqualified inside a single-table query.
        sql`exists (select 1 from product_variants pv where pv.product_id = "products"."id" and (${fold(sql.raw("pv.sku"))} like ${like} or ${fold(sql.raw("pv.barcode"))} like ${like}))`,
      )
    : undefined;

  const rows = await db
    .select({ id: p.id, name: p.name, subtitle: p.subtitle, slug: p.slug, status: p.status, type: p.type })
    .from(p)
    .where(where)
    .orderBy(sql`case ${p.status} when 'active' then 0 when 'draft' then 1 else 2 end`, asc(p.position), asc(p.id))
    .limit(PICKER_LIMIT);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [variants, thumbs] = await Promise.all([
    db
      .select({
        productId: v.productId,
        sku: v.sku,
        matched: variantMatch ? sql<boolean>`${variantMatch}` : sql<boolean>`false`,
        isDefault: v.isDefault,
      })
      .from(v)
      .where(inArray(v.productId, ids))
      .orderBy(asc(v.productId), asc(v.position), asc(v.id)),
    db
      .selectDistinctOn([schema.productMedia.productId], {
        productId: schema.productMedia.productId,
        id: schema.media.id,
        url: schema.media.url,
        width: schema.media.width,
        height: schema.media.height,
        alt: schema.media.alt,
        blurDataUrl: schema.media.blurDataUrl,
        dominantColor: schema.media.dominantColor,
        variants: schema.media.variants,
      })
      .from(schema.productMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
      // The first image of each product (day 6: a product video is never a picker thumbnail).
      .where(and(inArray(schema.productMedia.productId, ids), imageOnly()))
      .orderBy(schema.productMedia.productId, asc(schema.productMedia.position), asc(schema.productMedia.id)),
  ]);

  // First matching variant, else the default one, else the first one.
  const skuByProduct = new Map<number, string>();
  const pick = (accept: (row: (typeof variants)[number]) => boolean) => {
    for (const row of variants) if (!skuByProduct.has(row.productId) && accept(row)) skuByProduct.set(row.productId, row.sku);
  };
  pick((row) => row.matched);
  pick((row) => row.isDefault);
  pick(() => true);
  const thumbByProduct = new Map(thumbs.map(({ productId, ...media }) => [productId, toMediaLike(media)]));

  return rows.map((r) => ({
    id: r.id,
    name: tr(r.name),
    subtitle: tr(r.subtitle) || null,
    slug: r.slug,
    ...(skuByProduct.has(r.id) ? { sku: skuByProduct.get(r.id) } : {}),
    status: r.status,
    type: r.type,
    thumb: thumbByProduct.get(r.id) ?? null,
  }));
}

/** Every category in position order. */
export async function pickerCategories(): Promise<PickerCategory[]> {
  await requirePanelActor("editor");
  const c = schema.categories;
  const rows = await db
    .select({ id: c.id, name: c.name, slug: c.slug, isVisible: c.isVisible })
    .from(c)
    .orderBy(asc(c.position), asc(c.id));
  return rows.map((r) => ({ id: r.id, name: tr(r.name), slug: r.slug, isVisible: r.isVisible }));
}

/** Storefront routes with their own folder; CMS pages with these slugs are served there (not /sayfa). */
const ROUTE_PAGES: Record<string, string> = { kurumsal: "/kurumsal", numune: "/numune", iletisim: "/iletisim" };
/** Page-builder rows that hold copy for another route and are not linkable pages. */
const NOT_LINKABLE = new Set(["home", "urunler"]);

const STATIC_TARGETS: LinkTarget[] = [
  { label: "Ana sayfa", href: "/" },
  { label: "Tüm ürünler", href: "/urunler" },
  { label: "Kurumsal", href: "/kurumsal" },
  { label: "Ücretsiz numune", href: "/numune" },
  { label: "Blog", href: "/blog" },
  { label: "İletişim", href: "/iletisim" },
  { label: "Sepet", href: "/sepet" },
  { label: "Sipariş sorgulama", href: "/siparis" },
];

/**
 * Internal link choices for LinkInput, grouped. Hrefs are locale-less canonical Turkish paths
 * ("/urunler/lavanta"); the storefront localizes them (localizePath). Only published/visible targets.
 */
export async function linkTargets(): Promise<LinkTargetGroup[]> {
  await requirePanelActor("editor");
  const p = schema.products;
  const c = schema.categories;
  const pg = schema.pages;
  const b = schema.blogPosts;
  const [products, categories, pages, posts] = await Promise.all([
    db
      .select({ name: p.name, subtitle: p.subtitle, slug: p.slug })
      .from(p)
      .where(and(eq(p.status, "active"), ne(p.type, "sample")))
      .orderBy(asc(p.position), asc(p.id)),
    db.select({ name: c.name, slug: c.slug }).from(c).where(eq(c.isVisible, true)).orderBy(asc(c.position), asc(c.id)),
    db.select({ title: pg.title, slug: pg.slug, kind: pg.kind }).from(pg).where(eq(pg.isPublished, true)).orderBy(asc(pg.slug)),
    db
      .select({ title: b.title, slug: b.slug })
      .from(b)
      .where(and(eq(b.status, "published"), sql`${b.publishedAt} is not null and ${b.publishedAt} <= now()`))
      .orderBy(desc(b.publishedAt))
      .limit(200),
  ]);

  const customPages = pages.filter((x) => x.kind !== "legal" && !NOT_LINKABLE.has(x.slug));
  const groups: LinkTargetGroup[] = [
    { label: "Sayfalar", items: [...STATIC_TARGETS] },
    {
      label: "Ürünler",
      items: products.map((x) => ({ label: [tr(x.name), tr(x.subtitle)].filter(Boolean).join(" — "), href: `/urunler/${x.slug}` })),
    },
    { label: "Kategoriler", items: categories.map((x) => ({ label: tr(x.name), href: `/kategori/${x.slug}` })) },
    {
      label: "Özel sayfalar",
      items: customPages
        .filter((x) => !ROUTE_PAGES[x.slug])
        .map((x) => ({ label: tr(x.title), href: `/sayfa/${x.slug}` })),
    },
    {
      label: "Yasal metinler",
      items: pages.filter((x) => x.kind === "legal").map((x) => ({ label: tr(x.title), href: `/sayfa/${x.slug}` })),
    },
    { label: "Blog yazıları", items: posts.map((x) => ({ label: tr(x.title), href: `/blog/${x.slug}` })) },
  ];
  return groups.filter((g) => g.items.length > 0);
}
