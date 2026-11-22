// SEO Kontrol: turns the catalog/pages/blog rows (loaded by ./queries.ts) into one SeoPageInput per
// storefront URL and language, the way the storefront builds them. Pure (unit-tested).
//
// Mirrors (keep in step when these change):
// - titles/descriptions: generateMetadata of src/app/[locale]/page.tsx (home: absolute title, else the
//   layout's default title), urunler/page.tsx, kategori/[slug]/page.tsx, urunler/[slug]/page.tsx,
//   sayfa/[slug]/page.tsx, blog/[slug]/page.tsx and cmsPageMetadata (src/components/store/CmsPage.tsx),
//   i.e. seoText()/localize() fallbacks from src/lib/seo/localized.ts and src/i18n/localize.ts;
// - H1: a hero section renders one; CMS pages (reserved and /sayfa/<slug>) add the ListingHeader title
//   unless they start with a hero; listings, categories, products and posts have exactly one;
// - which URLs exist: the sitemap's rules (src/lib/data/sitemap.ts) plus hidden ones marked noindex.
// The crawler (scripts/seo-audit.ts) checks the rendered HTML; this view explains it per editor.
import { isSectionType, sectionMeta } from "@/components/sections/schemas";
import { intlLocale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import type { Locale, LocalizedText } from "@/i18n/locales";
import { wordCount } from "@/lib/panel/blog/reading";
import { isValidEan13 } from "@/lib/panel/format";
import { RESERVED_PAGES, isReservedPageSlug } from "@/lib/reserved-pages";
import { SEO_LIMITS, type SeoBodyInput, type SeoPageInput } from "./rules";

type Text = LocalizedText | null | undefined;
type SeoLike = { title?: LocalizedText; description?: LocalizedText; ogImageId?: number; noIndex?: boolean } | null;

export type SeoSourceSection = {
  type: string;
  content: unknown;
  /** Media ids referenced by the content (imageId, mediaIds, …). */
  mediaIds: number[];
};

export type SeoSourcePage = {
  id: number;
  slug: string;
  kind: string;
  title: LocalizedText;
  seo: SeoLike;
  /** Visible sections in their schedule window that guests see (audience all/retail), by position. */
  sections: SeoSourceSection[];
};

/** UI texts the storefront falls back to (getMessages, with panel overrides). */
export type SeoSourceMessages = {
  navProducts: string;
  businessTitle: string;
  sampleTitle: string;
  sampleIntro: string;
  contactTitle: string;
  contactIntro: string;
};

export type SeoSource = {
  /** Enabled storefront languages (settings.locales). */
  locales: readonly Locale[];
  site: {
    siteName: string;
    titleTemplate: string;
    defaultTitle: LocalizedText;
    description: LocalizedText;
    /** Default share image (settings.seo.ogImageId), when that media row exists. */
    defaultShareImage: boolean;
  };
  messages: Record<Locale, SeoSourceMessages>;
  /** Alternative texts of every media row referenced below. */
  mediaAlt: Record<number, LocalizedText | null>;
  /** The published home page (null: the storefront shows its built-in fallback). */
  home: SeoSourcePage | null;
  /** The published `urunler` page row that holds the products index copy, if any. */
  productsPage: SeoSourcePage | null;
  /** Other published pages (reserved and /sayfa/<slug>), home and `urunler` excluded. */
  pages: SeoSourcePage[];
  /** Visible categories. */
  categories: {
    id: number;
    slug: string;
    name: LocalizedText;
    description: Text;
    body: Text;
    imageId: number | null;
    seo: SeoLike;
  }[];
  /** Active standard and bundle products. */
  products: {
    id: number;
    slug: string;
    name: LocalizedText;
    subtitle: Text;
    shortDescription: Text;
    description: Text;
    seo: SeoLike;
    /** Product gallery and variant images, in display order. */
    mediaIds: number[];
    /** Active variants. */
    variants: { sku: string; barcode: string | null }[];
    /** "Yalnızca kurumsal": the product page is noindex and out of the sitemap and feed. */
    businessOnly?: boolean;
  }[];
  /** Blog posts visible now. */
  posts: {
    id: number;
    slug: string;
    title: LocalizedText;
    excerpt: Text;
    body: Text;
    coverId: number | null;
    seo: SeoLike;
  }[];
};

// ---------------------------------------------------------------------------------------------------
// Text resolution (seoText / localize)

/** A text and whether it is in the visitor's language (false: the Turkish fallback is shown). */
type Resolved = { text: string; translated: boolean };

type TextSource =
  /** Only the visitor's own language (ownLocaleText, seoText's first step). */
  | { own: Text }
  /** localize(): own language, else Turkish. */
  | { localized: Text }
  /** Already in the visitor's language (UI messages, site name). */
  | { literal: string };

const ownText = (text: Text, locale: Locale) => (text?.[locale] ?? "").trim();

function resolve(locale: Locale, sources: readonly TextSource[]): Resolved {
  for (const source of sources) {
    if ("literal" in source) {
      const text = source.literal.trim();
      if (text) return { text, translated: true };
      continue;
    }
    const text = "own" in source ? source.own : source.localized;
    const mine = ownText(text, locale);
    if (mine) return { text: mine, translated: true };
    if ("own" in source) continue;
    const tr = ownText(text, "tr");
    if (tr) return { text: tr, translated: locale === "tr" };
  }
  return { text: "", translated: true };
}

/** seoText(seo, locale, ...fallbacks): own SEO text, then the fallbacks, then the Turkish SEO text. */
const seoText = (locale: Locale, seo: Text, ...fallbacks: TextSource[]) =>
  resolve(locale, [{ own: seo }, ...fallbacks, { localized: seo }]);

/** `${a}${separator}${b}` (or either alone) from two localized texts. */
function joined(locale: Locale, a: Text, b: Text, separator: string): Resolved {
  const first = resolve(locale, [{ localized: a }]);
  const second = resolve(locale, [{ localized: b }]);
  if (!second.text) return first;
  if (!first.text) return second;
  return { text: `${first.text}${separator}${second.text}`, translated: first.translated && second.translated };
}

/**
 * The product page heading (productHeading in src/components/store/product-heading.ts): name + type
 * ("Lavanta Sıvı El Sabunu"), the type left out when the name already contains it. It is also the
 * page title when the product has no SEO title.
 */
function productHeadingText(locale: Locale, name: Text, subtitle: Text): Resolved {
  const first = resolve(locale, [{ localized: name }]);
  const second = resolve(locale, [{ localized: subtitle }]);
  const lower = (value: string) => value.toLocaleLowerCase(intlLocale(locale));
  if (first.text && second.text && lower(first.text).includes(lower(second.text))) return first;
  return joined(locale, name, subtitle, " ");
}

// ---------------------------------------------------------------------------------------------------
// Sections

type RenderedSection = { type: string; data: Record<string, unknown>; mediaIds: number[] };

/** Sections that render (known type, content passes its schema), like SectionRenderer. */
function renderable(sections: readonly SeoSourceSection[]): RenderedSection[] {
  const out: RenderedSection[] = [];
  for (const section of sections) {
    if (!isSectionType(section.type)) continue;
    const parsed = sectionMeta[section.type].schema.safeParse(section.content ?? {});
    if (parsed.success) out.push({ type: section.type, data: parsed.data as Record<string, unknown>, mediaIds: section.mediaIds });
  }
  return out;
}

const heroes = (sections: readonly RenderedSection[]) => sections.filter((s) => s.type === "hero");
const heroHeadline = (section: RenderedSection | undefined) => (section?.data.headline ?? null) as Text;
const heroEyebrow = (section: RenderedSection | undefined) => (section?.data.eyebrow ?? null) as Text;
const sectionMedia = (sections: readonly RenderedSection[]) => sections.flatMap((s) => s.mediaIds);

// ---------------------------------------------------------------------------------------------------
// Builder

type Common = Pick<SeoPageInput, "key" | "kind" | "label" | "editHref">;

export function seoPageInputs(source: SeoSource): SeoPageInput[] {
  const { site } = source;
  const template = site.titleTemplate.includes("%s") ? site.titleTemplate : `%s | ${site.siteName}`;
  const withTemplate = (title: string) => (title ? template.replace("%s", title) : "");

  const altMissing = (ids: readonly (number | null | undefined)[], locale: Locale) => {
    const unique = [...new Set(ids.filter((id): id is number => typeof id === "number" && Object.hasOwn(source.mediaAlt, id)))];
    return unique.filter((id) => !ownText(source.mediaAlt[id], locale)).length;
  };
  const mediaExists = (id: number | null | undefined) => typeof id === "number" && Object.hasOwn(source.mediaAlt, id);
  const share = (...own: (number | null | undefined)[]): SeoPageInput["shareImage"] =>
    own.some(mediaExists) ? "own" : site.defaultShareImage ? "default" : "none";

  const rows: SeoPageInput[] = [];
  const push = (
    common: Common,
    locale: Locale,
    parts: {
      path: string;
      title: Resolved;
      absoluteTitle?: boolean;
      description: Resolved;
      lowPriority?: boolean;
      h1: Resolved;
      h1Count: number;
      h1Noun?: string;
      body?: { text: Text; min: number; noun: string } | null;
      images: readonly (number | null | undefined)[];
      variantsWithoutGtin?: string[] | null;
      noIndex: boolean;
      noIndexReason?: SeoPageInput["noIndexReason"];
      shareImage: SeoPageInput["shareImage"];
    },
  ) => {
    const untranslated: string[] = [];
    if (parts.title.text && !parts.title.translated) untranslated.push("başlık");
    if (parts.description.text && !parts.description.translated) untranslated.push("açıklama");
    if (parts.h1.text && !parts.h1.translated) untranslated.push(parts.h1Noun ?? "ana başlık (H1)");
    let body: SeoBodyInput | null = null;
    if (parts.body) {
      const shown = resolve(locale, [{ localized: parts.body.text }]);
      body = { words: wordCount(shown.text), min: parts.body.min, noun: parts.body.noun, shownInTurkish: Boolean(shown.text) && !shown.translated };
      if (body.shownInTurkish) untranslated.push(parts.body.noun.toLocaleLowerCase("tr-TR"));
    }
    rows.push({
      ...common,
      locale,
      path: parts.path,
      title: parts.title.text,
      fullTitle: parts.absoluteTitle ? parts.title.text : withTemplate(parts.title.text),
      description: parts.description.text,
      lowPriority: parts.lowPriority ?? false,
      h1: parts.h1.text,
      h1Count: parts.h1.text ? parts.h1Count : 0,
      body,
      untranslated,
      imagesWithoutAlt: altMissing(parts.images, locale),
      variantsWithoutGtin: parts.variantsWithoutGtin ?? null,
      noIndex: parts.noIndex,
      ...(parts.noIndexReason ? { noIndexReason: parts.noIndexReason } : {}),
      shareImage: parts.shareImage,
    });
  };

  // Home: own SEO title as an absolute title, else the layout's default title; own description, else
  // the site description (the default is written for the home page). The first hero carries the H1.
  {
    const page = source.home;
    const sections = renderable(page?.sections ?? []);
    const heroList = heroes(sections);
    const first = sections[0]?.type === "hero" ? sections[0] : undefined;
    const common: Common = { key: "home", kind: "home", label: "Ana sayfa", editHref: page ? `/panel/sayfalar/${page.id}` : "/panel/sayfalar" };
    for (const locale of source.locales) {
      // STORE-UI (day 5): when the hero opens the page, its eyebrow is the first, smaller line of the H1.
      const headline = resolve(locale, [{ localized: heroHeadline(heroList[0]) }]);
      const eyebrow = first ? resolve(locale, [{ localized: heroEyebrow(first) }]) : { text: "", translated: true };
      push(common, locale, {
        path: href(locale, "home"),
        title: resolve(locale, [{ own: page?.seo?.title }, { localized: site.defaultTitle }, { literal: site.siteName }]),
        absoluteTitle: true,
        description: resolve(locale, [{ own: page?.seo?.description }, { localized: site.description }]),
        h1: { text: [eyebrow.text, headline.text].filter(Boolean).join(" "), translated: headline.translated && eyebrow.translated },
        h1Count: heroList.length,
        images: sectionMedia(sections),
        noIndex: page?.seo?.noIndex === true,
        shareImage: share(page?.seo?.ogImageId),
      });
    }
  }

  // /urunler: copy from the optional `urunler` page row (seoText fallbacks, like the other routes); its
  // sections render below the grid. The row's noindex and share image apply to the route (day 5 FIX).
  {
    const page = source.productsPage;
    const sections = renderable(page?.sections ?? []);
    const common: Common = {
      key: "products",
      kind: "products",
      label: "Tüm ürünler",
      editHref: page ? `/panel/sayfalar/${page.id}` : "/panel/sayfalar",
    };
    for (const locale of source.locales) {
      const nav = source.messages[locale].navProducts;
      push(common, locale, {
        path: href(locale, "products"),
        title: seoText(locale, page?.seo?.title, { localized: page?.title }, { literal: nav }),
        description: seoText(locale, page?.seo?.description),
        h1: resolve(locale, [{ localized: page?.title }, { literal: nav }]),
        h1Count: 1 + heroes(sections).length,
        images: sectionMedia(sections),
        noIndex: page?.seo?.noIndex === true,
        shareImage: share(page?.seo?.ogImageId),
      });
    }
  }

  for (const category of source.categories) {
    const common: Common = {
      key: `category:${category.id}`,
      kind: "category",
      label: category.name.tr || category.slug,
      editHref: `/panel/kategoriler/${category.id}`,
    };
    for (const locale of source.locales) {
      push(common, locale, {
        path: href(locale, "category", { slug: category.slug }),
        title: seoText(locale, category.seo?.title, { localized: category.name }),
        description: seoText(locale, category.seo?.description, { localized: category.description }),
        h1: resolve(locale, [{ localized: category.name }]),
        h1Count: 1,
        h1Noun: "kategori adı",
        body: { text: category.body, min: SEO_LIMITS.words.category, noun: "Kategori metni" },
        images: [category.imageId],
        noIndex: category.seo?.noIndex === true,
        shareImage: share(category.seo?.ogImageId, category.imageId),
      });
    }
  }

  for (const product of source.products) {
    const subtitle = product.subtitle?.tr?.trim();
    const common: Common = {
      key: `product:${product.id}`,
      kind: "product",
      label: subtitle ? `${product.name.tr} · ${subtitle}` : product.name.tr || product.slug,
      editHref: `/panel/urunler/${product.id}`,
    };
    const missingGtin = product.variants.filter((v) => !isValidEan13(v.barcode?.trim() ?? "")).map((v) => v.sku);
    for (const locale of source.locales) {
      const heading = productHeadingText(locale, product.name, product.subtitle);
      push(common, locale, {
        path: href(locale, "product", { slug: product.slug }),
        title: resolveWith(locale, product.seo?.title, heading),
        description: seoText(locale, product.seo?.description, { localized: product.shortDescription }),
        // STORE-UI (day 5): the H1 is the name with the product type ("Lavanta Sıvı El Sabunu").
        h1: heading,
        h1Count: 1,
        h1Noun: "ürün adı",
        body: { text: product.description, min: SEO_LIMITS.words.product, noun: "Ürün açıklaması" },
        images: product.mediaIds,
        variantsWithoutGtin: missingGtin,
        noIndex: product.seo?.noIndex === true || product.businessOnly === true,
        ...(product.businessOnly ? { noIndexReason: "business_only" as const } : {}),
        shareImage: share(product.seo?.ogImageId, ...product.mediaIds.slice(0, 1)),
      });
    }
  }

  for (const page of source.pages) {
    const sections = renderable(page.sections);
    const reserved = isReservedPageSlug(page.slug) ? page.slug : null;
    const startsWithHero = sections[0]?.type === "hero";
    // /kurumsal, /numune, /iletisim and /sayfa/<slug> show the ListingHeader only when they do not start
    // with a hero (the hero then holds the page title as the H1).
    const listingHeader = !startsWithHero;
    const heroList = heroes(sections);
    const common: Common = {
      key: `page:${page.id}`,
      kind: "page",
      label: page.title.tr || page.slug,
      editHref: `/panel/sayfalar/${page.id}`,
    };
    for (const locale of source.locales) {
      const m = source.messages[locale];
      const fallback =
        reserved === "kurumsal"
          ? { title: m.businessTitle, intro: "" }
          : reserved === "numune"
            ? { title: m.sampleTitle, intro: m.sampleIntro }
            : reserved === "iletisim"
              ? { title: m.contactTitle, intro: m.contactIntro }
              : null;
      const pageTitle = resolve(locale, [{ localized: page.title }, ...(fallback ? [{ literal: fallback.title }] : [])]);
      push(common, locale, {
        path: reserved ? href(locale, RESERVED_PAGES[reserved]) : href(locale, "page", { slug: page.slug }),
        title: seoText(locale, page.seo?.title, { localized: page.title }, ...(fallback ? [{ literal: fallback.title }] : [])),
        description: seoText(locale, page.seo?.description, ...(fallback?.intro ? [{ literal: fallback.intro }] : [])),
        // Legal texts (KVKK, contracts…) are not search targets.
        lowPriority: page.kind === "legal",
        h1: listingHeader ? pageTitle : resolve(locale, [{ localized: heroHeadline(heroList[0]) }]),
        h1Count: (listingHeader ? 1 : 0) + heroList.length,
        images: sectionMedia(sections),
        noIndex: page.seo?.noIndex === true,
        shareImage: share(page.seo?.ogImageId),
      });
    }
  }

  for (const post of source.posts) {
    const common: Common = { key: `post:${post.id}`, kind: "post", label: post.title.tr || post.slug, editHref: `/panel/blog/${post.id}` };
    for (const locale of source.locales) {
      push(common, locale, {
        path: href(locale, "post", { slug: post.slug }),
        title: seoText(locale, post.seo?.title, { localized: post.title }),
        description: seoText(locale, post.seo?.description, { localized: post.excerpt }),
        h1: resolve(locale, [{ localized: post.title }]),
        h1Count: 1,
        h1Noun: "yazı başlığı",
        body: { text: post.body, min: SEO_LIMITS.words.post, noun: "Yazı metni" },
        images: [post.coverId],
        noIndex: post.seo?.noIndex === true,
        shareImage: share(post.seo?.ogImageId, post.coverId),
      });
    }
  }

  return rows;
}

/** seoText with an already-resolved fallback (a text composed of several localized parts). */
function resolveWith(locale: Locale, seo: Text, fallback: Resolved): Resolved {
  const mine = ownText(seo, locale);
  if (mine) return { text: mine, translated: true };
  if (fallback.text) return fallback;
  return resolve(locale, [{ localized: seo }]);
}
