// Fixture HTML for the SEO audit tests (day 5, SEO-AUDIT). The shape copies what Next 16 / React 19
// print for this site: React attribute casing (charSet, hrefLang, fetchPriority), metadata in <head>,
// the page body streamed into <div hidden id="S:0"> and swapped in by $RC, JSON-LD scripts in the body.

export const ORIGIN = "http://check.localhost:3580";
export const LOCALES = ["tr", "en", "ar"] as const;
export const NOW = new Date("2026-11-10T12:00:00.000Z");

export const PATHS = {
  product: { tr: "/tr/urunler/lavanta", en: "/en/products/lavanta", ar: "/ar/products/lavanta" },
  category: { tr: "/tr/kategori/el-sabunu", en: "/en/category/el-sabunu", ar: "/ar/category/el-sabunu" },
  home: { tr: "/tr", en: "/en", ar: "/ar" },
} as const;

export type Locale = (typeof LOCALES)[number];

export const url = (path: string) => `${ORIGIN}${path}`;

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** JSON for a <script type="application/ld+json"> the way jsonLd() prints it ("<" escaped). */
export const ldScript = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).split("<").join("\\u003c")}</script>`;

export type PageSpec = {
  locale?: Locale;
  lang?: string | null;
  dir?: string | null;
  title?: string | null;
  description?: string | null;
  canonical?: string | null;
  /** hreflang → absolute href; default: the three locales + x-default of `paths`. */
  alternates?: Record<string, string> | null;
  paths?: Record<Locale, string>;
  robots?: string | null;
  ogTitle?: string | null;
  ogImage?: string | null;
  ogUrl?: string | null;
  h1?: string[];
  /** Extra body HTML (inside the streamed segment). */
  body?: string;
  jsonLd?: unknown[];
  /** Put the metadata in <body> (streamed metadata) instead of <head>. */
  metadataInBody?: boolean;
};

/** A complete, valid page (zero issues) unless the spec breaks something on purpose. */
export function pageHtml(spec: PageSpec = {}): string {
  const locale = spec.locale ?? "tr";
  const paths = spec.paths ?? PATHS.product;
  const self = url(paths[locale]);
  const lang = spec.lang === undefined ? locale : spec.lang;
  const dir = spec.dir === undefined ? (locale === "ar" ? "rtl" : "ltr") : spec.dir;
  const title = spec.title === undefined ? "Lavanta Sıvı El Sabunu | PRESTİJ" : spec.title;
  const description =
    spec.description === undefined
      ? "Lavanta kokulu sıvı el sabunu: pompalı şişe, 5 L ve 20 L bidon seçenekleriyle evde, ofiste ve otelde ferah bir temizlik için PRESTİJ kalitesi."
      : spec.description;
  const canonical = spec.canonical === undefined ? self : spec.canonical;
  const alternates =
    spec.alternates === undefined ? { tr: url(paths.tr), en: url(paths.en), ar: url(paths.ar), "x-default": url(paths.tr) } : spec.alternates;
  const ogTitle = spec.ogTitle === undefined ? title?.replace(/ \| PRESTİJ$/, "") ?? null : spec.ogTitle;
  const ogImage = spec.ogImage === undefined ? url("/media/urunler/lavanta/lavanta-1024.webp") : spec.ogImage;
  const ogUrl = spec.ogUrl === undefined ? canonical : spec.ogUrl;
  const h1 = spec.h1 ?? ["Lavanta"];

  const meta = [
    title !== null ? `<title>${escapeText(title)}</title>` : "",
    description !== null ? `<meta name="description" content="${escapeAttr(description)}"/>` : "",
    spec.robots ? `<meta name="robots" content="${escapeAttr(spec.robots)}"/>` : "",
    canonical !== null ? `<link rel="canonical" href="${escapeAttr(canonical)}"/>` : "",
    ...Object.entries(alternates ?? {}).map(([k, v]) => `<link rel="alternate" hrefLang="${k}" href="${escapeAttr(v)}"/>`),
    ogTitle !== null ? `<meta property="og:title" content="${escapeAttr(ogTitle)}"/>` : "",
    ogUrl !== null ? `<meta property="og:url" content="${escapeAttr(ogUrl)}"/>` : "",
    ogImage !== null ? `<meta property="og:image" content="${escapeAttr(ogImage)}"/>` : "",
    `<meta name="twitter:card" content="summary_large_image"/>`,
  ].join("");

  const htmlAttrs = [lang !== null ? `lang="${lang}"` : "", dir !== null ? `dir="${dir}"` : "", `class="antialiased"`].filter(Boolean).join(" ");
  const content = [
    `<nav aria-label="Breadcrumb"><a href="/${locale}">Ana sayfa</a><a href="${paths[locale].replace(/\/[^/]+$/, "") || `/${locale}`}">Ürünler</a></nav>`,
    ...h1.map((h) => `<h1 class="font-heading">${h}</h1>`),
    `<picture><source type="image/avif" srcSet="/media/x-480.avif 480w"/><img src="/media/urunler/lavanta/lavanta-1024.webp" alt="Lavanta sıvı el sabunu, pompalı cam şişe" fetchPriority="high" width="1024" height="1536"/></picture>`,
    `<img src="/media/urunler/lavanta/thumb.webp" alt="" loading="lazy"/>`,
    spec.body ?? "",
    ...(spec.jsonLd ?? []).map(ldScript),
  ].join("");

  return [
    "<!DOCTYPE html>",
    `<html ${htmlAttrs}>`,
    `<head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>`,
    spec.metadataInBody ? "" : meta,
    `<script src="/_next/static/chunks/main.js" async=""></script></head>`,
    `<body class="flex min-h-dvh"><div hidden="">${spec.metadataInBody ? `<!--$-->${meta}<!--/$-->` : "<!--$--><!--/$-->"}</div>`,
    `<a href="#main">İçeriğe geç</a>`,
    `<header><a href="/${locale}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Logo</title><path d="M0 0h24v24H0z"/></svg></a></header>`,
    `<main id="main"><!--$?--><template id="B:0"></template><div class="animate-pulse"><h1>Yükleniyor</h1></div><!--/$--></main>`,
    `<footer><a href="tel:+903523533070">Ara</a><a href="mailto:info@example.com">E-posta</a><a href="https://wa.me/903523533070">WhatsApp</a></footer>`,
    `<script>self.__next_f.push([1,"<!--$?--><h1>not markup</h1>"])</script>`,
    `<div hidden id="S:0">${content}</div><script>$RC=function(a,b){};$RC("B:0","S:0")</script>`,
    "</body></html>",
  ].join("");
}

