// Day 5 FEED: src/lib/seo/merchant-feed.ts, the Google Merchant Center feed builder (pure).
// Escaping and well-formed XML, prices, required fields, one item per sellable variant, sample /
// noindex / business-only exclusion, images (largest WebP, never AVIF), campaigns (sale price and Istanbul
// dates), shipping through the money engine, identifiers, categories, and the route path.
//   npx tsx --test tests/unit/day5-feed-merchant.test.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { ProductMediaData, ProductVariantData } from "@/lib/data/catalog";
import type { MediaLike } from "@/lib/media/types";
import { MERCHANT_FEED_PATH } from "@/lib/seo/feed-url";
import {
  buildMerchantFeed,
  collectMerchantFeedItems,
  feedDateTime,
  feedImageUrl,
  feedPlainText,
  feedShippingPrice,
  formatFeedPrice,
  GOOGLE_FEED_NAMESPACE,
  merchantCategoryFor,
  salePriceEffectiveDate,
  truncateText,
  unitPricingMeasure,
  xmlEscape,
  type MerchantFeedCampaign,
  type MerchantFeedData,
  type MerchantFeedProduct,
} from "@/lib/seo/merchant-feed";
import { settingsSchemas } from "@/lib/settings/types";

const ORIGIN = "https://prestij.example";
const AS_OF = Date.parse("2026-11-21T09:00:00.000Z");

// ---------------------------------------------------------------------------------------------------
// Fixtures (shaped like the live catalog)

function media(id: number, base: string, formats: ("avif" | "webp" | "jpeg" | "png")[] = ["avif", "webp"]): MediaLike {
  const variants = [480, 768, 1024].flatMap((width) =>
    formats.map((format) => ({ width, height: Math.round(width * 1.5), format, key: `urunler/test/${base}-${width}.${format === "jpeg" ? "jpg" : format}`, bytes: 1000 })),
  );
  const url = formats.includes("webp") ? `/media/urunler/test/${base}-1024.webp` : `/media/${variants.at(-1)!.key}`;
  return { id, url, width: 1024, height: 1536, alt: null, blurDataUrl: null, dominantColor: null, variants };
}

const pm = (m: MediaLike, variantId: number | null, role: ProductMediaData["role"]): ProductMediaData => ({ media: m, variantId, role });

function variant(id: number, overrides: Partial<ProductVariantData> = {}): ProductVariantData {
  return {
    id,
    sku: `PR-T-${id}`,
    barcode: null,
    price: 14990,
    compareAtPrice: null,
    vatRate: 20,
    stock: 100,
    trackStock: true,
    allowBackorder: false,
    lowStockThreshold: 5,
    volumeMl: 500,
    weightGrams: 750,
    minQuantity: 1,
    maxQuantity: null,
    imageId: null,
    isDefault: false,
    optionValueIds: [],
    ...overrides,
  };
}

const AMBALAJ = {
  id: 1,
  name: { tr: "Ambalaj" },
  display: "buttons" as const,
  values: [
    { id: 1, value: { tr: "Pompalı Şişe 500 ml", en: "Pump Bottle" }, swatchColor: null, swatchMediaId: null },
    { id: 2, value: { tr: "5 L Bidon" }, swatchColor: null, swatchMediaId: null },
    { id: 3, value: { tr: "20 L Bidon" }, swatchColor: null, swatchMediaId: null },
  ],
};

const EL_SABUNU = { id: 1, slug: "el-sabunu", name: { tr: "El Sabunu", en: "Hand Soap" } };
const DUS_JELI = { id: 2, slug: "dus-jeli", name: { tr: "Duş Jeli" } };
const HEDIYE = { id: 3, slug: "hediye-setleri", name: { tr: "Hediye Setleri" } };

