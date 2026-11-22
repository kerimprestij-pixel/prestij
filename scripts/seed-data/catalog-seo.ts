// CONTENT-CATALOG (day 5): the catalogSeo step of scripts/content-day5.ts, plus the seeded values it may
// replace. The new content itself lives in the seed definitions (catalog-copy.ts, products.ts, site.ts,
// home-page.ts, site-pages.ts, media-alt.ts), so a fresh database gets the same from the seed.
//
// What the step does on an existing database (docs/DAY5-SEO.md §5.5, §6):
//   - settings.seo description; the home page SEO texts; the SEO texts of /kurumsal, /numune, /iletisim;
//   - categories: el-sabunu renamed "Sıvı El Sabunu"; SEO texts, editorial body and FAQ of the three
//     visible categories;
//   - products: SEO texts, and the factual sections appended to each description;
//   - an FAQ section on the home page (after the story), the /urunler copy page (slug "urunler") and the
//     new page /sayfa/hakkimizda, each only when missing;
//   - menus: keyword link texts, Hakkımızda and Blog in the corporate footer column;
//   - alt texts of the 49 product photos;
//   - the legal pages' SEO descriptions (LEGAL_PAGE_DESCRIPTIONS), only where a page has none;
//   - copy corrections made after the first run (CATEGORY_COPY_FIXES, PRODUCT_SEO_FIXES,
//     SECTION_COPY_FIXES incl. ABOUT_STORY_BODY_FIXES, HAND_SOAP_WARNINGS_FIXES): a value content-day5.ts
//     (or days 1–4) already wrote is replaced only while it is still exactly a version written earlier
//     (the current seed text with the later correction rounds undone, ./content-fixes.ts).
// Every update happens only while the stored value is still exactly the previous seeded default (an empty
// value counts as never set); anything else is reported as edited in the panel and left alone.
// Inserts happen only when the row is missing. A second run reports nothing to do.
import { and, asc, eq, like } from "drizzle-orm";
import { sectionMeta, type SectionType } from "@/components/sections/schemas";
import { categories, media, menus, pages, pageSections, products, settings } from "@/db/schema";
import type { CategoryFaqItem } from "@/db/schema/catalog";
import type { LocalizedText, SeoFields } from "@/db/schema/common";
import type { MenuItem } from "@/db/schema/site";
import { seoSettings } from "@/lib/settings/types";
import { CATEGORY_COPY, CATEGORY_COPY_FIXES, PRODUCT_SEO_FIXES, type CategoryCopySlug, type ProductCopySlug } from "./catalog-copy";
import { earlierVersions, type LocaleFixes } from "./content-fixes";
import { decideDefaultUpdate, emptyReport, getAt, lt as t, setAt, SKIP_REASON, type ContentReport } from "./content-helpers";
import type { ScriptDb } from "./db";
import { HOME_FAQ_SECTION, homePageMeta, type SeedSection } from "./home-page";
import { MEDIA_ALT } from "./media-alt";
import { DAY1_MEDIA_ALT } from "./media-alt-day1";
import { BUNDLE, HAND_SOAP_WARNINGS_FIXES, SCENTS } from "./products";
import { LEGAL_PAGE_DESCRIPTIONS, LEGAL_PAGES, MENUS, SEO_SETTINGS_TEXT } from "./site";
import { SECTION_COPY_FIXES, SITE_PAGES, type SectionCopyFix, type SitePageSeed } from "./site-pages";

type L = LocalizedText;
type Seo = { title: L; description: L };

// ---------------------------------------------------------------------------------------------
// Previous seeded defaults (what days 1–4 wrote). Only these values are ever replaced.

/** settings.seo.description until day 4. */
const DAY1_SITE_DESCRIPTION = t(
  "Lavanta Latte, Lavanta, Portakal ve Okyanus. Ev, otel, spa ve ofisler için premium sıvı el sabunu ve duş jeli.",
  "Lavender Latte, Lavender, Orange and Ocean. Premium liquid hand soap and shower gel for homes, hotels, spas and offices.",
  "لاتيه اللافندر واللافندر والبرتقال والمحيط. صابون سائل لليدين وجل استحمام فاخر للمنازل والفنادق والسبا والمكاتب.",
);

