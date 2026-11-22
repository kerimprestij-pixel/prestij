// Day 5 SEO-AUDIT: JSON-LD rules (src/lib/seo/audit/jsonld.ts) against Google's required/recommended fields.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkJsonLd, type JsonLdContext } from "@/lib/seo/audit/jsonld";
import type { Issue } from "@/lib/seo/audit/types";
import { isValidGtin } from "@/lib/seo/audit/values";
import { breadcrumbLd, NOW, ORIGIN, PATHS, productGroupLd, productLd, RETURN_POLICY, SHIPPING, url, variant } from "./day5-seo-audit-fixtures";

const CTX: JsonLdContext = { pageUrl: url(PATHS.product.tr), canonical: url(PATHS.product.tr), origin: ORIGIN, pageLang: "tr", now: NOW };

function check(docs: unknown[], ctx: Partial<JsonLdContext> = {}) {
  return checkJsonLd(
    docs.map((d) => (typeof d === "string" ? d : JSON.stringify(d).split("<").join("\\u003c"))),
    { ...CTX, ...ctx },
  );
}
const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error");
/** The single issue's code and a fragment of its message. */
function only(docs: unknown[], code: string, fragment?: RegExp, ctx: Partial<JsonLdContext> = {}) {
  const { issues } = check(docs, ctx);
  assert.deepEqual(codes(issues), [code], JSON.stringify(issues, null, 1));
  if (fragment) assert.match(issues[0].message, fragment);
}

describe("parsing", () => {
  test("broken JSON, a foreign @context, a node without @type", () => {
    only(["{not json"], "jsonld-parse");
    only([{ "@context": "https://example.org", "@type": "Thing" }], "jsonld-context");
    only([{ "@context": "https://schema.org", name: "x" }], "jsonld-no-type");
    assert.deepEqual(check([{ "@context": "http://schema.org/", "@type": "Thing" }]).issues, [], "http and a trailing slash are fine");
    assert.deepEqual(check([{ "@context": { "@vocab": "https://schema.org/" }, "@type": "Thing" }]).issues, []);
  });

  test("an @graph is walked like separate documents; arrays at the top level too", () => {
    const graph = { "@context": "https://schema.org", "@graph": [{ ...productLd(), "@context": undefined }, { ...breadcrumbLd(), "@context": undefined }] };
    const { issues, facts } = check([graph]);
    assert.deepEqual(issues, []);
    assert.deepEqual(facts.types, ["Product", "BreadcrumbList"]);
    assert.deepEqual(check([[productLd(), breadcrumbLd()]]).issues, []);
    const bare = check([{ "@context": "https://schema.org", "@graph": [{ "@type": "Product", name: "x" }] }]).issues;
    assert.deepEqual(
      errors(bare).map((i) => i.message.replace(/^.*: /, "")),
      ['"image" is missing.', '"offers" is missing (merchant listings need an Offer).'],
      "a Product at the root of an @graph gets the full merchant-listing rules",
    );
  });

  test("URLs on another local host are reported once per origin", () => {
    const doc = JSON.parse(JSON.stringify(productLd()).split(ORIGIN).join("http://localhost:3000")) as unknown;
    const { issues } = check([doc]);
    assert.deepEqual(codes(issues), ["foreign-origin-url", "jsonld-mismatch"]);
    assert.match(issues.find((i) => i.code === "foreign-origin-url")?.message ?? "", /http:\/\/localhost:3000/);
  });
});

