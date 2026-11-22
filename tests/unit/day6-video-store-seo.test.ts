// Day 6 VIDEO-STORE, SEO: the VideoObject builder (one document per video, Google's required and
// recommended fields), the Product/ProductGroup markup staying byte-identical when a product has videos,
// the SEO audit's VideoObject rule (required fields, ISO duration, contentUrl ≠ page, distinct videos are
// not a duplicated type) and the video sitemap (per-locale titles, XML escaping, Next's serializer output
// read back by the audit's parser).
//   npx tsx --test tests/unit/day6-video-store-seo.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { MetadataRoute } from "next";
import { jsonLd } from "@/components/store/format";
import { absoluteUrl, href } from "@/i18n/paths";
import type { ProductDetail, ProductVideoData } from "@/lib/data/catalog";
import type { MediaLike } from "@/lib/media/types";
import { checkJsonLd, isIsoDuration, type JsonLdContext } from "@/lib/seo/audit/jsonld";
import { parseSitemapXml, checkSitemap } from "@/lib/seo/audit/sitemap";
import { buildSitemap, sitemapText, sitemapVideos, type SitemapData, type SitemapVideo } from "@/lib/seo/sitemap-entries";
import { isoDuration, productGroupJsonLd, productVideoName, productVideosJsonLd } from "@/lib/seo/structured-data";
import { settingsSchemas } from "@/lib/settings/types";

const ORIGIN = "https://prestij.example";
let savedOrigin: string | undefined;
before(() => {
  savedOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
});
after(() => {
  if (savedOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedOrigin;
});

const general = settingsSchemas.general.parse({});
const seo = settingsSchemas.seo.parse({});
const shipping = settingsSchemas.shipping.parse({});

const media = (id: number, url: string): MediaLike => ({ id, url, width: 1200, height: 1500, alt: null, blurDataUrl: null, dominantColor: null, variants: null });

function video(id: number, overrides: Partial<ProductVideoData> = {}): ProductVideoData {
  return {
    id,
    url: `/uploads/videos/lavanta-${id}.mp4`,
    mime: "video/mp4",
    width: 1080,
    height: 1350,
    durationMs: 75_000,
    autoplay: false,
    alt: null,
    uploadedAt: "2026-11-12T08:30:00.000Z",
    poster: media(900 + id, `/media/urunler/lavanta/kapak-${id}-1200.webp`),
    variantId: null,
    slot: 1,
    ...overrides,
  };
}

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 1,
    slug: "lavanta",
    type: "standard",
    name: { tr: "Lavanta", en: "Lavender", ar: "اللافندر" },
    subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap", ar: "صابون سائل لليدين" },
    shortDescription: { tr: "Lavanta kokulu sıvı el sabunu.", en: "Lavender-scented liquid hand soap." },
    description: null,
    accentColor: null,
    themeOverrides: null,
    scentNotes: null,
    usage: null,
    warnings: null,
    ingredients: null,
    claims: [],
    specs: [],
    seo: null,
    isFeatured: false,
    businessOnly: false,
    allowSubscription: false,
    ratingAverage: 0,
    ratingCount: 0,
    categoryId: 1,
    category: { id: 1, slug: "el-sabunu", name: { tr: "El Sabunu", en: "Hand Soap" } },
    options: [],
    variants: [
      { id: 11, sku: "LAV-500", barcode: null, price: 14990, compareAtPrice: null, vatRate: 20, stock: 10, trackStock: true, allowBackorder: false, lowStockThreshold: 5, volumeMl: 500, weightGrams: 750, minQuantity: 1, maxQuantity: null, imageId: null, isDefault: true, optionValueIds: [] },
    ],
    defaultVariantId: 11,
    media: [{ media: media(5, "/media/urunler/lavanta/a-1200.webp"), variantId: null, role: "packshot" }],
    tiers: [],
    bundleItems: [],
    related: [],
    sampleProductSlug: null,
    campaign: null,
    ...overrides,
  };
}