// ---------------------------------------------------------------------------------------------------
// JSON-LD fixtures (valid by default)

export function productLd(overrides: Record<string, unknown> = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Lavanta — Sıvı El Sabunu",
    description: "Lavanta çiçekleri, ametist tonları ve altın detaylarla klasik bir zarafet.",
    url: url(PATHS.product.tr),
    image: [url("/media/urunler/lavanta/lavanta-1024.webp")],
    brand: { "@type": "Brand", name: "PRESTİJ" },
    sku: "PR-LAV-500",
    offers: [
      {
        "@type": "Offer",
        url: url(PATHS.product.tr),
        sku: "PR-LAV-500",
        price: "149.90",
        priceCurrency: "TRY",
        itemCondition: "https://schema.org/NewCondition",
        availability: "https://schema.org/InStock",
        seller: { "@type": "Organization", name: "PRESTİJ" },
      },
      {
        "@type": "Offer",
        url: url(PATHS.product.tr),
        sku: "PR-LAV-5L",
        gtin13: "8685317540009",
        price: "449.90",
        priceCurrency: "TRY",
        itemCondition: "https://schema.org/NewCondition",
        availability: "https://schema.org/InStock",
        seller: { "@type": "Organization", name: "PRESTİJ" },
      },
    ],
    ...overrides,
  };
}