function product(overrides: Partial<MerchantFeedProduct> = {}): MerchantFeedProduct {
  return {
    id: 1,
    slug: "lavanta-latte",
    type: "standard",
    name: { tr: "Lavanta Latte", en: "Lavender Latte" },
    subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" },
    shortDescription: { tr: "Lavanta dallarının sakinliği." },
    description: { tr: "<p>Lavanta &amp; fildişi tonları.</p><h2>Ürün özellikleri</h2><ul><li>Sıvı el sabunu</li></ul>" },
    seo: null,
    businessOnly: false,
    categoryId: 1,
    category: EL_SABUNU,
    options: [AMBALAJ],
    variants: [
      variant(11, { sku: "PR-LVL-500", imageId: 107, optionValueIds: [1], isDefault: true }),
      variant(12, { sku: "PR-LVL-5L", barcode: "8685317540009", price: 44990, volumeMl: 5000, weightGrams: 5300, imageId: 108, optionValueIds: [2] }),
      variant(13, { sku: "PR-LVL-20L", barcode: "8685317540086", price: 149990, volumeMl: 20000, weightGrams: 21000, stock: 0, imageId: 111, optionValueIds: [3] }),
    ],
    media: [
      pm(media(107, "lvl-pompali-studyo"), 11, "packshot"),
      pm(media(102, "lvl-pompali-spa"), 11, "lifestyle"),
      pm(media(108, "lvl-5l-studyo"), 12, "packshot"),
      pm(media(111, "lvl-20l-yatay"), 13, "lifestyle"),
      pm(media(113, "lvl-20l-grafik"), 13, "gallery"),
      pm(media(150, "lvl-ortak"), null, "lifestyle"),
    ],
    tiers: [],
    ...overrides,
  };
}

const okyanus = (): MerchantFeedProduct =>
  product({
    id: 4,
    slug: "okyanus",
    name: { tr: "Okyanus" },
    subtitle: { tr: "Duş Jeli" },
    categoryId: 2,
    category: DUS_JELI,
    variants: [variant(41, { sku: "PR-OKY-500", optionValueIds: [1] }), variant(42, { sku: "PR-OKY-5L", price: 44990, volumeMl: 5000, weightGrams: 5300, optionValueIds: [2] })],
    media: [pm(media(142, "oky-studyo"), null, "packshot")],
  });

const bundle = (): MerchantFeedProduct =>
  product({
    id: 5,
    slug: "dort-koku-koleksiyonu",
    type: "bundle",
    name: { tr: "Dört Koku Koleksiyonu" },
    subtitle: { tr: "4 × 5 L Bidon Seti" },
    description: { tr: "<p>Dört koku bir arada.</p>" },
    categoryId: 3,
    category: HEDIYE,
    options: [],
    variants: [variant(51, { sku: "PR-SET-4X5L", price: 159990, volumeMl: 20000, weightGrams: 21200, imageId: 148, isDefault: true })],
    media: [pm(media(148, "koleksiyon-dikey"), 51, "packshot"), pm(media(149, "koleksiyon-yatay"), 51, "hero")],
  });

const sample = (): MerchantFeedProduct =>
  product({ id: 6, slug: "lavanta-numune", type: "sample", seo: { noIndex: true }, variants: [variant(61, { sku: "PR-LAV-NUM", price: 0 })] });

const SHIPPING = { flatFee: 9990, freeThreshold: 150000, heavy: { enabled: true, thresholdGrams: 10000, feePerKg: 1500 }, estimatedDays: { min: 1, max: 3 } };

function data(overrides: Partial<MerchantFeedData> = {}): MerchantFeedData {
  return {
    products: [product(), okyanus(), bundle(), sample()],
    campaigns: { campaigns: [], asOf: AS_OF },
    general: settingsSchemas.general.parse({}),
    seo: settingsSchemas.seo.parse({}),
    shipping: SHIPPING,
    ...overrides,
  };
}

const campaign = (overrides: Partial<MerchantFeedCampaign> = {}): MerchantFeedCampaign => ({
  id: 1,
  percent: 10,
  priority: 0,
  productIds: null,
  categoryIds: null,
  customerGroupIds: null,
  startsAt: null,
  endsAt: null,
  ...overrides,
});

