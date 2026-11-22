// Day 5 SEO-AUDIT: merchant feed rules (src/lib/seo/audit/feed.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkFeed, effectivePrice, parseEffectiveDate, parseMerchantFeed, sameAvailability, type FeedItemFacts } from "@/lib/seo/audit/feed";
import type { Issue } from "@/lib/seo/audit/types";
import { feedItem, feedXml, NOW, ORIGIN, PATHS, url } from "./day5-seo-audit-fixtures";

const FEED_URL = `${ORIGIN}/feeds/google-merchant.xml`;
const run = (xml: string) => checkFeed(parseMerchantFeed(xml), { origin: ORIGIN, feedUrl: FEED_URL, now: NOW });
const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();
function only(items: string[], code: string, fragment?: RegExp) {
  const { issues } = run(feedXml(items));
  assert.deepEqual(codes(issues), [code], JSON.stringify(issues, null, 1));
  if (fragment) assert.match(issues[0].message, fragment);
}
const fiveLitre = { "g:id": "PR-LAV-5L", title: "PRESTİJ Lavanta Sıvı El Sabunu 5 L Bidon", link: `${url(PATHS.product.tr)}?varyant=12`, "g:price": "449.90 TRY", "g:mpn": "PR-LAV-5L" };

describe("a correct feed", () => {
  test("two variants of one product: no issue; facts per item", () => {
    const { issues, items } = run(feedXml([feedItem(), feedItem({ ...fiveLitre, "g:gtin": "8685317540009", "g:identifier_exists": null, "g:mpn": null })]));
    assert.deepEqual(issues, []);
    assert.deepEqual(
      items.map((i) => [i.id, i.productUrl, i.itemGroupId, i.price, i.availability]),
      [
        ["PR-LAV-500", url(PATHS.product.tr), "lavanta", { value: 149.9, currency: "TRY" }, "in_stock"],
        ["PR-LAV-5L", url(PATHS.product.tr), "lavanta", { value: 449.9, currency: "TRY" }, "in_stock"],
      ],
    );
  });

  test("CDATA and entities are read; descriptions keep their line breaks", () => {
    const xml = feedXml([feedItem({ description: null }).replace("</item>", "<description><![CDATA[Satır 1\n\nSatır 2 & devamı]]></description></item>")]);
    const parsed = parseMerchantFeed(xml);
    assert.equal(parsed.items[0].fields.description[0], "Satır 1\n\nSatır 2 & devamı");
    assert.deepEqual(run(xml).issues, []);
  });
});

describe("structure", () => {
  test("RSS 2.0, the g: namespace, a channel, at least one item", () => {
    assert.deepEqual(codes(run(feedXml([feedItem()], { namespace: false })).issues), ["feed-invalid"]);
    assert.deepEqual(codes(run(feedXml([feedItem()]).replace('version="2.0"', 'version="0.91"')).issues), ["feed-invalid"]);
    assert.deepEqual(codes(run(feedXml([])).issues), ["feed-empty"]);
    assert.deepEqual(codes(run(feedXml([feedItem()], { channel: false })).issues), ["feed-item-recommended"]);
  });
});