describe("Product / Offer (merchant listings)", () => {
  test("the pre-day-5 product markup (Product with one Offer per variant) is clean; offers become facts", () => {
    const { issues, facts } = check([productLd(), breadcrumbLd()]);
    assert.deepEqual(issues, []);
    assert.deepEqual(facts.offers.map((o) => [o.sku, o.price, o.currency, o.availability]), [
      ["PR-LAV-500", 149.9, "TRY", "InStock"],
      ["PR-LAV-5L", 449.9, "TRY", "InStock"],
    ]);
    assert.deepEqual(facts.images, [url("/media/urunler/lavanta/lavanta-1024.webp")]);
  });

  test("name, image and offers are required", () => {
    const { issues } = check([productLd({ name: undefined, image: undefined, offers: undefined })]);
    assert.deepEqual(codes(issues), ["jsonld-required", "jsonld-required", "jsonld-required"]);
  });

  test("an AggregateOffer is not a merchant listing", () => {
    only([productLd({ offers: { "@type": "AggregateOffer", lowPrice: "149.90", highPrice: "1499.90", priceCurrency: "TRY" } })], "jsonld-invalid-value", /AggregateOffer/);
  });

  const offer = (extra: Record<string, unknown>) => productLd({ offers: { "@type": "Offer", price: "149.90", priceCurrency: "TRY", availability: "https://schema.org/InStock", ...extra } });

  test("price: plain number above zero; currency: ISO 4217", () => {
    only([offer({ price: "₺149,90" })], "jsonld-invalid-value", /plain number/);
    only([offer({ price: 0 })], "jsonld-invalid-value", /greater than zero/);
    only([offer({ price: undefined })], "jsonld-required", /price/);
    only([offer({ priceCurrency: "TL" })], "jsonld-invalid-value", /ISO 4217/);
    only([offer({ priceCurrency: undefined })], "jsonld-required", /priceCurrency/);
    assert.deepEqual(check([offer({ price: undefined, priceCurrency: undefined, priceSpecification: { "@type": "UnitPriceSpecification", price: 149.9, priceCurrency: "TRY" } })]).issues, []);
  });

  test("availability / itemCondition enums, priceValidUntil not in the past, absolute offer url", () => {
    only([offer({ availability: "Available" })], "jsonld-invalid-value", /ItemAvailability/);
    only([offer({ availability: undefined })], "jsonld-recommended", /availability/);
    assert.deepEqual(check([offer({ availability: "InStock" })]).issues, [], "short enum names are accepted");
    only([offer({ itemCondition: "Brand new" })], "jsonld-invalid-value", /OfferItemCondition/);
    only([offer({ priceValidUntil: "2026-01-01" })], "jsonld-invalid-value", /in the past/);
    only([offer({ priceValidUntil: "31.12.2026" })], "jsonld-invalid-value", /ISO 8601/);
    assert.deepEqual(check([offer({ priceValidUntil: "2026-12-31" })]).issues, []);
    only([offer({ url: "/tr/urunler/lavanta" })], "jsonld-invalid-value", /absolute URL/);
  });

  test("GTINs need digits, the right length and a valid check digit; sku is one token", () => {
    assert.equal(isValidGtin("8685317540009", 13), true);
    assert.equal(isValidGtin("8685317540008", 13), false);
    assert.equal(isValidGtin("868531754000", 13), false);
    assert.equal(isValidGtin("96385074"), true);
    only([productLd({ gtin13: "8685317540008" })], "jsonld-invalid-value", /GTIN13/);
    only([productLd({ gtin13: "86853175400" })], "jsonld-invalid-value", /GTIN13/);
    only([productLd({ sku: "PR LAV 500" })], "jsonld-invalid-value", /sku/);
    only([productLd({ sku: undefined })], "jsonld-recommended", /sku/);
  });

  test("aggregateRating and review", () => {
    only([productLd({ aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5 } })], "jsonld-required", /ratingCount/);
    only([productLd({ aggregateRating: { "@type": "AggregateRating", ratingValue: 6, reviewCount: 3 } })], "jsonld-invalid-value", /outside 1–5/);
    assert.deepEqual(check([productLd({ aggregateRating: { "@type": "AggregateRating", ratingValue: "4.7", reviewCount: 3, bestRating: 5 } })]).issues, []);
    only([productLd({ review: [{ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: 5 } }] })], "jsonld-required", /author/);
    assert.deepEqual(check([productLd({ review: [{ "@type": "Review", author: { "@type": "Person", name: "Ayşe" }, reviewRating: { "@type": "Rating", ratingValue: 5 } }] })]).issues, []);
  });
});