export const SHIPPING = {
  "@type": "OfferShippingDetails",
  shippingRate: { "@type": "MonetaryAmount", value: "99.90", currency: "TRY" },
  shippingDestination: { "@type": "DefinedRegion", addressCountry: "TR" },
  deliveryTime: {
    "@type": "ShippingDeliveryTime",
    handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
    transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 3, unitCode: "DAY" },
  },
};

export const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "TR",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 14,
  returnMethod: "https://schema.org/ReturnByMail",
};

export function variant(sku: string, size: string, id: number, extra: Record<string, unknown> = {}) {
  const variantUrl = `${url(PATHS.product.tr)}?varyant=${id}`;
  return {
    "@type": "Product",
    name: `Lavanta Sıvı El Sabunu ${size}`,
    description: `Lavanta kokulu sıvı el sabunu, ${size}.`,
    sku,
    size,
    image: [url("/media/urunler/lavanta/lavanta-1024.webp")],
    url: variantUrl,
    offers: {
      "@type": "Offer",
      url: variantUrl,
      price: "149.90",
      priceCurrency: "TRY",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      shippingDetails: SHIPPING,
      hasMerchantReturnPolicy: RETURN_POLICY,
    },
    ...extra,
  };
}

export function productGroupLd(overrides: Record<string, unknown> = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: "Lavanta Sıvı El Sabunu",
    description: "Lavanta kokulu sıvı el sabunu.",
    url: url(PATHS.product.tr),
    brand: { "@type": "Brand", name: "PRESTİJ" },
    productGroupID: "lavanta",
    variesBy: ["https://schema.org/size"],
    hasVariant: [variant("PR-LAV-500", "500 ml", 11), variant("PR-LAV-5L", "5 L", 12, { gtin13: "8685317540009" })],
    ...overrides,
  };
}

export function breadcrumbLd(lastHasItem = false) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana sayfa", item: url("/tr") },
      { "@type": "ListItem", position: 2, name: "Ürünler", item: url("/tr/urunler") },
      { "@type": "ListItem", position: 3, name: "Lavanta", ...(lastHasItem ? { item: url(PATHS.product.tr) } : {}) },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------
// Feed fixtures

export function feedXml(items: string[], { namespace = true, channel = true } = {}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0"${namespace ? ' xmlns:g="http://base.google.com/ns/1.0"' : ""}>`,
    "<channel>",
    channel ? `<title>PRESTİJ</title><link>${ORIGIN}/tr</link><description>PRESTİJ ürünleri</description>` : "",
    ...items,
    "</channel></rss>",
  ].join("\n");
}

export function feedItem(fields: Record<string, string | string[] | null> = {}, shipping: string | null = "<g:shipping><g:country>TR</g:country><g:price>99.90 TRY</g:price></g:shipping>"): string {
  const defaults: Record<string, string | string[] | null> = {
    "g:id": "PR-LAV-500",
    "g:item_group_id": "lavanta",
    title: "PRESTİJ Lavanta Sıvı El Sabunu 500 ml",
    description: "Lavanta kokulu sıvı el sabunu, pompalı şişe.",
    link: `${url(PATHS.product.tr)}?varyant=11`,
    "g:image_link": url("/media/urunler/lavanta/lavanta-1024.webp"),
    "g:availability": "in_stock",
    "g:price": "149.90 TRY",
    "g:brand": "PRESTİJ",
    "g:identifier_exists": "no",
    "g:mpn": "PR-LAV-500",
    "g:condition": "new",
    "g:google_product_category": "3208",
    "g:product_type": "Sıvı El Sabunu > Lavanta",
  };
  const merged = { ...defaults, ...fields };
  const body = Object.entries(merged)
    .flatMap(([k, v]) => (v === null ? [] : (Array.isArray(v) ? v : [v]).map((value) => `<${k}>${escapeText(value)}</${k}>`)))
    .join("");
  return `<item>${body}${shipping ?? ""}</item>`;
}