const DAY1_SITE_TITLE = t("PRESTİJ — Sıvı El Sabunu ve Duş Jeli", "PRESTİJ — Liquid Hand Soap & Shower Gel", "PRESTİJ — صابون سائل لليدين وجل استحمام");

/** The home page row's SEO until day 4: the seed copied settings.seo (home-page.ts' own texts were unused). */
const DAY1_HOME_SEO: Seo[] = [
  { title: DAY1_SITE_TITLE, description: DAY1_SITE_DESCRIPTION },
  {
    title: DAY1_SITE_TITLE,
    description: t(
      "Lavanta Latte, Lavanta, Portakal ve Okyanus. Ev, otel, spa ve ofisler için pompalı şişe, 5 L ve 20 L seçenekleriyle premium sıvı el sabunu ve duş jeli.",
      "Lavender Latte, Lavender, Orange and Ocean. Premium liquid hand soap and shower gel in pump bottles, 5 L and 20 L for homes, hotels, spas and offices.",
      "لاتيه اللافندر واللافندر والبرتقال والمحيط. صابون سائل فاخر لليدين وجل استحمام بزجاجات المضخة وعبوات 5 و20 لتراً للمنازل والفنادق والمنتجعات والمكاتب.",
    ),
  },
];

/** SEO texts of the reserved pages until day 4 (scripts/seed-data/site-pages.ts, day 3). */
const DAY3_PAGE_SEO: Record<"kurumsal" | "numune" | "iletisim", Seo> = {
  kurumsal: {
    title: t(
      "Kurumsal Satış: Oteller, Spa'lar, Ofisler ve Restoranlar",
      "Business Sales: Hotels, Spas, Offices and Restaurants",
      "مبيعات الشركات: الفنادق ومراكز السبا والمكاتب والمطاعم",
    ),
    description: t(
      "PRESTİJ sıvı el sabunu ve duş jelini 500 ml pompalı şişe, 5 L ve 20 L bidonlarla işletmenize özel fiyatla tedarik edin. Kayseri'de üretilir; önce ücretsiz numuneyle deneyin.",
      "Supply PRESTİJ liquid hand soap and shower gel in 500 ml pump bottles and 5 L and 20 L canisters, priced for your business. Made in Kayseri; try free samples first.",
      "احصل على صابون PRESTİJ السائل لليدين وجل الاستحمام بزجاجات المضخة سعة 500 مل وعبوات 5 و20 لترًا بأسعار مخصّصة لمنشأتك. يُصنَع في قيصري؛ جرّب العيّنات المجانية أولًا.",
    ),
  },
  numune: {
    title: t("Ücretsiz Numune: Kokuları Önce Deneyin", "Free Samples: Try the Scents First", "عيّنات مجانية: جرّب العطور أولًا"),
    description: t(
      "Otel, spa, ofis ve restoranlara ücretsiz PRESTİJ numunesi. Lavanta Latte, Lavanta, Portakal ve Okyanus kokularını karar vermeden önce kendi mekânınızda deneyin.",
      "Free PRESTİJ samples for hotels, spas, offices and restaurants. Try Lavender Latte, Lavender, Orange and Ocean in your own space before you decide.",
      "عيّنات PRESTİJ مجانية للفنادق ومراكز السبا والمكاتب والمطاعم. جرّب لاتيه اللافندر واللافندر والبرتقال والمحيط في مكانك قبل أن تقرّر.",
    ),
  },
  iletisim: {
    title: t("İletişim", "Contact Us", "اتصل بنا"),
    description: t(
      "Sorularınız, siparişleriniz, kurumsal teklif ve numune talepleriniz için bize telefonla, WhatsApp'tan ya da formdan ulaşın.",
      "Reach us by phone, on WhatsApp or through the form for questions, orders, business quotes and sample requests.",
      "تواصل معنا هاتفيًا أو عبر واتساب أو من خلال النموذج لأسئلتك وطلباتك وعروض الأسعار وطلبات العيّنات.",
    ),
  },
};