const pageUrl = (locale: "tr" | "en" | "ar" = "tr") => absoluteUrl(href(locale, "product", { slug: "lavanta" }));
const ctx = (locale: "tr" | "en" | "ar" = "tr"): JsonLdContext => ({ pageUrl: pageUrl(locale), canonical: pageUrl(locale), origin: ORIGIN, pageLang: locale, now: new Date("2026-11-12T12:00:00Z") });

describe("isoDuration", () => {
  test("whole seconds as an ISO 8601 duration; unknown or zero gives null", () => {
    assert.equal(isoDuration(42_000), "PT42S");
    assert.equal(isoDuration(75_000), "PT1M15S");
    assert.equal(isoDuration(60_000), "PT1M");
    assert.equal(isoDuration(3_725_000), "PT1H2M5S");
    assert.equal(isoDuration(3_600_000), "PT1H");
    assert.equal(isoDuration(400), null, "rounds to 0 s");
    assert.equal(isoDuration(null), null);
    assert.equal(isoDuration(Number.POSITIVE_INFINITY), null);
    for (const ms of [42_000, 75_000, 3_725_000]) assert.ok(isIsoDuration(isoDuration(ms)), String(ms));
  });
});

describe("productVideosJsonLd", () => {
  test("no videos: no documents", () => {
    assert.deepEqual(productVideosJsonLd({ product: product(), locale: "tr", videoLabel: "Video" }), []);
    assert.deepEqual(productVideosJsonLd({ product: product({ videos: [] }), locale: "tr", videoLabel: "Video" }), []);
  });

  test("one VideoObject with every field Google asks for, about the product node", () => {
    const docs = productVideosJsonLd({ product: product({ videos: [video(7)] }), locale: "tr", videoLabel: "Video", productNodeId: `${pageUrl()}#product` });
    assert.deepEqual(docs, [
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "@id": `${pageUrl()}#video-7`,
        name: "Video: Lavanta Sıvı El Sabunu",
        description: "Lavanta kokulu sıvı el sabunu.",
        thumbnailUrl: [`${ORIGIN}/media/urunler/lavanta/kapak-7-1200.webp`],
        uploadDate: "2026-11-12T08:30:00.000Z",
        contentUrl: `${ORIGIN}/uploads/videos/lavanta-7.mp4`,
        duration: "PT1M15S",
        inLanguage: "tr-TR",
        about: { "@id": `${pageUrl()}#product` },
      },
    ]);
  });

  test("names: the video's own description in the page language, else numbered fallbacks; no about without a product node", () => {
    const p = product({
      videos: [video(7, { alt: { tr: "Lavanta köpüğü yakından", en: "Lavender lather close up" } }), video(8, { durationMs: null }), video(9, { url: "https://cdn.example/v.webm", mime: "video/webm" })],
    });
    const en = productVideosJsonLd({ product: p, locale: "en", videoLabel: "Video" });
    assert.deepEqual(
      en.map((d) => d.name),
      ["Lavender lather close up", "Video 2: Lavender Liquid Hand Soap", "Video 3: Lavender Liquid Hand Soap"],
    );
    assert.equal(en[0].description, "Lavender-scented liquid hand soap.");
    assert.equal("duration" in en[1], false, "unknown length: no duration");
    assert.equal(en[2].contentUrl, "https://cdn.example/v.webm", "absolute URLs pass through");
    assert.ok(en.every((d) => !("about" in d)));
    const ar = productVideosJsonLd({ product: p, locale: "ar", videoLabel: "فيديو" });
    assert.equal(ar[0].name, "فيديو 1: اللافندر — صابون سائل لليدين", "no Turkish description on /ar");
    assert.equal(ar[0].description, "Lavanta kokulu sıvı el sabunu.", "short description falls back like the page");
    assert.equal(ar[0].inLanguage, "ar");
  });

  test("productVideoName is what the sitemap uses too", () => {
    const p = product();
    assert.equal(productVideoName(p, { alt: null }, { index: 0, count: 1 }, "tr", "Video"), "Video: Lavanta Sıvı El Sabunu");
    assert.equal(productVideoName(p, { alt: null }, { index: 1, count: 2 }, "tr", " "), "Video 2: Lavanta Sıvı El Sabunu", "an empty label falls back to Video");
  });

  test("the Product/ProductGroup markup is byte-identical with or without videos (videos never become Product images)", () => {
    const input = { locale: "tr" as const, reviews: null, general, shipping, seo };
    const without = jsonLd(productGroupJsonLd({ ...input, product: product() }));
    const withVideos = jsonLd(productGroupJsonLd({ ...input, product: product({ videos: [video(7), video(8)] }) }));
    assert.equal(withVideos, without);
    assert.doesNotMatch(withVideos, /\.mp4|kapak-7/);
  });
});