// ---------------------------------------------------------------------------------------------------
// Tiny XML reader for the assertions (our own output, so a strict, small parser is enough)

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Fails unless the document is well-formed: balanced tags, no raw < > or stray & in text. */
function assertWellFormed(xml: string): void {
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n`), "XML declaration first");
  const body = xml.slice(xml.indexOf("?>") + 2);
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<&]*")*)\s*(\/?)>/g;
  const stack: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body))) {
    const text = body.slice(last, m.index);
    assert.ok(!/[<>]/.test(text), `raw angle bracket in text: ${JSON.stringify(text.slice(0, 80))}`);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(text), `unescaped & in text: ${JSON.stringify(text.slice(0, 80))}`);
    last = tag.lastIndex;
    if (m[1]) assert.equal(stack.pop(), m[2], `closing </${m[2]}> matches`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.equal(body.slice(last).trim(), "", "nothing after the root element");
  assert.deepEqual(stack, [], "every element closed");
}

type ParsedItem = Record<string, string[]>;

function parseItems(xml: string): ParsedItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, inner]) => {
    const out: ParsedItem = {};
    const shipping = inner.match(/<g:shipping>([\s\S]*?)<\/g:shipping>/);
    const flat = inner.replace(/<g:shipping>[\s\S]*?<\/g:shipping>/, "");
    for (const [, name, value] of flat.matchAll(/<([\w:]+)>([\s\S]*?)<\/\1>/g)) (out[name] ??= []).push(decode(value));
    if (shipping) for (const [, name, value] of shipping[1].matchAll(/<([\w:]+)>([\s\S]*?)<\/\1>/g)) (out[`g:shipping/${name}`] ??= []).push(decode(value));
    return out;
  });
}

const one = (item: ParsedItem, name: string): string | undefined => {
  const values = item[name];
  assert.ok(!values || values.length === 1, `${name} appears once`);
  return values?.[0];
};
const byId = (items: ParsedItem[], id: string) => {
  const found = items.find((i) => one(i, "g:id") === id);
  assert.ok(found, `item ${id} is in the feed`);
  return found;
};

// ---------------------------------------------------------------------------------------------------

describe("formatting helpers", () => {
  test("prices: integer kuruş → '149.90 TRY'", () => {
    assert.equal(formatFeedPrice(14990), "149.90 TRY");
    assert.equal(formatFeedPrice(100), "1.00 TRY");
    assert.equal(formatFeedPrice(5), "0.05 TRY");
    assert.equal(formatFeedPrice(0), "0.00 TRY");
    assert.equal(formatFeedPrice(123456789), "1234567.89 TRY");
    assert.throws(() => formatFeedPrice(-1), RangeError);
    assert.throws(() => formatFeedPrice(1.5), RangeError);
    assert.throws(() => formatFeedPrice(Number.NaN), RangeError);
  });

  test("xmlEscape: the five specials escaped, characters XML 1.0 forbids dropped, the rest kept", () => {
    assert.equal(xmlEscape(`Lavanta & <Latte> "x" 'y'`), "Lavanta &amp; &lt;Latte&gt; &quot;x&quot; &apos;y&apos;");
    assert.equal(xmlEscape("a\u0000b\u0008c\u000Bd\u000Ce\u001Ff￾g\uD800h"), "abcdefgh");
    assert.equal(xmlEscape("tab\tline\nŞİ ğü صابون 🧼"), "tab\tline\nŞİ ğü صابون 🧼");
    assert.equal(xmlEscape("&amp;"), "&amp;amp;", "existing entities are text too");
  });

  test("feedPlainText: no HTML, block ends as line breaks, list items, link labels without URLs, entities decoded", () => {
    const html =
      `<p>Lavanta &amp; latte&nbsp;kokusu</p><h2>Ürün özellikleri</h2><ul><li>500 ml</li><li><a href="/tr/kategori/el-sabunu">Sıvı el sabunu</a></li></ul>` +
      `<script>alert(1)</script><p>&#350;ık &lt;tasarım&gt;</p>`;
    assert.equal(feedPlainText(html), "Lavanta & latte kokusu\n\nÜrün özellikleri\n\n- 500 ml\n- Sıvı el sabunu\n\nŞık <tasarım>");
    assert.equal(feedPlainText("Satır bir\n\nSatır   iki"), "Satır bir\n\nSatır iki", "plain-text descriptions keep their paragraphs");
    assert.equal(feedPlainText(null), "");
    assert.equal(feedPlainText("<p> </p>"), "");
  });

  test("truncateText: unchanged when short; cut at a word with the ellipsis counted; never splits a surrogate pair", () => {
    assert.equal(truncateText("kısa", 10), "kısa");
    const long = "sıvı el sabunu ".repeat(20).trim();
    const cut = truncateText(long, 50, "…");
    assert.ok(Array.from(cut).length <= 50);
    assert.ok(cut.endsWith("sabunu…") || cut.endsWith("el…") || cut.endsWith("sıvı…"), cut);
    const emoji = truncateText("🧼".repeat(10), 5);
    assert.equal(emoji, "🧼".repeat(5));
    assert.equal(truncateText("abcdefghij", 5), "abcde", "no space: hard cut");
  });

  test("feedDateTime: Istanbul wall clock with +0300 (no DST), seconds dropped", () => {
    assert.equal(feedDateTime(new Date("2026-11-20T21:30:45Z")), "2026-11-21T00:30+0300");
    assert.equal(feedDateTime(new Date("2026-03-29T00:00:00Z")), "2026-03-29T03:00+0300");
    assert.equal(feedDateTime(new Date("2026-07-01T12:00:59.999Z")), "2026-07-01T15:00+0300");
  });

  test("salePriceEffectiveDate: start rounded up, end down; read time when there is no start; null without an end", () => {
    const window = salePriceEffectiveDate({ startsAt: new Date("2026-11-20T07:00:30Z"), endsAt: new Date("2026-11-27T20:59:59Z") }, AS_OF);
    assert.equal(window, "2026-11-20T10:01+0300/2026-11-27T23:59+0300");
    assert.ok(window!.length <= 51, "Google's 51-character limit");
    assert.equal(salePriceEffectiveDate({ startsAt: null, endsAt: new Date("2026-11-30T21:00:00Z") }, AS_OF), "2026-11-21T12:00+0300/2026-12-01T00:00+0300");
    assert.equal(salePriceEffectiveDate({ startsAt: new Date("2026-11-20T07:00:00Z"), endsAt: null }, AS_OF), null);
    assert.equal(salePriceEffectiveDate({ startsAt: new Date("2026-11-20T07:00:10Z"), endsAt: new Date("2026-11-20T07:00:50Z") }, AS_OF), null, "under a minute");
  });

  test("unitPricingMeasure: ml below a litre or when not a clean litre value, else litres", () => {
    assert.equal(unitPricingMeasure(500), "500 ml");
    assert.equal(unitPricingMeasure(5000), "5 l");
    assert.equal(unitPricingMeasure(20000), "20 l");
    assert.equal(unitPricingMeasure(1500), "1.5 l");
    assert.equal(unitPricingMeasure(1250), "1.25 l");
    assert.equal(unitPricingMeasure(1255), "1255 ml");
    for (const none of [null, undefined, 0, -5, 2.5]) assert.equal(unitPricingMeasure(none), null);
  });
});