/** Category names until day 4 (only el-sabunu changes). */
const DAY1_CATEGORY_NAMES: Record<CategoryCopySlug, L> = {
  "el-sabunu": t("El Sabunu", "Hand Soap", "صابون اليدين"),
  "dus-jeli": t("Duş Jeli", "Shower Gel", "جل الاستحمام"),
  "hediye-setleri": t("Hediye Setleri", "Gift Sets", "مجموعات الهدايا"),
};

/** Product SEO until day 4 (scripts/seed.ts seoFor): "<name> <subtitle>" and the short description. */
function day1ProductSeo(product: { name: L; subtitle: L; shortDescription: L }): Seo {
  const { name, subtitle } = product;
  return {
    title: { tr: `${name.tr} ${subtitle.tr}`, en: `${name.en} ${subtitle.en}`, ar: `${subtitle.ar} ${name.ar}` },
    description: product.shortDescription,
  };
}

const item = (tr: string, en: string, ar: string, href: string, children?: MenuItem[]): MenuItem => ({
  label: { tr, en, ar },
  href,
  ...(children ? { children } : {}),
});

const DAY1_CATEGORY_LINKS: MenuItem[] = [
  item("El Sabunu", "Hand Soap", "صابون اليدين", "/kategori/el-sabunu"),
  item("Duş Jeli", "Shower Gel", "جل الاستحمام", "/kategori/dus-jeli"),
  item("Hediye Setleri", "Gift Sets", "مجموعات الهدايا", "/kategori/hediye-setleri"),
];

/** Menus as days 1–4 seeded them (footer_corporate: day 4 with the form anchors, and day 3 before them). */
const PREVIOUS_MENUS: Record<"header" | "footer_shop" | "footer_corporate", MenuItem[][]> = {
  header: [
    [
      item("Ürünler", "Products", "المنتجات", "/urunler", DAY1_CATEGORY_LINKS),
      item("Kurumsal", "Business", "للشركات", "/kurumsal"),
      item("Numune", "Samples", "العينات", "/numune"),
      item("Blog", "Blog", "المدونة", "/blog"),
      item("İletişim", "Contact", "اتصل بنا", "/iletisim"),
    ],
  ],
  footer_shop: [[item("Tüm Ürünler", "All Products", "جميع المنتجات", "/urunler"), ...DAY1_CATEGORY_LINKS]],
  footer_corporate: [
    [
      item("Kurumsal Satış", "Business Sales", "مبيعات الشركات", "/kurumsal"),
      item("Numune Talebi", "Sample Request", "طلب عينة", "/numune#numune-formu"),
      item("Toplu Alım", "Bulk Orders", "الطلبات بالجملة", "/kurumsal#teklif"),
      item("İletişim", "Contact", "اتصل بنا", "/iletisim"),
    ],
    [
      item("Kurumsal Satış", "Business Sales", "مبيعات الشركات", "/kurumsal"),
      item("Numune Talebi", "Sample Request", "طلب عينة", "/numune"),
      item("Toplu Alım", "Bulk Orders", "الطلبات بالجملة", "/iletisim?konu=teklif"),
      item("İletişim", "Contact", "اتصل بنا", "/iletisim"),
    ],
  ],
};

/** Exported for the tests: every value the step may replace. */
export const CATALOG_SEO_PREVIOUS = {
  siteTitle: DAY1_SITE_TITLE,
  siteDescription: DAY1_SITE_DESCRIPTION,
  homeSeo: DAY1_HOME_SEO,
  pageSeo: DAY3_PAGE_SEO,
  categoryNames: DAY1_CATEGORY_NAMES,
  productSeo: day1ProductSeo,
  menus: PREVIOUS_MENUS,
  mediaAlt: DAY1_MEDIA_ALT,
} as const;

/** An empty stored value means "never set": filling it is not overwriting a client edit. */
const EMPTY = [undefined, null] as const;