describe("SEO audit: VideoObject", () => {
  const good = () => productVideosJsonLd({ product: product({ videos: [video(7)] }), locale: "tr", videoLabel: "Video", productNodeId: `${pageUrl()}#product` })[0];
  const check = (...docs: unknown[]) => checkJsonLd(docs.map((d) => JSON.stringify(d)), ctx());
  const codes = (result: ReturnType<typeof check>) => result.issues.map((i) => `${i.code}: ${i.message}`);

  test("the product page's markup (ProductGroup/Product + VideoObjects) passes without issues", () => {
    const p = product({ videos: [video(7), video(8)] });
    const productDoc = productGroupJsonLd({ product: p, locale: "tr", reviews: null, general, shipping, seo });
    const videos = productVideosJsonLd({ product: p, locale: "tr", videoLabel: "Video", productNodeId: productDoc?.["@id"] ?? null });
    const result = check(productDoc, ...videos);
    assert.deepEqual(codes(result), []);
    assert.ok(result.facts.types.includes("VideoObject"));
    assert.ok(result.facts.images.includes(`${ORIGIN}/media/urunler/lavanta/kapak-7-1200.webp`), "covers are checked as image assets");
    assert.ok(!result.facts.images.some((u) => u.endsWith(".mp4")), "the video file is not fetched as an image");
  });

  test("two distinct videos are not a duplicated type; the same video twice is", () => {
    const a = good();
    const b = { ...good(), "@id": `${pageUrl()}#video-8`, contentUrl: `${ORIGIN}/uploads/videos/other.mp4` };
    assert.deepEqual(codes(check(a, b)), []);
    const dup = codes(check(a, { ...a, "@id": `${pageUrl()}#video-copy` }));
    assert.equal(dup.length, 1);
    assert.match(dup[0], /^jsonld-duplicate-type: page: 2 top-level VideoObject blocks describe the same video/);
    assert.match(codes(check({ "@context": "https://schema.org", "@type": "Product", name: "x" }, { "@context": "https://schema.org", "@type": "Product", name: "y" })).join("\n"), /jsonld-duplicate-type: page: 2 top-level Product blocks/, "other types still count");
  });

  test("required fields: name, thumbnailUrl, uploadDate", () => {
    const doc = good();
    const { name: _n, thumbnailUrl: _t, uploadDate: _u, ...rest } = doc;
    void [_n, _t, _u];
    const issues = codes(check(rest));
    assert.ok(issues.some((i) => /^jsonld-required: .*"name" is missing/.test(i)), issues.join("\n"));
    assert.ok(issues.some((i) => /^jsonld-required: .*"thumbnailUrl" is missing/.test(i)));
    assert.ok(issues.some((i) => /^jsonld-required: .*"uploadDate" is missing/.test(i)));
  });

  test("recommended fields and value formats", () => {
    const doc = good();
    const { description: _d, contentUrl: _c, duration: _du, ...bare } = doc;
    void [_d, _c, _du];
    const missing = codes(check(bare));
    assert.ok(missing.some((i) => /^jsonld-recommended: .*"description"/.test(i)));
    assert.ok(missing.some((i) => /^jsonld-recommended: .*"contentUrl" or "embedUrl"/.test(i)));
    assert.ok(missing.some((i) => /^jsonld-recommended: .*"duration"/.test(i)));
    assert.ok(codes(check({ ...doc, duration: "75 s" })).some((i) => /^jsonld-invalid-value: .*"duration"/.test(i)));
    assert.ok(codes(check({ ...doc, duration: "PT" })).some((i) => /^jsonld-invalid-value: .*"duration"/.test(i)));
    assert.ok(codes(check({ ...doc, uploadDate: "12.11.2026" })).some((i) => /^jsonld-invalid-value: .*"uploadDate"/.test(i)));
    assert.ok(codes(check({ ...doc, uploadDate: "2026-11-12T08:30:00" })).some((i) => /^jsonld-format: .*time zone/.test(i)));
    assert.ok(codes(check({ ...doc, contentUrl: "/uploads/v.mp4" })).some((i) => /^jsonld-invalid-value: .*"contentUrl" must be an absolute URL/.test(i)));
    assert.ok(codes(check({ ...doc, contentUrl: pageUrl() })).some((i) => /^jsonld-invalid-value: .*not the page it is on/.test(i)));
    assert.ok(codes(check({ ...doc, thumbnailUrl: ["/media/k.webp"] })).some((i) => /^jsonld-invalid-value: .*thumbnailUrl\[0\]/.test(i)));
    assert.ok(codes(check({ ...doc, expires: "2026-01-01T00:00:00Z" })).some((i) => /^jsonld-invalid-value: .*"expires" .* in the past/.test(i)));
    assert.deepEqual(codes(check({ ...doc, expires: "2027-01-01T00:00:00Z" })), []);
    assert.ok(codes(check({ ...doc, inLanguage: "en-US" })).some((i) => /^jsonld-mismatch: .*inLanguage/.test(i)));
    assert.deepEqual(codes(check({ ...doc, embedUrl: "https://www.youtube.com/embed/x" })), []);
  });

  test("isIsoDuration", () => {
    for (const ok of ["PT42S", "PT1M33S", "PT1H", "P1DT2H", "PT0.5S", "P2W"]) assert.ok(isIsoDuration(ok), ok);
    for (const bad of ["", "P", "PT", "42", "1:15", "PT1.5M", "T1M"]) assert.ok(!isIsoDuration(bad), bad);
  });
});