describe("ProductGroup (product variants)", () => {
  test("a complete group is clean; groups, offers and variant URLs become facts", () => {
    const { issues, facts } = check([productGroupLd()]);
    assert.deepEqual(issues, []);
    assert.deepEqual(facts.groups, [{ id: "lavanta", skus: ["PR-LAV-500", "PR-LAV-5L"] }]);
    assert.deepEqual(facts.offers.map((o) => o.sku), ["PR-LAV-500", "PR-LAV-5L"]);
    assert.ok(facts.pageUrls.includes(`${url(PATHS.product.tr)}?varyant=11`));
  });

  test("a unique group id is required; productGroupID and inProductGroupWithID must agree", () => {
    only([productGroupLd({ productGroupID: undefined })], "jsonld-required", /group id/);
    assert.deepEqual(check([productGroupLd({ productGroupID: undefined, hasVariant: [variant("A-1", "500 ml", 1, { inProductGroupWithID: "g" }), variant("A-2", "5 L", 2, { inProductGroupWithID: "g" })] })]).issues, []);
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { inProductGroupWithID: "other" })] })], "jsonld-invalid-value", /inProductGroupWithID/);
  });

  test("each variant is a full Product with a unique id; variant urls and names differ", () => {
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { sku: undefined }), variant("A-2", "5 L", 2)] })], "jsonld-required", /unique id/);
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { image: undefined }), variant("A-2", "5 L", 2)] })], "jsonld-required", /image/);
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { offers: undefined }), variant("A-2", "5 L", 2)] })], "jsonld-required", /offers/);
    const sameUrl = { url: `${url(PATHS.product.tr)}?varyant=1`, offers: { ...variant("x", "x", 1).offers } };
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1), variant("A-2", "5 L", 2, sameUrl)] })], "jsonld-invalid-value", /share the url/);
    const { issues } = check([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { name: "Lavanta Sıvı El Sabunu" }), variant("A-2", "5 L", 2)] })]);
    assert.deepEqual(codes(issues), ["jsonld-recommended"], "a variant name equal to the group name");
  });

  test("variesBy values, size per variant, descriptions reported once per group", () => {
    only([productGroupLd({ variesBy: ["boyut"] })], "jsonld-invalid-value", /variesBy/);
    assert.deepEqual(check([productGroupLd({ variesBy: ["size"] })]).issues, []);
    only([productGroupLd({ variesBy: undefined })], "jsonld-recommended", /variesBy/);
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { size: undefined }), variant("A-2", "5 L", 2)] })], "jsonld-recommended", /size/);
    only([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { description: undefined }), variant("A-2", "5 L", 2, { description: undefined })] })], "jsonld-recommended", /2 of 2 variants/);
  });

  test("variant and offer urls should be the group url with a variant parameter", () => {
    const elsewhere = check([productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { url: url("/tr/urunler/baska") })] })]).issues;
    assert.deepEqual(codes(elsewhere), ["jsonld-mismatch", "jsonld-mismatch"]);
    assert.match(elsewhere[0].message, /group url/);
    assert.match(elsewhere[1].message, /offer url differs/);
  });
});