/** Every earlier version of a title/description pair whose fields were corrected after the first run. */
function seoVersions(next: Seo, fixes: { title?: LocaleFixes; description?: LocaleFixes } | undefined): Seo[] {
  return earlierVersions(next, [
    { path: ["title"], fixes: fixes?.title },
    { path: ["description"], fixes: fixes?.description },
  ]);
}

// ---------------------------------------------------------------------------------------------
// The step

export async function runCatalogSeo(db: ScriptDb): Promise<ContentReport> {
  const report = emptyReport();
  const now = new Date();
  await updateSiteSeo(db, report, now);
  await updatePageSeo(db, report, now);
  await fillLegalPageDescriptions(db, report, now);
  await updateCategories(db, report, now);
  await updateProducts(db, report, now);
  await correctHandSoapWarnings(db, report, now);
  await insertHomeFaq(db, report);
  for (const slug of ["urunler", "hakkimizda"] as const) await insertPage(db, report, slug);
  await correctSectionCopy(db, report, now);
  await updateMenus(db, report, now);
  await updateMediaAlt(db, report, now);
  return report;
}

/** Decides one value and records a skip line; true when it may be written. */
function mayUpdate(report: ContentReport, where: string, current: unknown, next: unknown, ...previous: unknown[]): boolean {
  const decision = decideDefaultUpdate(current, next, ...previous);
  if (decision === "update") return true;
  report.skipped.push(`${where}: ${SKIP_REASON[decision]}`);
  return false;
}

async function updateSiteSeo(db: ScriptDb, report: ContentReport, now: Date) {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "seo")).limit(1);
  if (!row) {
    report.skipped.push("settings.seo: no stored row (the built-in defaults apply), left as is");
    return;
  }
  const value = { ...(row.value as Record<string, unknown>) };
  const changed: string[] = [];
  if (mayUpdate(report, "settings.seo.defaultTitle", value.defaultTitle, SEO_SETTINGS_TEXT.defaultTitle, DAY1_SITE_TITLE, ...EMPTY)) {
    value.defaultTitle = SEO_SETTINGS_TEXT.defaultTitle;
    changed.push("defaultTitle");
  }
  if (mayUpdate(report, "settings.seo.description", value.description, SEO_SETTINGS_TEXT.description, DAY1_SITE_DESCRIPTION, ...EMPTY)) {
    value.description = SEO_SETTINGS_TEXT.description;
    changed.push("description");
  }
  if (!changed.length) return;
  if (!seoSettings.safeParse(value).success) {
    report.skipped.push("settings.seo: the update would not validate, left as is");
    return;
  }
  await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, "seo"));
  report.updated.push(`settings seo: ${changed.join(", ")}`);
}

/** Merges new SEO texts into a stored seo object, field by field (ogImageId / noIndex are kept). */
function nextSeo(report: ContentReport, where: string, current: SeoFields | null, next: Seo, previous: Seo[]): SeoFields | null {
  const seo: SeoFields = { ...(current ?? {}) };
  let changed = false;
  for (const field of ["title", "description"] as const) {
    if (mayUpdate(report, `${where} seo.${field}`, current?.[field], next[field], ...previous.map((p) => p[field]), ...EMPTY)) {
      seo[field] = next[field];
      changed = true;
    }
  }
  return changed ? seo : null;
}

async function updatePageSeo(db: ScriptDb, report: ContentReport, now: Date) {
  const targets: { slug: string; next: Seo; previous: Seo[] }[] = [
    { slug: "home", next: homePageMeta.seo, previous: DAY1_HOME_SEO },
    ...(["kurumsal", "numune", "iletisim"] as const).map((slug) => ({ slug, next: seedPage(slug).seo as Seo, previous: [DAY3_PAGE_SEO[slug]] })),
  ];
  for (const target of targets) {
    const [page] = await db.select({ id: pages.id, seo: pages.seo }).from(pages).where(eq(pages.slug, target.slug)).limit(1);
    if (!page) {
      report.skipped.push(`page ${target.slug}: missing, SEO texts not set`);
      continue;
    }
    const seo = nextSeo(report, `page ${target.slug}`, page.seo, target.next, target.previous);
    if (!seo) continue;
    await db.update(pages).set({ seo, updatedAt: now }).where(eq(pages.id, page.id));
    report.updated.push(`pages #${page.id}: ${target.slug} seo (title/description)`);
  }
}