describe("item fields", () => {
  test("required: id, title, description, link, image_link, availability, price, brand", () => {
    for (const field of ["g:id", "title", "description", "link", "g:image_link", "g:availability", "g:price", "g:brand"]) {
      only([feedItem({ [field]: null })], "feed-item-required");
    }
  });

  test("identifiers: a valid GTIN, or identifier_exists no, or an MPN", () => {
    only([feedItem({ "g:gtin": "8685317540008", "g:identifier_exists": null })], "feed-item-invalid", /not a valid GTIN/);
    only([feedItem({ "g:gtin": "8685317540009" })], "feed-item-invalid", /identifier_exists no/);
    only([feedItem({ "g:identifier_exists": null, "g:mpn": null })], "feed-item-required", /gtin/);
    assert.deepEqual(run(feedXml([feedItem({ "g:identifier_exists": null })])).issues, [], "brand + mpn is enough");
    only([feedItem({ "g:identifier_exists": "hayır" })], "feed-item-invalid", /yes or no/);
  });

  test("formats: price, availability, condition, title/description limits, plain-text description", () => {
    only([feedItem({ "g:price": "149,90 TL" })], "feed-item-invalid", /149\.90 TRY/);
    only([feedItem({ "g:price": "0.00 TRY" })], "feed-item-invalid", /greater than zero/);
    only([feedItem({ "g:availability": "available" })], "feed-item-invalid", /in_stock/);
    only([feedItem({ "g:condition": "yeni" })], "feed-item-invalid", /condition/);
    only([feedItem({ "g:condition": null })], "feed-item-recommended", /condition/);
    only([feedItem({ title: "x".repeat(151) })], "feed-item-invalid", /151 characters/);
    only([feedItem({ description: "<p>HTML</p>" })], "feed-item-invalid", /HTML/);
    only([feedItem({ description: "y".repeat(5001) })], "feed-item-invalid", /5001/);
    only([feedItem({ "g:id": "x".repeat(51) })], "feed-item-invalid", /50 characters/);
  });

  test("links and images: absolute, on this origin, never AVIF, at most 10 additional images", () => {
    only([feedItem({ link: "/tr/urunler/lavanta" })], "feed-item-invalid", /absolute URL/);
    const foreign = run(feedXml([feedItem({ link: "http://localhost:3000/tr/urunler/lavanta" })])).issues;
    assert.deepEqual(codes(foreign), ["feed-item-invalid", "foreign-origin-url"]);
    only([feedItem({ "g:image_link": url("/media/a-1024.avif") })], "feed-item-invalid", /AVIF/);
    only([feedItem({ "g:additional_image_link": Array.from({ length: 11 }, (_, i) => url(`/media/${i}.webp`)) })], "feed-item-invalid", /11 g:additional_image_link/);
    assert.deepEqual(run(feedXml([feedItem({ "g:image_link": "https://cdn.example/a.jpg" })])).issues, [], "a CDN image on another origin is allowed (not fetched)");
  });

  test("sale price below the price with an ISO 8601 window", () => {
    const window = "2026-11-01T00:00+03:00/2026-11-30T23:59+03:00";
    assert.deepEqual(run(feedXml([feedItem({ "g:sale_price": "129.90 TRY", "g:sale_price_effective_date": window })])).issues, []);
    only([feedItem({ "g:sale_price": "159.90 TRY" })], "feed-item-invalid", /lower than/);
    only([feedItem({ "g:sale_price": "129.90 TRY", "g:sale_price_effective_date": "2026-11-01/2026-11-30" })], "feed-item-invalid", /ISO 8601/);
    only([feedItem({ "g:sale_price": "129.90 TRY", "g:sale_price_effective_date": "2026-10-01T00:00+03:00/2026-10-31T23:59+03:00" })], "feed-item-recommended", /ended/);
    only([feedItem({ "g:sale_price_effective_date": window })], "feed-item-invalid", /without g:sale_price/);
  });

  test("shipping, weight, category, product type, bundle and unit pricing", () => {
    only([feedItem({}, "<g:shipping><g:country>Türkiye</g:country><g:price>99.90 TRY</g:price></g:shipping>")], "feed-item-invalid", /g:country/);
    only([feedItem({}, "<g:shipping><g:country>TR</g:country><g:price>ücretsiz</g:price></g:shipping>")], "feed-item-invalid", /g:price/);
    only([feedItem({}, null)], "feed-item-recommended", /g:shipping/);
    only([feedItem({ "g:shipping_weight": "5,2 kilo" })], "feed-item-invalid", /shipping_weight/);
    assert.deepEqual(run(feedXml([feedItem({ "g:shipping_weight": "5.2 kg", "g:is_bundle": "yes", "g:unit_pricing_measure": "5000 ml", "g:size": "5 L" })])).issues, []);
    only([feedItem({ "g:google_product_category": null })], "feed-item-recommended", /google_product_category/);
    assert.deepEqual(run(feedXml([feedItem({ "g:google_product_category": "Health & Beauty > Personal Care > Cosmetics > Bath & Body > Liquid Hand Soap" })])).issues, []);
    only([feedItem({ "g:google_product_category": "3208x" })], "feed-item-invalid", /taxonomy id/);
    only([feedItem({ "g:google_product_category": "Health & Beauty >> Soap" })], "feed-item-invalid", /taxonomy id/);
    only([feedItem({ "g:product_type": null })], "feed-item-recommended", /product_type/);
    only([feedItem({ "g:is_bundle": "evet" })], "feed-item-invalid", /is_bundle/);
    only([feedItem({ "g:unit_pricing_measure": "5 litre" })], "feed-item-invalid", /unit_pricing_measure/);
  });
});

