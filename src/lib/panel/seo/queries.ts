// SEO Kontrol data: reads what the storefront shows (uncached, straight from the database, so the
// report reflects a save immediately) and grades it with the pure rules. Callers check the role
// (admin, like settings). No Next APIs: DB tests call loadSeoReport(tx) directly.
import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema";
import { mergeUiStringOverrides } from "@/i18n/get-messages";
import type { Locale } from "@/i18n/locales";
import { imageOnly } from "@/lib/data/media";
import type { PriceCheckRow } from "@/lib/pricing/placeholder-prices";
import { mediaIdsInJson } from "@/lib/panel/media/queries";
import { readAllSettings } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { seoPageInputs, type SeoSource, type SeoSourcePage, type SeoSourceMessages } from "./pages";
import { buildSeoReport, type SeoReport } from "./rules";

/**
 * SR-6: every variant with its product's status and type, for placeholderPriceCheck() (the launch checklist's
 * "Fiyatlar gerçek" step; the go-live scripts read the same columns with PRICE_CHECK_ROWS_SQL).
 */
export async function loadPriceCheckRows(executor: Tx = db): Promise<PriceCheckRow[]> {
  const V = schema.productVariants;
  const PR = schema.products;
  return executor
    .select({ sku: V.sku, price: V.price, stock: V.stock, variantActive: V.isActive, productStatus: PR.status, productType: PR.type })
    .from(V)
    .innerJoin(PR, eq(PR.id, V.productId))
    .orderBy(asc(V.id));
}

/** Page-builder slug that holds the /urunler copy (not a page of its own; see src/lib/data/sitemap.ts). */
export const PRODUCTS_PAGE_SLUG = "urunler";
const HOME_PAGE_SLUG = "home";

const asSeo = (seo: SeoFields | null) => (seo && typeof seo === "object" ? seo : null);