/**
 * The legal pages (/sayfa/kvkk, …) were seeded with an SEO title only, so they all shared the site's
 * default description. Each gets its own (LEGAL_PAGE_DESCRIPTIONS) where its description is still empty;
 * the title, share image and noindex flag are kept.
 */
async function fillLegalPageDescriptions(db: ScriptDb, report: ContentReport, now: Date) {
  for (const { slug } of LEGAL_PAGES) {
    const [page] = await db.select({ id: pages.id, seo: pages.seo }).from(pages).where(eq(pages.slug, slug)).limit(1);
    if (!page) {
      report.skipped.push(`page ${slug}: missing, SEO description not set`);
      continue;
    }
    const description = LEGAL_PAGE_DESCRIPTIONS[slug];
    if (!mayUpdate(report, `page ${slug} seo.description`, page.seo?.description, description, ...EMPTY)) continue;
    await db.update(pages).set({ seo: { ...(page.seo ?? {}), description }, updatedAt: now }).where(eq(pages.id, page.id));
    report.updated.push(`pages #${page.id}: ${slug} seo.description`);
  }
}

async function updateCategories(db: ScriptDb, report: ContentReport, now: Date) {
  for (const slug of Object.keys(CATEGORY_COPY) as CategoryCopySlug[]) {
    const copy = CATEGORY_COPY[slug];
    const [row] = await db
      .select({ id: categories.id, name: categories.name, seo: categories.seo, body: categories.body, faq: categories.faq })
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    const where = `category ${slug}`;
    if (!row) {
      report.skipped.push(`${where}: missing, left as is`);
      continue;
    }
    const set: { name?: L; seo?: SeoFields; body?: L; faq?: CategoryFaqItem[] } = {};
    // What content-day5.ts wrote before each later correction round (empty when the copy was never corrected).
    const fixes = CATEGORY_COPY_FIXES[slug];
    const earlierBodies = earlierVersions(copy.body, [{ path: [], fixes: fixes?.body }]);
    const earlierSeo = seoVersions(copy.seo, { title: fixes?.seoTitle, description: fixes?.seoDescription });
    const earlierFaqs = earlierVersions(copy.faq, fixes?.faq ?? []);
    if (mayUpdate(report, `${where} name`, row.name, copy.name, DAY1_CATEGORY_NAMES[slug])) set.name = copy.name;
    const seo = nextSeo(report, where, row.seo, copy.seo, earlierSeo);
    if (seo) set.seo = seo;
    if (mayUpdate(report, `${where} body`, row.body, copy.body, ...earlierBodies, ...EMPTY)) set.body = copy.body;
    if (mayUpdate(report, `${where} faq`, row.faq, copy.faq, ...earlierFaqs, [], ...EMPTY)) set.faq = copy.faq;
    const fields = Object.keys(set);
    if (!fields.length) continue;
    await db.update(categories).set({ ...set, updatedAt: now }).where(eq(categories.id, row.id));
    report.updated.push(`categories #${row.id}: ${slug} ${fields.join(", ")}`);
  }
}