describe("images", () => {
  test("the largest WebP rendition, never AVIF; absolute URLs; trailing slash on the origin ignored", () => {
    const m = media(1, "foto");
    assert.equal(feedImageUrl(m, ORIGIN), `${ORIGIN}/media/urunler/test/foto-1024.webp`);
    assert.equal(feedImageUrl(m, `${ORIGIN}/`), `${ORIGIN}/media/urunler/test/foto-1024.webp`);
  });

  test("JPEG/PNG renditions qualify; a WebP wins a tie; AVIF-only media gives nothing", () => {
    assert.equal(feedImageUrl(media(1, "j", ["avif", "jpeg"]), ORIGIN), `${ORIGIN}/media/urunler/test/j-1024.jpg`);
    assert.equal(feedImageUrl(media(1, "w", ["png", "webp"]), ORIGIN), `${ORIGIN}/media/urunler/test/w-1024.webp`);
    const avifOnly = { ...media(1, "a", ["avif"]), url: "/media/urunler/test/a-1024.avif" };
    assert.equal(feedImageUrl(avifOnly, ORIGIN), null);
  });

  test("media without variants: its own URL when it is a JPEG/PNG/WebP/GIF file; remote storage URLs stay as they are", () => {
    assert.equal(feedImageUrl({ url: "/uploads/x/logo.png", variants: null }, ORIGIN), `${ORIGIN}/uploads/x/logo.png`);
    assert.equal(feedImageUrl({ url: "/uploads/x/vector.svg", variants: null }, ORIGIN), null);
    assert.equal(feedImageUrl({ url: "/uploads/x/photo.JPG?v=2", variants: [] }, ORIGIN), `${ORIGIN}/uploads/x/photo.JPG?v=2`);
    const remote = { url: "https://cdn.example/storage/v1/object/public/media/urunler/a-1024.webp", variants: [{ width: 1024, height: 1536, format: "webp" as const, key: "urunler/a-1024.webp", bytes: 1 }] };
    assert.equal(feedImageUrl(remote, ORIGIN), "https://cdn.example/storage/v1/object/public/media/urunler/a-1024.webp");
  });
});