describe("video sitemap", () => {
  const sv = (overrides: Partial<SitemapVideo> = {}): SitemapVideo => ({
    title: { tr: "Video: Lavanta & Okyanus <yeni>", en: "Video: Lavender \"new\"" },
    description: { tr: "Köpük 'yakından' & yavaş" },
    thumbnail: "/media/urunler/lavanta/kapak 1.webp",
    content: "/uploads/videos/lavanta-7.mp4",
    durationMs: 75_400,
    publishedAt: "2026-11-12T08:30:00.000Z",
    ...overrides,
  });

  test("sitemapText escapes for XML, drops what XML forbids, collapses spaces and caps the length", () => {
    assert.equal(sitemapText(`A & B <c> "d" 'e'`), "A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;");
    assert.equal(sitemapText("a\u0000b\u0007c\u000bd"), "abcd");
    assert.equal(sitemapText("  çok   boşluk \n satır  "), "çok boşluk satır");
    assert.equal(sitemapText("İİİİİ", 3), "İİİ", "counts characters, not UTF-16 units");
    assert.equal(sitemapText("ab &", 3), "ab", "cut before escaping, no trailing space");
  });

  test("sitemapVideos: per-locale title (Turkish fallback), escaped text and URLs, seconds, publication date", () => {
    assert.deepEqual(sitemapVideos([sv()], "tr"), [
      {
        title: "Video: Lavanta &amp; Okyanus &lt;yeni&gt;",
        thumbnail_loc: `${ORIGIN}/media/urunler/lavanta/kapak%201.webp`,
        description: "Köpük &apos;yakından&apos; &amp; yavaş",
        content_loc: `${ORIGIN}/uploads/videos/lavanta-7.mp4`,
        duration: 75,
        publication_date: "2026-11-12T08:30:00.000Z",
      },
    ]);
    const [en] = sitemapVideos([sv()], "en");
    assert.equal(en.title, "Video: Lavender &quot;new&quot;");
    assert.equal(en.description, "Köpük &apos;yakından&apos; &amp; yavaş", "no English description: the Turkish one");
    const [ar] = sitemapVideos([sv()], "ar");
    assert.equal(ar.title, "Video: Lavanta &amp; Okyanus &lt;yeni&gt;");
  });

  test("a video without title, cover or file is left out; out-of-range durations and bad dates are dropped", () => {
    assert.deepEqual(sitemapVideos([sv({ title: { tr: " " } }), sv({ thumbnail: "" }), sv({ content: "  " })], "tr"), []);
    const [long] = sitemapVideos([sv({ durationMs: 9 * 3600 * 1000, publishedAt: "dün" })], "tr");
    assert.equal("duration" in long, false);
    assert.equal("publication_date" in long, false);
    const [short] = sitemapVideos([sv({ durationMs: 300 })], "tr");
    assert.equal("duration" in short, false, "under one second");
    assert.deepEqual(sitemapVideos(undefined, "tr"), []);
  });

  const data: SitemapData = {
    products: [
      { slug: "lavanta", updatedAt: "2026-11-12T09:00:00.000Z", images: ["/media/urunler/lavanta/a-1200.webp"], videos: [sv()] },
      { slug: "portakal", updatedAt: "2026-11-11T09:00:00.000Z" },
    ],
    categories: [{ slug: "el-sabunu", updatedAt: "2026-11-10T09:00:00.000Z" }],
    pages: [],
    reservedPages: [],
    posts: [],
  };

  test("buildSitemap: only the product entries with videos get them, in each locale's language", () => {
    const entries = buildSitemap(data, ["tr", "en", "ar"]);
    const withVideos = entries.filter((e) => e.videos?.length);
    assert.deepEqual(
      withVideos.map((e) => e.url),
      ["tr", "en", "ar"].map((l) => absoluteUrl(href(l as "tr", "product", { slug: "lavanta" }))),
    );
    assert.deepEqual(
      withVideos.map((e) => e.videos?.[0].title),
      ["Video: Lavanta &amp; Okyanus &lt;yeni&gt;", "Video: Lavender &quot;new&quot;", "Video: Lavanta &amp; Okyanus &lt;yeni&gt;"],
    );
    assert.equal(entries.find((e) => e.url.endsWith("/portakal"))?.videos, undefined);
    // Without videos the entries are what they were (no `videos` key at all).
    const plain = buildSitemap({ ...data, products: data.products.map(({ videos: _v, ...p }) => (void _v, p)) }, ["tr", "en", "ar"]);
    assert.ok(plain.every((e) => !("videos" in e)));
  });

  test("Next's serializer writes it as valid XML that the audit reads without problems", () => {
    const require = createRequire(path.resolve("package.json"));
    const { resolveRouteData } = require("next/dist/build/webpack/loaders/metadata/resolve-route-data.js") as {
      resolveRouteData: (data: MetadataRoute.Sitemap, type: "sitemap") => string;
    };
    const xml = resolveRouteData(buildSitemap(data, ["tr", "en", "ar"]), "sitemap");
    assert.match(xml, /xmlns:video="http:\/\/www\.google\.com\/schemas\/sitemap-video\/1\.1"/);
    assert.match(xml, /<video:title>Video: Lavanta &amp; Okyanus &lt;yeni&gt;<\/video:title>/);
    assert.match(xml, /<video:duration>75<\/video:duration>/);
    const parsed = parseSitemapXml(xml);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(checkSitemap(parsed, ORIGIN, `${ORIGIN}/sitemap.xml`, new Date("2026-11-12T12:00:00Z")), []);
    const lavanta = parsed.urls.find((u) => u.loc === absoluteUrl(href("tr", "product", { slug: "lavanta" })));
    assert.deepEqual(lavanta?.images, [`${ORIGIN}/media/urunler/lavanta/a-1200.webp`], "image entries unchanged");
  });
});