async function updateProducts(db: ScriptDb, report: ContentReport, now: Date) {
  const seeds: { slug: ProductCopySlug; story: L; description: L; seo: Seo; previousSeo: Seo }[] = [
    ...SCENTS.map((s) => ({ slug: s.slug as ProductCopySlug, story: s.story, description: s.description, seo: s.seo, previousSeo: day1ProductSeo(s) })),
    { slug: BUNDLE.slug, story: BUNDLE.story, description: BUNDLE.description, seo: BUNDLE.seo, previousSeo: day1ProductSeo(BUNDLE) },
  ];
  for (const seed of seeds) {
    const [row] = await db
      .select({ id: products.id, description: products.description, seo: products.seo })
      .from(products)
      .where(eq(products.slug, seed.slug))
      .limit(1);
    const where = `product ${seed.slug}`;
    if (!row) {
      report.skipped.push(`${where}: missing, left as is`);
      continue;
    }
    const set: { description?: L; seo?: SeoFields } = {};
    if (mayUpdate(report, `${where} description`, row.description, seed.description, seed.story)) set.description = seed.description;
    const seo = nextSeo(report, where, row.seo, seed.seo, [seed.previousSeo, ...seoVersions(seed.seo, PRODUCT_SEO_FIXES[seed.slug])]);
    if (seo) set.seo = seo;
    const fields = Object.keys(set);
    if (!fields.length) continue;
    await db.update(products).set({ ...set, updatedAt: now }).where(eq(products.id, row.id));
    report.updated.push(`products #${row.id}: ${seed.slug} ${fields.map((f) => (f === "description" ? "description (sections appended)" : f)).join(", ")}`);
  }
}

/**
 * The hand soaps' warnings, and their samples' (the seed copies them from the scent), get the eye-contact
 * caution while they still hold the printed label text alone (HAND_SOAP_WARNINGS_FIXES in products.ts).
 */
async function correctHandSoapWarnings(db: ScriptDb, report: ContentReport, now: Date) {
  for (const scent of SCENTS.filter((s) => s.category === "el-sabunu")) {
    const earlier = earlierVersions(scent.warnings, [{ path: [], fixes: HAND_SOAP_WARNINGS_FIXES }]);
    for (const slug of [scent.slug, `${scent.slug}-numune`]) {
      const [row] = await db.select({ id: products.id, warnings: products.warnings }).from(products).where(eq(products.slug, slug)).limit(1);
      if (!row) {
        report.skipped.push(`product ${slug}: missing, warnings left as is`);
        continue;
      }
      if (!mayUpdate(report, `product ${slug} warnings`, row.warnings, scent.warnings, ...earlier)) continue;
      await db.update(products).set({ warnings: scent.warnings, updatedAt: now }).where(eq(products.id, row.id));
      report.updated.push(`products #${row.id}: ${slug} warnings (eye-contact caution)`);
    }
  }
}

function seedPage(slug: SitePageSeed["slug"]): SitePageSeed {
  const page = SITE_PAGES.find((p) => p.slug === slug);
  if (!page) throw new Error(`site-pages.ts has no page "${slug}"`);
  return page;
}

/** Media id by file stem (seeded keys look like "urunler/<product>/<stem>-<width>.webp"). */
async function mediaIdsByStem(db: ScriptDb): Promise<Map<string, number>> {
  const rows = await db.select({ id: media.id, storageKey: media.storageKey }).from(media).orderBy(asc(media.id));
  const byStem = new Map<string, number>();
  for (const row of rows) {
    const stem = stemOf(row.storageKey);
    if (stem && !byStem.has(stem)) byStem.set(stem, row.id);
  }
  return byStem;
}

/** "urunler/okyanus/PRESTIJ_Okyanus_5L_spa_dus-1024.webp" → "PRESTIJ_Okyanus_5L_spa_dus". */
export function stemOf(storageKey: string): string | null {
  const match = /(?:^|\/)([^/]+?)-\d+\.[a-z0-9]+$/i.exec(storageKey);
  return match ? match[1] : null;
}

/** Section content with "@media:<stem>" replaced by ids (null when the image is gone), validated. */
function resolveContent(section: SeedSection, byStem: Map<string, number>, missing: string[]): Record<string, unknown> {
  const resolve = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = /^@media:(.+)$/.exec(value);
      if (!match) return value;
      const id = byStem.get(match[1]);
      if (id === undefined) missing.push(match[1]);
      return id ?? null;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
    return value;
  };
  const type = section.type as SectionType;
  return sectionMeta[type].schema.parse(resolve(section.content)) as Record<string, unknown>;
}