describe("OfferShippingDetails and MerchantReturnPolicy", () => {
  const withOffer = (extra: Record<string, unknown>) => productGroupLd({ hasVariant: [variant("A-1", "500 ml", 1, { offers: { ...variant("A-1", "500 ml", 1).offers, ...extra } })] });

  test("destination country and rate are required; the rate currency matches the offer", () => {
    only([withOffer({ shippingDetails: { ...SHIPPING, shippingDestination: undefined } })], "jsonld-required", /shippingDestination/);
    only([withOffer({ shippingDetails: { ...SHIPPING, shippingDestination: { "@type": "DefinedRegion", addressCountry: "Türkiye" } } })], "jsonld-invalid-value", /alpha-2/);
    only([withOffer({ shippingDetails: { ...SHIPPING, shippingRate: undefined } })], "jsonld-required", /shippingRate/);
    only([withOffer({ shippingDetails: { ...SHIPPING, shippingRate: { "@type": "MonetaryAmount", value: "99,90 TL", currency: "TRY" } } })], "jsonld-invalid-value", /non-negative/);
    only([withOffer({ shippingDetails: { ...SHIPPING, shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "EUR" } } })], "jsonld-invalid-value", /differs from the offer/);
  });

  test("deliveryTime: only a warning when absent (the contract omits it until a setting exists); malformed is an error", () => {
    const { issues } = check([withOffer({ shippingDetails: { ...SHIPPING, deliveryTime: undefined } })]);
    assert.deepEqual(codes(issues), ["jsonld-recommended"]);
    assert.equal(errors(issues).length, 0);
    const bad = { ...SHIPPING, deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 3, unitCode: "HUR" } } };
    only([withOffer({ shippingDetails: bad })], "jsonld-invalid-value", /handlingTime/);
  });

  test("return policy: country and category required, days for a finite window, fee enums", () => {
    only([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, applicableCountry: undefined } })], "jsonld-required", /applicableCountry/);
    only([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, returnPolicyCategory: "14 days" } })], "jsonld-invalid-value", /returnPolicyCategory/);
    only([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, merchantReturnDays: undefined } })], "jsonld-required", /merchantReturnDays/);
    only([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, returnFees: "Free" } })], "jsonld-invalid-value", /returnFees/);
    only([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, returnFees: "https://schema.org/FreeReturn", returnShippingFeesAmount: { "@type": "MonetaryAmount", value: 10, currency: "TRY" } } })], "jsonld-invalid-value", /must not be set/);
    only([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, returnFees: "https://schema.org/ReturnShippingFees" } })], "jsonld-required", /returnShippingFeesAmount/);
    assert.deepEqual(check([withOffer({ hasMerchantReturnPolicy: { ...RETURN_POLICY, returnFees: "https://schema.org/ReturnFeesCustomerResponsibility" } })]).issues, []);
  });

  test("a reference by @id is resolved from the same page", () => {
    const policy = { ...RETURN_POLICY, "@id": `${ORIGIN}/#returns`, applicableCountry: undefined };
    const org = { "@context": "https://schema.org", "@type": "OnlineStore", "@id": `${ORIGIN}/#organization`, name: "PRESTİJ", url: url("/tr"), hasMerchantReturnPolicy: policy };
    const { issues } = check([org, withOffer({ hasMerchantReturnPolicy: { "@id": `${ORIGIN}/#returns` } })], { canonical: url(PATHS.product.tr) });
    assert.deepEqual(codes(issues), ["jsonld-required", "jsonld-required"], "the referenced policy is checked where it is used too");
  });
});