/** Everything the report needs, read in one go (≈ ten small queries). */
export async function loadSeoSource(executor: Tx = db, now: Date = new Date()): Promise<SeoSource> {
  const { pages: P, pageSections: S, categories: C, products: PR, productVariants: V, productMedia: PM, blogPosts: B, media: M } = schema;

  const [settings, uiStrings, mediaRows, pageRows, sectionRows, categoryRows, productRows, postRows] = await Promise.all([
    readAllSettings(executor),
    executor.select({ key: schema.uiStrings.key, value: schema.uiStrings.value }).from(schema.uiStrings),
    // Images only (day 6): a video never counts as an image without alt text or as a share image.
    executor.select({ id: M.id, alt: M.alt }).from(M).where(imageOnly(M)),
    executor
      .select({ id: P.id, slug: P.slug, kind: P.kind, title: P.title, seo: P.seo })
      .from(P)
      .where(eq(P.isPublished, true))
      .orderBy(asc(P.id)),
    executor
      .select({ pageId: S.pageId, type: S.type, content: S.content })
      .from(S)
      .where(
        and(
          eq(S.isVisible, true),
          ne(S.audience, "business"),
          or(isNull(S.startsAt), lte(S.startsAt, now)),
          or(isNull(S.endsAt), gt(S.endsAt, now)),
        ),
      )
      .orderBy(asc(S.pageId), asc(S.position), asc(S.id)),
    executor
      .select({ id: C.id, slug: C.slug, name: C.name, description: C.description, body: C.body, imageId: C.imageId, seo: C.seo })
      .from(C)
      .where(eq(C.isVisible, true))
      .orderBy(asc(C.position), asc(C.id)),
    executor
      .select({
        id: PR.id,
        slug: PR.slug,
        name: PR.name,
        subtitle: PR.subtitle,
        shortDescription: PR.shortDescription,
        description: PR.description,
        seo: PR.seo,
        businessOnly: PR.businessOnly,
      })
      .from(PR)
      .where(and(eq(PR.status, "active"), inArray(PR.type, ["standard", "bundle"])))
      .orderBy(asc(PR.position), asc(PR.id)),
    executor
      .select({ id: B.id, slug: B.slug, title: B.title, excerpt: B.excerpt, body: B.body, coverId: B.coverId, seo: B.seo })
      .from(B)
      .where(and(eq(B.status, "published"), or(isNull(B.publishedAt), lte(B.publishedAt, now))))
      .orderBy(desc(B.publishedAt), desc(B.id)),
  ]);

  const productIds = productRows.map((p) => p.id);
  const [variantRows, productMediaRows] = productIds.length
    ? await Promise.all([
        executor
          .select({ productId: V.productId, sku: V.sku, barcode: V.barcode, imageId: V.imageId })
          .from(V)
          .where(and(inArray(V.productId, productIds), eq(V.isActive, true)))
          .orderBy(asc(V.productId), asc(V.position), asc(V.id)),
        executor
          .select({ productId: PM.productId, mediaId: PM.mediaId })
          .from(PM)
          .innerJoin(M, eq(M.id, PM.mediaId))
          .where(and(inArray(PM.productId, productIds), imageOnly(M)))
          .orderBy(asc(PM.productId), asc(PM.position), asc(PM.id)),
      ])
    : [[], []];

  const sectionsByPage = new Map<number, SeoSourcePage["sections"]>();
  for (const row of sectionRows) {
    const list = sectionsByPage.get(row.pageId) ?? [];
    list.push({ type: row.type, content: row.content, mediaIds: [...mediaIdsInJson(row.content)] });
    sectionsByPage.set(row.pageId, list);
  }
  const toPage = (row: (typeof pageRows)[number]): SeoSourcePage => ({
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    seo: asSeo(row.seo),
    sections: sectionsByPage.get(row.id) ?? [],
  });

  const locales = settings.locales.enabled as Locale[];
  const messages = Object.fromEntries(
    (["tr", "en", "ar"] as const).map((locale) => {
      const m = mergeUiStringOverrides(locale, uiStrings);
      const value: SeoSourceMessages = {
        navProducts: m.nav.products,
        businessTitle: m.nav.business,
        sampleTitle: m.sample.title,
        sampleIntro: m.sample.subtitle,
        contactTitle: m.contact.title,
        contactIntro: m.contact.subtitle,
      };
      return [locale, value];
    }),
  ) as Record<Locale, SeoSourceMessages>;

  const mediaAlt: Record<number, LocalizedText | null> = {};
  for (const row of mediaRows) mediaAlt[row.id] = row.alt ?? null;
  const seo = settings.seo;

  return {
    locales,
    site: {
      siteName: settings.general.siteName,
      titleTemplate: seo.titleTemplate,
      defaultTitle: seo.defaultTitle,
      description: seo.description,
      defaultShareImage: seo.ogImageId !== null && Object.hasOwn(mediaAlt, seo.ogImageId),
    },
    messages,
    mediaAlt,
    // The home route reads getPage("home"); /sayfa/<slug> serves every other published page except kind "home".
    home: pageRows.filter((p) => p.slug === HOME_PAGE_SLUG).map(toPage)[0] ?? null,
    productsPage: pageRows.filter((p) => p.slug === PRODUCTS_PAGE_SLUG && p.kind !== "home").map(toPage)[0] ?? null,
    pages: pageRows.filter((p) => p.kind !== "home" && p.slug !== HOME_PAGE_SLUG && p.slug !== PRODUCTS_PAGE_SLUG).map(toPage),
    categories: categoryRows.map((c) => ({ ...c, seo: asSeo(c.seo) })),
    products: productRows.map((p) => ({
      ...p,
      seo: asSeo(p.seo),
      mediaIds: [
        ...productMediaRows.filter((m) => m.productId === p.id).map((m) => m.mediaId),
        ...variantRows.filter((v) => v.productId === p.id && v.imageId !== null).map((v) => v.imageId as number),
      ],
      variants: variantRows.filter((v) => v.productId === p.id).map((v) => ({ sku: v.sku, barcode: v.barcode })),
    })),
    posts: postRows.map((p) => ({ ...p, seo: asSeo(p.seo) })),
  };
}

/** The graded report shown on /panel/seo. */
export async function loadSeoReport(executor: Tx = db, now: Date = new Date()): Promise<SeoReport> {
  return buildSeoReport(seoPageInputs(await loadSeoSource(executor, now)));
}