async function insertHomeFaq(db: ScriptDb, report: ContentReport) {
  const [home] = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, "home")).limit(1);
  if (!home) {
    report.skipped.push("home FAQ: the home page is missing, not added");
    return;
  }
  const sections = await db
    .select({ id: pageSections.id, type: pageSections.type, position: pageSections.position })
    .from(pageSections)
    .where(eq(pageSections.pageId, home.id))
    .orderBy(asc(pageSections.position), asc(pageSections.id));
  const existing = sections.find((s) => s.type === "faq");
  if (existing) {
    report.skipped.push(`home FAQ: the home page already has an FAQ section (#${existing.id})`);
    return;
  }
  const content = resolveContent(HOME_FAQ_SECTION, new Map(), []);
  // Same position as the story: the storefront and the panel order by (position, id), so the FAQ lands
  // right after the story (and before the newsletter) without renumbering the client's sections.
  const anchor = sections.find((s) => s.type === "story");
  const position = anchor ? anchor.position : sections.reduce((max, s) => Math.max(max, s.position + 1), 0);
  const [row] = await db
    .insert(pageSections)
    .values({ pageId: home.id, type: "faq", position, isVisible: true, content, audience: "all" })
    .returning({ id: pageSections.id });
  report.inserted.push(`page_sections #${row.id}: faq on the home page (position ${position}, after ${anchor ? `story #${anchor.id}` : "the last section"})`);
}

async function insertPage(db: ScriptDb, report: ContentReport, slug: "urunler" | "hakkimizda") {
  const seed = seedPage(slug);
  const [existing] = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, slug)).limit(1);
  if (existing) {
    report.skipped.push(`page ${slug}: already exists (#${existing.id}), left as is`);
    return;
  }
  const byStem = await mediaIdsByStem(db);
  const missing: string[] = [];
  const rows = seed.sections.map((s) => ({ type: s.type, position: s.position, content: resolveContent(s, byStem, missing) }));
  const [page] = await db
    .insert(pages)
    .values({ slug, kind: seed.kind, title: seed.title, seo: seed.seo, isPublished: true })
    .returning({ id: pages.id });
  const inserted = await db
    .insert(pageSections)
    .values(rows.map((r) => ({ pageId: page.id, type: r.type, position: r.position, isVisible: true, content: r.content, audience: "all" as const })))
    .returning({ id: pageSections.id });
  const where = slug === "urunler" ? "/urunler copy page" : `/sayfa/${slug}`;
  report.inserted.push(`pages #${page.id}: ${where} (${seed.kind}, published) with ${inserted.length} sections: ${rows.map((r) => r.type).join(", ")}`);
  for (const stem of new Set(missing)) report.skipped.push(`${where}: image ${stem} not in the media library, shown without it`);
}

/**
 * Copy corrections inside existing page sections (SECTION_COPY_FIXES in site-pages.ts, e.g. the /kurumsal
 * hero and the /sayfa/hakkimizda story): the first section of the recorded type on the page gets the seed
 * text at each recorded path while its stored text is still a version written earlier; every other field
 * of the section is kept. The page row's updatedAt moves with it, as a panel save would (the sitemap
 * lastmod and the editor's lock follow the page row). A page inserted above already has the seed text.
 */