describe("items", () => {
  const xml = buildMerchantFeed(data(), ORIGIN);
  const items = parseItems(xml);

  test("the document is well-formed RSS 2.0 with the g: namespace and a Turkish channel", () => {
    assertWellFormed(xml);
    assert.match(xml, new RegExp(`<rss version="2\\.0" xmlns:g="${GOOGLE_FEED_NAMESPACE.replace(/[.]/g, "\\.")}">`));
    assert.match(xml, /<channel>\n {4}<title>PRESTİJ<\/title>\n {4}<link>https:\/\/prestij\.example\/tr<\/link>\n {4}<description>[^<]+<\/description>\n {4}<language>tr<\/language>/);
    assert.equal(buildMerchantFeed(data(), ORIGIN), xml, "deterministic");
  });

  test("one item per sellable variant; samples are never listed", () => {
    assert.deepEqual(
      items.map((i) => one(i, "g:id")),
      ["PR-LVL-500", "PR-LVL-5L", "PR-LVL-20L", "PR-OKY-500", "PR-OKY-5L", "PR-SET-4X5L"],
    );
    assert.ok(!xml.includes("PR-LAV-NUM") && !xml.includes("numune"));
    const { skipped } = collectMerchantFeedItems(data(), ORIGIN);
    assert.deepEqual(skipped, [{ productId: 6, slug: "lavanta-numune", variantId: null, sku: null, reason: "not_listable" }]);
  });

  test("every item has Google's required fields (and the ones free listings need)", () => {
    for (const item of items) {
      for (const field of ["g:id", "title", "description", "link", "g:image_link", "g:availability", "g:price", "g:brand", "g:condition", "g:mpn", "g:shipping/g:country", "g:shipping/g:price"]) {
        assert.ok(one(item, field), `${one(item, "g:id")} has ${field}`);
      }
      assert.ok(Array.from(one(item, "title")!).length <= 150);
      assert.ok(Array.from(one(item, "description")!).length <= 5000);
      assert.ok(one(item, "g:id")!.length <= 50);
      assert.equal(one(item, "g:condition"), "new");
      assert.equal(one(item, "g:brand"), "PRESTİJ");
      assert.equal(one(item, "g:shipping/g:country"), "TR");
      assert.match(one(item, "g:price")!, /^\d+\.\d{2} TRY$/);
      assert.match(one(item, "link")!, /^https:\/\/prestij\.example\/tr\/urunler\//);
      assert.ok(!/<|&lt;/.test(one(item, "description")!), "plain-text description");
      assert.equal(item["g:identifier_exists"], undefined, "brand + MPN are identifiers: no identifier_exists");
      assert.equal(item["g:is_bundle"], undefined, "no is_bundle for manufacturer-defined sets");
      assert.ok((item["g:additional_image_link"] ?? []).length <= 10);
    }
  });

  test("a pump bottle: title, link to its variant, images of that variant, price, shipping, unit price", () => {
    const item = byId(items, "PR-LVL-500");
    assert.equal(one(item, "g:item_group_id"), "PRD-1", "the page's ProductGroup productGroupID");
    assert.equal(one(item, "title"), "PRESTİJ Lavanta Latte Sıvı El Sabunu Pompalı Şişe 500 ml");
    assert.equal(one(item, "description"), "Lavanta & fildişi tonları.\n\nÜrün özellikleri\n\n- Sıvı el sabunu");
    assert.equal(one(item, "link"), `${ORIGIN}/tr/urunler/lavanta-latte?varyant=11`);
    assert.equal(one(item, "g:image_link"), `${ORIGIN}/media/urunler/test/lvl-pompali-studyo-1024.webp`);
    assert.deepEqual(item["g:additional_image_link"], [`${ORIGIN}/media/urunler/test/lvl-pompali-spa-1024.webp`, `${ORIGIN}/media/urunler/test/lvl-ortak-1024.webp`]);
    assert.equal(one(item, "g:availability"), "in_stock");
    assert.equal(one(item, "g:price"), "149.90 TRY");
    assert.equal(item["g:sale_price"], undefined);
    assert.equal(item["g:gtin"], undefined, "no barcode, no GTIN");
    assert.equal(one(item, "g:mpn"), "PR-LVL-500");
    assert.equal(one(item, "g:google_product_category"), "3208");
    assert.equal(one(item, "g:product_type"), "El Sabunu > Lavanta Latte");
    assert.equal(one(item, "g:size"), "Pompalı Şişe 500 ml");
    assert.equal(one(item, "g:shipping/g:price"), "99.90 TRY");
    assert.equal(one(item, "g:shipping_weight"), "750 g");
    assert.equal(one(item, "g:min_handling_time"), "1");
    assert.equal(one(item, "g:max_handling_time"), "3");
    assert.equal(one(item, "g:unit_pricing_measure"), "500 ml");
    assert.equal(one(item, "g:unit_pricing_base_measure"), "1 l");
  });

  test("GTIN only for a valid EAN-13; out-of-stock variants are listed as out_of_stock; heavy-parcel surcharge in shipping", () => {
    const fiveL = byId(items, "PR-LVL-5L");
    assert.equal(one(fiveL, "g:gtin"), "8685317540009");
    assert.equal(one(fiveL, "g:shipping/g:price"), "99.90 TRY", "5.3 kg: flat fee only");
    assert.equal(one(fiveL, "g:unit_pricing_measure"), "5 l");
    const twentyL = byId(items, "PR-LVL-20L");
    assert.equal(twentyL["g:gtin"], undefined, "8685317540086 has a wrong check digit");
    assert.equal(one(twentyL, "g:mpn"), "PR-LVL-20L");
    assert.equal(one(twentyL, "g:availability"), "out_of_stock");
    assert.equal(one(twentyL, "g:shipping/g:price"), "264.90 TRY", "flat 99.90 + 11 started kg × 15.00");
    assert.equal(one(twentyL, "g:image_link"), `${ORIGIN}/media/urunler/test/lvl-20l-yatay-1024.webp`, "the variant's own image first");
    assert.deepEqual(twentyL["g:additional_image_link"], [`${ORIGIN}/media/urunler/test/lvl-20l-grafik-1024.webp`, `${ORIGIN}/media/urunler/test/lvl-ortak-1024.webp`]);
  });

  test("categories: shower gel → Body Wash (2747), the set → Bath & Body Gift Sets (475)", () => {
    assert.equal(one(byId(items, "PR-OKY-500"), "g:google_product_category"), "2747");
    assert.equal(one(byId(items, "PR-OKY-500"), "g:product_type"), "Duş Jeli > Okyanus");
    assert.equal(one(byId(items, "PR-SET-4X5L"), "g:google_product_category"), "475");
  });

  test("a single-variant product (the set): no item group, the clean product URL, free flat fee above the threshold but the heavy surcharge stays", () => {
    const set = byId(items, "PR-SET-4X5L");
    assert.equal(set["g:item_group_id"], undefined);
    assert.equal(one(set, "link"), `${ORIGIN}/tr/urunler/dort-koku-koleksiyonu`);
    assert.equal(one(set, "title"), "PRESTİJ Dört Koku Koleksiyonu 4 × 5 L Bidon Seti");
    assert.equal(set["g:size"], undefined);
    assert.equal(one(set, "g:price"), "1599.90 TRY");
    assert.equal(one(set, "g:shipping/g:price"), "180.00 TRY", "1,599.90 ≥ 1,500.00: no flat fee; 21.2 kg → 12 started kg × 15.00");
    assert.equal(one(set, "g:image_link"), `${ORIGIN}/media/urunler/test/koleksiyon-dikey-1024.webp`);
  });
});

describe("exclusions and edge cases", () => {
  test("noindex and business-only products are left out with their reason", () => {
    const { items, skipped } = collectMerchantFeedItems(
      data({ products: [product({ seo: { noIndex: true } }), product({ id: 2, slug: "kurumsal-ozel", businessOnly: true }), product({ id: 3, slug: "bos", variants: [] })] }),
      ORIGIN,
    );
    assert.deepEqual(items, []);
    assert.deepEqual(
      skipped.map((s) => [s.slug, s.reason]),
      [
        ["lavanta-latte", "noindex"],
        ["kurumsal-ozel", "business_only"],
        ["bos", "no_variants"],
      ],
    );
  });

  test("a 0 price, a minimum quantity above one and a variant without a usable image are skipped; one item left means no group", () => {
    const p = product({
      variants: [
        variant(11, { sku: "A", price: 0, optionValueIds: [1] }),
        variant(12, { sku: "B", minQuantity: 2, optionValueIds: [2] }),
        variant(13, { sku: "C", imageId: 111, optionValueIds: [3] }),
        variant(14, { sku: "D", optionValueIds: [] }),
      ],
      media: [pm({ ...media(111, "only-avif", ["avif"]), url: "/media/x.avif" }, 14, "packshot"), pm(media(112, "c"), 13, "packshot")],
    });
    const { items, skipped } = collectMerchantFeedItems(data({ products: [p] }), ORIGIN);
    assert.deepEqual(
      skipped.map((s) => [s.sku, s.reason]),
      [
        ["A", "invalid_price"],
        ["B", "min_quantity"],
        ["D", "no_image"],
      ],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "C");
    assert.equal(items[0].itemGroupId, null);
    assert.equal(items[0].link, `${ORIGIN}/tr/urunler/lavanta-latte`);
    assert.equal(items[0].imageLink, `${ORIGIN}/media/urunler/test/c-1024.webp`, "its imageId points at another variant's image, so its own packshot leads");
  });

  test("escaping: names with & < > quotes stay well-formed and read back unchanged", () => {
    const p = product({ name: { tr: `Lav & <Latte> "Özel"` }, description: { tr: "Fiyat < değer & kalite > her şey" }, category: { ...EL_SABUNU, name: { tr: "Sabun & Jel" } } });
    const xml = buildMerchantFeed(data({ products: [p] }), ORIGIN);
    assertWellFormed(xml);
    const [item] = parseItems(xml);
    assert.equal(one(item, "title"), `PRESTİJ Lav & <Latte> "Özel" Sıvı El Sabunu Pompalı Şişe 500 ml`);
    assert.equal(one(item, "description"), "Fiyat < değer & kalite > her şey");
    assert.equal(one(item, "g:product_type"), `Sabun & Jel > Lav & <Latte> "Özel"`);
  });

  test("description falls back to the short description, then the title; long text is cut to 5000 with an ellipsis", () => {
    const short = collectMerchantFeedItems(data({ products: [product({ description: null })] }), ORIGIN).items[0];
    assert.equal(short.description, "Lavanta dallarının sakinliği.");
    const none = collectMerchantFeedItems(data({ products: [product({ description: { tr: "<p></p>" }, shortDescription: null })] }), ORIGIN).items[0];
    assert.equal(none.description, none.title);
    const long = collectMerchantFeedItems(data({ products: [product({ description: { tr: `<p>${"köpük ".repeat(1200)}</p>` } })] }), ORIGIN).items[0];
    assert.ok(Array.from(long.description).length <= 5000);
    assert.ok(long.description.endsWith("…"));
  });

  test("title: ≤ 150 characters, the brand is not repeated when the name already carries it", () => {
    const branded = collectMerchantFeedItems(data({ products: [product({ name: { tr: "Prestij Lavanta" } })] }), ORIGIN).items[0];
    assert.equal(branded.title, "Prestij Lavanta Sıvı El Sabunu Pompalı Şişe 500 ml");
    const long = collectMerchantFeedItems(data({ products: [product({ name: { tr: "Lavanta ".repeat(30) } })] }), ORIGIN).items[0];
    assert.ok(Array.from(long.title).length <= 150);
  });

  test("a SKU longer than Google's id limit falls back to a stable variant id", () => {
    const sku = "X".repeat(51);
    const item = collectMerchantFeedItems(data({ products: [product({ variants: [variant(11, { sku, imageId: 107 })] })] }), ORIGIN).items[0];
    assert.equal(item.id, "V11");
    assert.equal(item.mpn, sku);
  });

  test("handling time is left out when the setting is inconsistent", () => {
    const item = collectMerchantFeedItems(data({ shipping: { ...SHIPPING, estimatedDays: { min: 4, max: 2 } } }), ORIGIN).items[0];
    assert.equal(item.minHandlingTime, null);
    assert.equal(item.maxHandlingTime, null);
    const xml = buildMerchantFeed(data({ shipping: { ...SHIPPING, estimatedDays: { min: 0, max: 2 } } }), ORIGIN);
    assert.match(xml, /<g:min_handling_time>0<\/g:min_handling_time>/, "0 = ships the same day");
  });

  test("merchant category: an empty setting leaves it out everywhere; a custom path is escaped", () => {
    assert.equal(merchantCategoryFor({ type: "standard", category: EL_SABUNU }, ""), null);
    assert.equal(merchantCategoryFor({ type: "bundle", category: null }, "   "), null);
    assert.equal(merchantCategoryFor({ type: "standard", category: null }, "474"), "474");
    const empty = buildMerchantFeed(data({ seo: { ...settingsSchemas.seo.parse({}), merchantCategory: "" } }), ORIGIN);
    assert.ok(!empty.includes("g:google_product_category"));
    const custom = buildMerchantFeed(data({ products: [product()], seo: { ...settingsSchemas.seo.parse({}), merchantCategory: "Sağlık & Güzellik > Kişisel Bakım" } }), ORIGIN);
    assert.match(custom, /<g:google_product_category>Sağlık &amp; Güzellik &gt; Kişisel Bakım<\/g:google_product_category>/);
  });
});

describe("campaigns", () => {
  const live = campaign({ id: 7, percent: 10, productIds: [5], startsAt: new Date("2026-11-20T07:00:30Z"), endsAt: new Date("2026-11-27T20:59:59Z") });

  test("a live campaign: regular price + sale price (cart rounding) + the Istanbul date window; shipping follows the sale price", () => {
    const items = parseItems(buildMerchantFeed(data({ campaigns: { campaigns: [live], asOf: AS_OF } }), ORIGIN));
    const set = byId(items, "PR-SET-4X5L");
    assert.equal(one(set, "g:price"), "1599.90 TRY");
    assert.equal(one(set, "g:sale_price"), "1439.91 TRY");
    assert.equal(one(set, "g:sale_price_effective_date"), "2026-11-20T10:01+0300/2026-11-27T23:59+0300");
    assert.equal(one(set, "g:shipping/g:price"), "279.90 TRY", "1,439.91 < 1,500.00: the flat fee is back on top of the 180.00 surcharge");
    assert.equal(byId(items, "PR-LVL-500")["g:sale_price"], undefined, "other products are not in the campaign");
  });

  test("a category campaign without an end: sale price without a date window", () => {
    const items = parseItems(buildMerchantFeed(data({ campaigns: { campaigns: [campaign({ percent: 15, categoryIds: [1] })], asOf: AS_OF } }), ORIGIN));
    const pump = byId(items, "PR-LVL-500");
    assert.equal(one(pump, "g:sale_price"), "127.42 TRY");
    assert.equal(pump["g:sale_price_effective_date"], undefined);
    assert.equal(byId(items, "PR-OKY-500")["g:sale_price"], undefined, "shower gel is in another category");
  });

  test("customer-group campaigns, campaigns outside their window and lower priorities never show", () => {
    const groupOnly = campaign({ id: 2, percent: 30, customerGroupIds: [4] });
    const future = campaign({ id: 3, percent: 40, startsAt: new Date(AS_OF + 3_600_000) });
    const low = campaign({ id: 4, percent: 50, priority: 0 });
    const high = campaign({ id: 5, percent: 5, priority: 9 });
    const items = parseItems(buildMerchantFeed(data({ campaigns: { campaigns: [groupOnly, future, low, high], asOf: AS_OF } }), ORIGIN));
    assert.equal(one(byId(items, "PR-LVL-500"), "g:sale_price"), "142.41 TRY", "the priority-9 campaign wins (5 %), as on the product page and in the cart");
  });
});

describe("shipping through the money engine", () => {
  const base = bundle();
  const set = base.variants[0];
  const engineShipping = { flatFee: SHIPPING.flatFee, freeThreshold: SHIPPING.freeThreshold, heavy: SHIPPING.heavy };

  test("retail tiers count like in the cart: a product-wide tier for one unit drops the set below the free threshold", () => {
    assert.equal(feedShippingPrice(base, set, { shipping: engineShipping, campaigns: [], asOf: AS_OF }), 18000);
    const tiered = { ...base, tiers: [{ variantId: null, minQuantity: 1, discountPercent: 10 }] };
    assert.equal(feedShippingPrice(tiered, set, { shipping: engineShipping, campaigns: [], asOf: AS_OF }), 27990);
    const otherVariant = { ...base, tiers: [{ variantId: 999, minQuantity: 1, discountPercent: 10 }] };
    assert.equal(feedShippingPrice(otherVariant, set, { shipping: engineShipping, campaigns: [], asOf: AS_OF }), 18000, "another variant's tier does not apply");
  });

  test("settings: heavy surcharge off, never free (threshold 0), out of stock still quoted", () => {
    const twentyL = product().variants[2];
    assert.equal(feedShippingPrice(product(), twentyL, { shipping: { ...engineShipping, heavy: { ...SHIPPING.heavy, enabled: false } }, campaigns: [], asOf: AS_OF }), 9990);
    assert.equal(feedShippingPrice(base, set, { shipping: { ...engineShipping, freeThreshold: 0 }, campaigns: [], asOf: AS_OF }), 27990);
    assert.equal(twentyL.stock, 0);
    assert.equal(feedShippingPrice(product(), twentyL, { shipping: engineShipping, campaigns: [], asOf: AS_OF }), 26490);
  });
});

describe("route", () => {
  test("the route file lives at MERCHANT_FEED_PATH", () => {
    assert.equal(MERCHANT_FEED_PATH, "/feeds/google-merchant.xml");
    assert.ok(existsSync(path.resolve("src/app", `.${MERCHANT_FEED_PATH}`, "route.ts")));
  });
});