describe("BreadcrumbList", () => {
  test("clean trail; positions in order; item required except on the last crumb; absolute items; the last crumb is this page", () => {
    assert.deepEqual(check([breadcrumbLd()]).issues, []);
    assert.deepEqual(check([breadcrumbLd(true)]).issues, []);
    const crumbs = breadcrumbLd() as { itemListElement: Record<string, unknown>[] };
    const edit = (i: number, patch: Record<string, unknown>) => ({ ...crumbs, itemListElement: crumbs.itemListElement.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    only([edit(1, { position: 3 })], "jsonld-invalid-value", /position/);
    only([edit(1, { item: undefined })], "jsonld-required", /item/);
    only([edit(1, { item: "/tr/urunler" })], "jsonld-invalid-value", /absolute/);
    only([edit(1, { name: undefined })], "jsonld-required", /name/);
    only([edit(2, { item: url("/tr/urunler/baska") })], "jsonld-mismatch", /last crumb/);
    only([{ ...crumbs, itemListElement: [{ "@type": "ListItem", position: 1, name: "Lavanta" }] }], "jsonld-recommended", /two items/);
    only([{ ...crumbs, itemListElement: [] }], "jsonld-required", /itemListElement/);
  });
});

describe("Organization / OnlineStore and WebSite", () => {
  const org = (extra: Record<string, unknown> = {}) => ({
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${ORIGIN}/#organization`,
    name: "PRESTİJ",
    legalName: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.",
    url: url("/tr"),
    logo: url("/media/marka/prestij-logo-480.png"),
    telephone: "+90 352 353 30 70",
    address: { "@type": "PostalAddress", addressLocality: "Kocasinan", addressRegion: "Kayseri", addressCountry: "TR" },
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer service", telephone: "+90 352 353 30 70", availableLanguage: ["tr", "en", "ar"] }],
    sameAs: ["https://www.instagram.com/prestij"],
    hasMerchantReturnPolicy: RETURN_POLICY,
    ...extra,
  });
  const home = { pageUrl: url("/tr"), canonical: url("/tr") };

  test("a complete OnlineStore is clean; its logo is an image to check", () => {
    const { issues, facts } = check([org()], home);
    assert.deepEqual(issues, []);
    assert.deepEqual(facts.images, [url("/media/marka/prestij-logo-480.png")]);
  });

  test("name required; sameAs and logo absolute; telephone and country formats are warnings", () => {
    only([org({ name: undefined })], "jsonld-required", /name/, home);
    only([org({ sameAs: ["instagram.com/prestij"] })], "jsonld-invalid-value", /absolute/, home);
    only([org({ logo: "/media/logo.png" })], "jsonld-invalid-value", /absolute image URL/, home);
    only([org({ telephone: "0352 353 30 70" })], "jsonld-format", /international/, home);
    only([org({ address: { "@type": "PostalAddress", addressCountry: "Türkiye" } })], "jsonld-format", /alpha-2/, home);
    only([org({ contactPoint: { "@type": "ContactPoint", contactType: "customer service" } })], "jsonld-recommended", /telephone or an email/, home);
    only([org({ url: undefined })], "jsonld-recommended", /url/, home);
    assert.deepEqual(check([{ "@context": "https://schema.org", "@type": "Organization", name: "PRESTİJ" }]).issues.filter((i) => i.severity === "error"), []);
  });

  test("WebSite needs name and url (the home page); a SearchAction must be well formed", () => {
    const site = { "@context": "https://schema.org", "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "PRESTİJ", url: url("/tr"), inLanguage: "tr-TR", publisher: { "@id": `${ORIGIN}/#organization` } };
    assert.deepEqual(check([site], home).issues, []);
    only([{ ...site, url: undefined }], "jsonld-required", /url/, home);
    only([{ ...site, url: url("/tr/urunler/lavanta") }], "jsonld-mismatch", /home page/, home);
    only([{ ...site, potentialAction: { "@type": "SearchAction", target: `${ORIGIN}/ara?q=` } }], "jsonld-invalid-value", /search_term_string/, home);
    only([{ ...site, inLanguage: "en-US" }], "jsonld-mismatch", /inLanguage/, home);
    // The site markup PRESTİJ prints: the domain root as url and every enabled language.
    assert.deepEqual(check([{ ...site, url: `${ORIGIN}/`, inLanguage: ["tr-TR", "en-US", "ar"] }], home).issues, []);
    only([{ ...site, inLanguage: ["en-US", "ar"] }], "jsonld-mismatch", /inLanguage "en-US, ar"/, home);
  });
});

describe("CollectionPage + ItemList", () => {
  const listing = { pageUrl: url("/tr/kategori/el-sabunu"), canonical: url("/tr/kategori/el-sabunu") };
  const collection = (extra: Record<string, unknown> = {}, list: Record<string, unknown> = {}) => ({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Sıvı El Sabunu",
    url: url("/tr/kategori/el-sabunu"),
    inLanguage: "tr-TR",
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: 2,
      itemListElement: [
        { "@type": "ListItem", position: 1, url: url("/tr/urunler/lavanta"), name: "Lavanta" },
        { "@type": "ListItem", position: 2, url: url("/tr/urunler/portakal"), name: "Portakal" },
      ],
      ...list,
    },
    ...extra,
  });

  test("clean listing; the listed URLs are page URLs to crawl", () => {
    const { issues, facts } = check([collection()], listing);
    assert.deepEqual(issues, []);
    assert.deepEqual(facts.types, ["CollectionPage", "ItemList"]);
    assert.ok(facts.pageUrls.includes(url("/tr/urunler/portakal")));
  });

  test("numberOfItems matches, positions run 1, 2, 3, urls are absolute, url = canonical", () => {
    only([collection({}, { numberOfItems: 3 })], "jsonld-invalid-value", /numberOfItems/, listing);
    only([collection({}, { itemListElement: [{ "@type": "ListItem", position: 2, url: url("/tr/urunler/lavanta") }], numberOfItems: 1 })], "jsonld-invalid-value", /position/, listing);
    only([collection({}, { itemListElement: [{ "@type": "ListItem", position: 1, url: "/tr/urunler/lavanta" }], numberOfItems: 1 })], "jsonld-invalid-value", /absolute/, listing);
    only([collection({}, { itemListElement: [{ "@type": "ListItem", position: 1, name: "x" }], numberOfItems: 1 })], "jsonld-required", /url/, listing);
    only([collection({ url: url("/tr/urunler") })], "jsonld-mismatch", /canonical/, listing);
    only([collection({ name: undefined })], "jsonld-required", /name/, listing);
  });
});

describe("BlogPosting", () => {
  const post = { pageUrl: url("/tr/blog/sivi-el-sabunu-nasil-secilir"), canonical: url("/tr/blog/sivi-el-sabunu-nasil-secilir") };
  const posting = (extra: Record<string, unknown> = {}) => ({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Sıvı el sabunu nasıl seçilir?",
    description: "Koku, ambalaj ve kullanım alanına göre seçim rehberi.",
    image: [url("/media/yasam/banyo-1200.webp")],
    datePublished: "2026-10-20T09:00:00+03:00",
    dateModified: "2026-11-01T09:00:00+03:00",
    inLanguage: "tr-TR",
    author: { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "PRESTİJ", url: url("/tr") },
    publisher: { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "PRESTİJ" },
    mainEntityOfPage: { "@type": "WebPage", "@id": post.canonical },
    url: post.canonical,
    ...extra,
  });

  test("a complete post is clean", () => {
    assert.deepEqual(check([posting()], post).issues, []);
  });

  test("headline and datePublished required; dates ISO 8601 with a zone; author Person/Organization with a name", () => {
    only([posting({ headline: undefined })], "jsonld-required", /headline/, post);
    only([posting({ datePublished: "20.10.2026" })], "jsonld-invalid-value", /ISO 8601/, post);
    only([posting({ datePublished: "2026-10-20T09:00:00" })], "jsonld-format", /time zone/, post);
    only([posting({ dateModified: "2026-10-01T09:00:00+03:00" })], "jsonld-format", /before/, post);
    only([posting({ author: undefined })], "jsonld-required", /author/, post);
    only([posting({ author: { "@type": "Thing", name: "PRESTİJ" } })], "jsonld-invalid-value", /Person or Organization/, post);
    only([posting({ author: { "@type": "Person" } })], "jsonld-required", /name/, post);
    only([posting({ image: undefined })], "jsonld-recommended", /image/, post);
    only([posting({ headline: "x".repeat(111) })], "jsonld-format", /headline/, post);
    only([posting({ mainEntityOfPage: { "@type": "WebPage", "@id": url("/tr/blog") } })], "jsonld-mismatch", /mainEntityOfPage/, post);
  });

  test("an author given only by @id must be described on the same page", () => {
    const ref = { "@id": `${ORIGIN}/#organization` };
    const dangling = check([posting({ author: ref, publisher: ref })], post).issues;
    assert.deepEqual(codes(dangling), ["jsonld-recommended", "jsonld-recommended"]);
    assert.ok(dangling.every((i) => /not described on this page/.test(i.message)));
    // Described anywhere on the page (another block, or the publisher with the same @id): resolved.
    const org = { "@context": "https://schema.org", "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "PRESTİJ", url: url("/tr") };
    assert.deepEqual(check([org, posting({ author: ref, publisher: ref })], post).issues, []);
    assert.deepEqual(check([posting({ author: ref })], post).issues, []);
  });
});

describe("FAQPage and duplicates", () => {
  const faq = (items: { q?: string; a?: string }[]) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", ...(i.q ? { name: i.q } : {}), ...(i.a ? { acceptedAnswer: { "@type": "Answer", text: i.a } } : {}) })),
  });

  test("questions need a name and an accepted answer text", () => {
    assert.deepEqual(check([faq([{ q: "5 L bidon var mı?", a: "Evet." }])]).issues, []);
    only([faq([{ q: "Soru?" }])], "jsonld-required", /acceptedAnswer/);
    only([faq([{ a: "Cevap." }])], "jsonld-required", /question/);
    only([faq([])], "jsonld-required", /mainEntity/);
  });

  test("one FAQPage per page (error); a type printed twice is a warning", () => {
    const one = faq([{ q: "A?", a: "B." }]);
    only([one, one], "jsonld-faq-multiple");
    only([breadcrumbLd(), breadcrumbLd()], "jsonld-duplicate-type", /BreadcrumbList/);
  });
});