describe("across items", () => {
  test("ids are unique", () => {
    only([feedItem(), feedItem({ link: `${url(PATHS.product.tr)}?varyant=12` })], "feed-duplicate-id", /PR-LAV-500/);
  });

  test("variants of one product share one item_group_id; one group never spans two products", () => {
    only([feedItem(), feedItem({ ...fiveLitre, "g:item_group_id": null })], "feed-item-group", /\(missing\)/);
    only([feedItem(), feedItem({ ...fiveLitre, "g:item_group_id": "other" })], "feed-item-group");
    only([feedItem(), feedItem({ ...fiveLitre, link: url("/tr/urunler/portakal?varyant=7") })], "feed-item-group", /spans 2 product pages/);
  });
});

describe("helpers", () => {
  test("parseEffectiveDate", () => {
    assert.deepEqual(parseEffectiveDate("2026-11-01T00:00+03:00/2026-11-30T23:59+03:00"), { start: Date.parse("2026-11-01T00:00+03:00"), end: Date.parse("2026-11-30T23:59+03:00") });
    assert.equal(parseEffectiveDate("2026-11-30T23:59+03:00/2026-11-01T00:00+03:00"), null, "start after end");
    assert.equal(parseEffectiveDate("2026-11-01T00:00/2026-11-30T23:59"), null, "a zone is required");
    assert.notEqual(parseEffectiveDate("2016-02-24T11:07:31+0100/2016-02-29T23:07:31+0100"), null, "Google's own example (colon-less offset)");
    assert.notEqual(parseEffectiveDate("2026-11-01T00:00:00.000+03:00/2026-11-30T23:59:59.999+03:00"), null, "fractions of a second");
    assert.equal(parseEffectiveDate("2026-11-01/2026-11-30"), null, "dates without a time are not a window");
  });

  test("effectivePrice uses the sale price only inside its window", () => {
    const base: FeedItemFacts = { position: 1, id: "x", link: null, productUrl: null, itemGroupId: null, price: { value: 149.9, currency: "TRY" }, salePrice: { value: 129.9, currency: "TRY" }, saleWindow: null, availability: "in_stock", images: [] };
    assert.equal(effectivePrice(base, NOW)?.value, 129.9);
    assert.equal(effectivePrice({ ...base, saleWindow: { start: Date.parse("2026-12-01T00:00Z"), end: Date.parse("2026-12-31T00:00Z") } }, NOW)?.value, 149.9);
  });

  test("sameAvailability maps Merchant Center values to schema.org", () => {
    assert.equal(sameAvailability("in_stock", "InStock"), true);
    assert.equal(sameAvailability("out_of_stock", "OutOfStock"), true);
    assert.equal(sameAvailability("in_stock", "OutOfStock"), false);
    assert.equal(sameAvailability("backorder", "BackOrder"), true);
  });
});