async function correctSectionCopy(db: ScriptDb, report: ContentReport, now: Date) {
  const groups = new Map<string, SectionCopyFix[]>();
  for (const fix of SECTION_COPY_FIXES) {
    const key = `${fix.page} ${fix.type}`;
    groups.set(key, [...(groups.get(key) ?? []), fix]);
  }
  const touchedPages = new Set<number>();
  for (const fixes of groups.values()) {
    const { page: slug, type } = fixes[0];
    const seedContent = seedPage(slug).sections.find((s) => s.type === type)?.content;
    if (!seedContent) throw new Error(`site-pages.ts: /${slug} has no ${type} section for its copy corrections`);
    const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, slug)).limit(1);
    if (!page) {
      report.skipped.push(`page ${slug}: missing, ${type} copy corrections not applied`);
      continue;
    }
    const [section] = await db
      .select({ id: pageSections.id, content: pageSections.content })
      .from(pageSections)
      .where(and(eq(pageSections.pageId, page.id), eq(pageSections.type, type)))
      .orderBy(asc(pageSections.position), asc(pageSections.id))
      .limit(1);
    if (!section) {
      report.skipped.push(`page ${slug} ${type}: no ${type} section (removed in the panel), left as is`);
      continue;
    }
    let content: unknown = section.content ?? {};
    const changed: string[] = [];
    for (const fix of fixes) {
      const path = [...fix.path];
      const next = getAt(seedContent, path);
      if (!next) throw new Error(`site-pages.ts: /${slug} ${type} has no text at ${path.join(".")}`);
      const earlier = earlierVersions(next, [{ path: [], fixes: fix.fixes }]);
      if (!mayUpdate(report, `page ${slug} ${type} #${section.id} ${path.join(".")}`, getAt(content, path), next, ...earlier)) continue;
      content = setAt(content, path, next);
      changed.push(path.join("."));
    }
    if (!changed.length) continue;
    if (!sectionMeta[type].schema.safeParse(content).success) {
      report.skipped.push(`page ${slug} ${type} #${section.id}: the corrected content would not validate, left as is`);
      continue;
    }
    await db.update(pageSections).set({ content: content as Record<string, unknown>, updatedAt: now }).where(eq(pageSections.id, section.id));
    touchedPages.add(page.id);
    report.updated.push(`page_sections #${section.id}: ${slug} ${type} ${changed.join(", ")} (corrections after review)`);
  }
  for (const id of touchedPages) await db.update(pages).set({ updatedAt: now }).where(eq(pages.id, id));
}

async function updateMenus(db: ScriptDb, report: ContentReport, now: Date) {
  for (const key of ["header", "footer_shop", "footer_corporate"] as const) {
    const [menu] = await db.select({ id: menus.id, items: menus.items }).from(menus).where(eq(menus.key, key)).limit(1);
    if (!menu) {
      report.skipped.push(`menu ${key}: missing (the storefront shows its built-in links), left as is`);
      continue;
    }
    if (!mayUpdate(report, `menu ${key}`, menu.items, MENUS[key], ...PREVIOUS_MENUS[key])) continue;
    await db.update(menus).set({ items: MENUS[key], updatedAt: now }).where(eq(menus.id, menu.id));
    const labels = MENUS[key].map((i) => (i.children?.length ? `${i.label.tr} (${i.children.map((c) => c.label.tr).join(", ")})` : i.label.tr));
    report.updated.push(`menus #${menu.id}: ${key} → ${labels.join(" · ")}`);
  }
}

async function updateMediaAlt(db: ScriptDb, report: ContentReport, now: Date) {
  const rows = await db
    .select({ id: media.id, storageKey: media.storageKey, alt: media.alt })
    .from(media)
    .where(like(media.storageKey, "urunler/%"))
    .orderBy(asc(media.id));
  const byStem = new Map(rows.flatMap((r) => (stemOf(r.storageKey) ? [[stemOf(r.storageKey)!, r] as const] : [])));
  const toUpdate: { id: number; stem: string; alt: L }[] = [];
  let upToDate = 0;
  for (const [stem, next] of Object.entries(MEDIA_ALT)) {
    const row = byStem.get(stem);
    if (!row) {
      report.skipped.push(`media ${stem}: not in the media library`);
      continue;
    }
    const decision = decideDefaultUpdate(row.alt, next, DAY1_MEDIA_ALT[stem], ...EMPTY);
    if (decision === "update") toUpdate.push({ id: row.id, stem, alt: next });
    else if (decision === "up_to_date") upToDate += 1;
    else report.skipped.push(`media #${row.id} ${stem} alt: ${SKIP_REASON.edited}`);
  }
  if (upToDate) report.skipped.push(`media alt texts: ${upToDate} ${SKIP_REASON.up_to_date}`);
  for (const change of toUpdate) {
    await db.update(media).set({ alt: change.alt, updatedAt: now }).where(eq(media.id, change.id));
  }
  if (toUpdate.length) {
    report.updated.push(`media alt texts (tr/en/ar): ${toUpdate.length} product photos (#${toUpdate.map((c) => c.id).join(", #")})`);
  }
}
