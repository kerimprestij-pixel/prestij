// Day 5 SEO-TECH: the completed builders in src/lib/seo/structured-data.ts, checked against Google
// Search Central's required and recommended properties (read 2026-11-10):
//   Organization (OnlineStore) · MerchantReturnPolicy · merchant listings (Product/Offer/OfferShippingDetails)
//   · product variants (ProductGroup) · review snippets · BlogPosting · CollectionPage/ItemList.
// Plus: the one-unit shipping rate equals the money engine's (computeCart) for the same cart.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { jsonLd } from "@/components/store/format";
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import { computeCart } from "@/lib/cart/compute";
import type { EngineCampaign } from "@/lib/cart/types";
import type { PostDetail } from "@/lib/data/blog";
import type { ProductCardData, ProductDetail, ProductVariantData } from "@/lib/data/catalog";
import type { MediaLike } from "@/lib/media/types";
import { kurusToDecimal } from "@/lib/pricing/money";
import type { ProductReviewsData, PublicReview } from "@/lib/reviews/types";
import {
  blogPostingJsonLd,
  collectionPageJsonLd,
  countryCode,
  httpsUrl,
  MAX_JSONLD_REVIEWS,
  merchantReturnPolicyJsonLd,
  offerShippingDetails,
  oneUnitShippingFee,
  ORG_ID,
  organizationJsonLd,
  phoneE164,
  postKeywords,
  productGroupId,
  productGroupJsonLd,
  SCHEMA_CONTEXT,
  validGtin13,
  WEBSITE_ID,
  webSiteJsonLd,
  type JsonLdNode,
} from "@/lib/seo/structured-data";
import { settingsSchemas, type Settings } from "@/lib/settings/types";
import { input, line, NOW, settings as engineSettings } from "./helpers";

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
const S = (name: string) => `https://schema.org/${name}`;

const media = (id: number, url: string, width = 1024, height = 1536): MediaLike => ({ id, url, width, height, alt: null, blurDataUrl: null, dominantColor: null, variants: null });
const LOGO = media(50, "/media/marka/prestij-logo-652.webp", 652, 333);

/** The real catalog's shape: Lavanta in pump bottle / 5 L / 20 L (weights and prices as seeded). */
function variant(id: number, overrides: Partial<ProductVariantData>): ProductVariantData {
  return {
    id,
    sku: `PR-LAV-${id}`,
    barcode: null,
    price: 14990,
    compareAtPrice: null,
    vatRate: 20,
    stock: 50,
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

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 2,
    slug: "lavanta",
    type: "standard",
    name: { tr: "Lavanta", en: "Lavender", ar: "اللافندر" },
    subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap", ar: "صابون سائل لليدين" },
    shortDescription: { tr: "Klasik lavanta ferahlığı.", en: "Classic lavender freshness." },
    description: null,
    accentColor: "#8E61B6",
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
    ratingAverage: 470,
    ratingCount: 3,
    categoryId: 1,
    category: { id: 1, slug: "el-sabunu", name: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" } },
    options: [
      {
        id: 2,
        name: { tr: "Ambalaj", en: "Packaging" },
        display: "buttons",
        values: [
          { id: 4, value: { tr: "Pompalı Şişe 500 ml", en: "Pump Bottle 500 ml" }, swatchColor: null, swatchMediaId: null },
          { id: 5, value: { tr: "5 L Bidon", en: "5 L Canister" }, swatchColor: null, swatchMediaId: null },
          { id: 6, value: { tr: "20 L Bidon", en: "20 L Canister" }, swatchColor: null, swatchMediaId: null },
        ],
      },
    ],
    variants: [
      variant(4, { sku: "PR-LAV-500", isDefault: true, optionValueIds: [4] }),
      // A 13-digit barcode whose check digit is wrong: never sent as gtin13.
      variant(5, { sku: "PR-LAV-5L", barcode: "8685317540001", price: 44990, volumeMl: 5000, weightGrams: 5300, optionValueIds: [5], stock: 0 }),
      variant(6, { sku: "PR-LAV-20L", barcode: "8685317540030", price: 149990, volumeMl: 20000, weightGrams: 21000, optionValueIds: [6] }),
    ],
    defaultVariantId: 4,
    media: [
      { media: media(10, "/media/urunler/lavanta/pompali-1024.webp"), variantId: null, role: "packshot" },
      { media: media(11, "/media/urunler/lavanta/spa-1024.webp"), variantId: null, role: "lifestyle" },
      { media: media(12, "/media/urunler/lavanta/5l-1024.webp"), variantId: 5, role: "packshot" },
      { media: media(13, "https://cdn.example/lavanta/20l.webp"), variantId: 6, role: "packshot" },
    ],
    tiers: [],
    bundleItems: [],
    related: [],
    sampleProductSlug: "lavanta-numune",
    campaign: null,
    ...overrides,
  };
}

/** The four-scent 5 L set: one variant, no options. */
function bundle(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return product({
    id: 5,
    slug: "dort-koku-koleksiyonu",
    type: "bundle",
    name: { tr: "Dört Koku Koleksiyonu" },
    subtitle: { tr: "4 × 5 L Bidon Seti" },
    options: [],
    category: { id: 3, slug: "hediye-setleri", name: { tr: "Hediye Setleri" } },
    variants: [variant(13, { sku: "PR-SET-4X5L", price: 159990, volumeMl: 20000, weightGrams: 21200, isDefault: true })],
    defaultVariantId: 13,
    media: [{ media: media(40, "/media/urunler/collection/set-1536.webp", 1536, 1024), variantId: null, role: "packshot" }],
    ...overrides,
  });
}

const review = (id: number, rating: number, createdAt: string, extra: Partial<PublicReview> = {}): PublicReview => ({
  id,
  rating,
  title: null,
  body: null,
  authorName: `Müşteri ${id}`,
  locale: "tr",
  verified: true,
  createdAt,
  reply: null,
  ...extra,
});

const REVIEWS: ProductReviewsData = {
  productId: 2,
  summary: { count: 7, average: 457, distribution: [0, 0, 1, 1, 5] },
  reviews: [
    review(7, 5, "2026-11-02T21:30:00.000Z", { title: "Harika", body: "Çok güzel koku." }),
    review(6, 4, "2026-11-01T10:00:00.000Z", { locale: "en", authorName: "John" }),
    review(5, 5, "2026-10-30T10:00:00.000Z"),
    review(4, 5, "2026-10-29T10:00:00.000Z"),
    review(3, 3, "2026-10-28T10:00:00.000Z"),
    review(2, 5, "2026-10-27T10:00:00.000Z"),
    review(1, 5, "2026-10-26T10:00:00.000Z"),
  ],
  hasMore: true,
};

const build = (overrides: Partial<Parameters<typeof productGroupJsonLd>[0]> = {}) =>
  productGroupJsonLd({ product: product(), locale: "tr", reviews: null, general, shipping, seo, ...overrides });

const asNode = (value: unknown): JsonLdNode => value as JsonLdNode;
const nodes = (value: unknown): JsonLdNode[] => value as JsonLdNode[];

// ---------------------------------------------------------------------------------------------------

describe("small helpers", () => {
  test("phoneE164: Turkish spellings get +90, international ones are kept, junk is null", () => {
    assert.equal(phoneE164("0352 353 30 70"), "+903523533070");
    assert.equal(phoneE164("352 353 30 70"), "+903523533070");
    assert.equal(phoneE164("+90 (352) 353-30-70"), "+903523533070");
    assert.equal(phoneE164("0090 352 353 30 70"), "+903523533070");
    assert.equal(phoneE164("90 352 353 30 70"), "+903523533070");
    assert.equal(phoneE164("+44 20 7946 0958"), "+442079460958");
    for (const bad of ["", "   ", "abc", "123", "0352 353", null, undefined]) assert.equal(phoneE164(bad), null, String(bad));
  });

  test("countryCode and httpsUrl", () => {
    assert.equal(countryCode("Türkiye"), "TR");
    assert.equal(countryCode(" turkey "), "TR");
    assert.equal(countryCode("TR"), "TR");
    assert.equal(countryCode("Germany"), null);
    assert.equal(httpsUrl("https://instagram.com/prestij"), "https://instagram.com/prestij");
    for (const bad of ["http://instagram.com/prestij", "instagram.com/prestij", "javascript:alert(1)", "https://localhost/x", "", undefined]) {
      assert.equal(httpsUrl(bad), null, String(bad));
    }
  });

  test("validGtin13 needs the EAN-13 check digit; productGroupId is stable", () => {
    assert.equal(validGtin13("8685317540030"), "8685317540030");
    assert.equal(validGtin13("8685317540001"), null);
    assert.equal(validGtin13("123"), null);
    assert.equal(validGtin13(null), null);
    assert.equal(productGroupId({ id: 2 }), "PRD-2");
  });
});

describe("Organization (OnlineStore) — Google: no required properties; recommended ones present", () => {
  const social = { instagram: "https://www.instagram.com/prestij", facebook: "http://facebook.com/prestij", youtube: "not a url", tiktok: "https://www.instagram.com/prestij" };

  test("full shop: subtype, ids, names, url, logo, phone, address, contactPoint, sameAs, return policy", () => {
    const org = organizationJsonLd({
      locale: "en",
      general: { ...general, email: "info@prestij.com.tr", social, taxNumber: "1234567890" },
      seo,
      logo: LOGO,
      languages: ["tr", "en", "ar"],
      returnsPath: "/en/page/iade-ve-degisim",
    });
    assert.equal(org["@context"], SCHEMA_CONTEXT);
    assert.equal(org["@type"], "OnlineStore");
    assert.equal(org["@id"], ORG_ID());
    assert.equal(org.name, "PRESTİJ");
    assert.equal(org.legalName, "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.");
    assert.equal(org.url, `${ORIGIN}/en`);
    assert.equal(org.logo, `${ORIGIN}/media/marka/prestij-logo-652.webp`);
    assert.equal(org.telephone, "+903523533070");
    assert.equal(org.email, "info@prestij.com.tr");
    assert.equal(org.taxID, "1234567890");
    assert.ok(typeof org.description === "string" && org.description.length > 20);
    assert.deepEqual(org.address, {
      "@type": "PostalAddress",
      streetAddress: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E",
      addressLocality: "Kocasinan",
      addressRegion: "Kayseri",
      addressCountry: "TR",
    });
    assert.deepEqual(org.contactPoint, {
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: "+903523533070",
      email: "info@prestij.com.tr",
      areaServed: "TR",
      availableLanguage: ["tr-TR", "en-US", "ar"],
    });
    // Only valid https profile links, once each.
    assert.deepEqual(org.sameAs, ["https://www.instagram.com/prestij"]);
    const policy = asNode(org.hasMerchantReturnPolicy);
    assert.equal(policy["@type"], "MerchantReturnPolicy");
    assert.equal(policy.merchantReturnLink, `${ORIGIN}/en/page/iade-ve-degisim`);
    assert.equal("potentialAction" in org, false);
  });

  test("defaults: no e-mail, no social links, no tax number → those properties are left out", () => {
    const org = organizationJsonLd({ locale: "tr", general, seo, logo: LOGO });
    for (const key of ["email", "sameAs", "taxID"]) assert.equal(key in org, false, key);
    assert.equal(asNode(org.contactPoint).email, undefined);
    assert.deepEqual(asNode(org.contactPoint).availableLanguage, ["tr-TR", "en-US", "ar"]);
    assert.equal("merchantReturnLink" in asNode(org.hasMerchantReturnPolicy), false);
  });

  test("logo smaller than 112 px is not offered; same legal name is not repeated; bad e-mail dropped", () => {
    const org = organizationJsonLd({
      locale: "tr",
      general: { ...general, legalName: "PRESTİJ", email: "not-an-email" },
      seo,
      logo: media(1, "/media/marka/tiny.webp", 100, 40),
    });
    assert.equal("logo" in org, false);
    assert.equal("legalName" in org, false);
    assert.equal("email" in org, false);
  });

  test("contactPoint languages follow the enabled locales", () => {
    const org = organizationJsonLd({ locale: "tr", general, seo, logo: null, languages: ["tr"] });
    assert.deepEqual(asNode(org.contactPoint).availableLanguage, ["tr-TR"]);
  });
});

describe("MerchantReturnPolicy — required: applicableCountry, returnPolicyCategory (+ merchantReturnDays when finite)", () => {
  test("14 days, return fees not stated → finite window, by mail, new condition, full refund, no returnFees", () => {
    assert.deepEqual(merchantReturnPolicyJsonLd({ days: 14, freeReturns: null }, `${ORIGIN}/tr/sayfa/iade-ve-degisim`), {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "TR",
      returnPolicyCountry: "TR",
      returnPolicyCategory: S("MerchantReturnFiniteReturnWindow"),
      merchantReturnDays: 14,
      returnMethod: S("ReturnByMail"),
      itemCondition: S("NewCondition"),
      refundType: S("FullRefund"),
      merchantReturnLink: `${ORIGIN}/tr/sayfa/iade-ve-degisim`,
    });
  });

  test("who pays return shipping maps to returnFees; never with an amount", () => {
    assert.equal(merchantReturnPolicyJsonLd({ days: 30, freeReturns: true }).returnFees, S("FreeReturn"));
    assert.equal(merchantReturnPolicyJsonLd({ days: 30, freeReturns: false }).returnFees, S("ReturnFeesCustomerResponsibility"));
    assert.equal("returnShippingFeesAmount" in merchantReturnPolicyJsonLd({ days: 30, freeReturns: false }), false);
  });

  test("0 days → returns not permitted (no days, method or fees)", () => {
    assert.deepEqual(merchantReturnPolicyJsonLd({ days: 0, freeReturns: true }), {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "TR",
      returnPolicyCategory: S("MerchantReturnNotPermitted"),
    });
  });
});

describe("WebSite", () => {
  test("one entity: the domain root as url (Google site names), every enabled language, publisher by @id, no SearchAction", () => {
    const site = webSiteJsonLd({ locale: "ar", general, seo });
    assert.equal(site["@type"], "WebSite");
    assert.equal(site["@id"], WEBSITE_ID());
    assert.equal(site.url, `${ORIGIN}/`, "never the /ar subdirectory");
    assert.deepEqual(site.inLanguage, ["tr-TR", "en-US", "ar"]);
    for (const locale of ["tr", "en"] as const) assert.equal(webSiteJsonLd({ locale, general, seo }).url, `${ORIGIN}/`);
    assert.deepEqual(webSiteJsonLd({ locale: "en", general, seo, languages: ["tr", "en"] }).inLanguage, ["tr-TR", "en-US"]);
    assert.equal(webSiteJsonLd({ locale: "tr", general, seo, languages: ["tr"] }).inLanguage, "tr-TR");
    assert.deepEqual(site.publisher, { "@id": ORG_ID() });
    assert.equal("potentialAction" in site, false);
  });
});

describe("ProductGroup (several sellable variants) — Google product variants + merchant listings", () => {
  test("group: name, productGroupID, variesBy size, clean url, brand, description, images, category", () => {
    const doc = build();
    assert.ok(doc);
    assert.equal(doc["@context"], SCHEMA_CONTEXT);
    assert.equal(doc["@type"], "ProductGroup");
    assert.equal(doc.name, "Lavanta — Sıvı El Sabunu");
    assert.equal(doc.productGroupID, "PRD-2");
    assert.deepEqual(doc.variesBy, [S("size")]);
    assert.equal(doc.url, `${ORIGIN}/tr/urunler/lavanta`);
    assert.deepEqual(doc.brand, { "@type": "Brand", name: "PRESTİJ" });
    assert.equal(doc.description, "Klasik lavanta ferahlığı.");
    assert.equal(doc.category, "Sıvı El Sabunu");
    assert.deepEqual(doc.image, [
      `${ORIGIN}/media/urunler/lavanta/pompali-1024.webp`,
      `${ORIGIN}/media/urunler/lavanta/spa-1024.webp`,
      `${ORIGIN}/media/urunler/lavanta/5l-1024.webp`,
      "https://cdn.example/lavanta/20l.webp",
    ]);
    assert.equal("offers" in doc, false, "a ProductGroup carries no offers of its own");
    assert.equal("aggregateRating" in doc, false, "no reviews block → no rating, even with products.rating_count > 0");
  });

  test("each variant: Product with size in the name, sku, valid gtin13 only, size, images, ?varyant= url, group id", () => {
    const group = build()!;
    const variants = nodes(group.hasVariant);
    assert.equal(variants.length, 3);
    const [bottle, five, twenty] = variants;
    for (const v of variants) {
      assert.equal(v["@type"], "Product");
      assert.ok(typeof group.description === "string" && group.description.length > 0);
      assert.equal(v.description, group.description, "description is recommended on each variant too");
      assert.equal(v.inProductGroupWithID, "PRD-2");
      assert.deepEqual(v.brand, { "@type": "Brand", name: "PRESTİJ" });
      assert.ok(Array.isArray(v.image) && (v.image as string[]).length > 0 && (v.image as string[]).every((u) => u.startsWith("https://")));
    }
    assert.equal(bottle.name, "Lavanta — Sıvı El Sabunu (Pompalı Şişe 500 ml)");
    assert.equal(bottle.size, "Pompalı Şişe 500 ml");
    assert.equal(bottle.sku, "PR-LAV-500");
    assert.equal(bottle.url, `${ORIGIN}/tr/urunler/lavanta?varyant=4`);
    assert.equal("gtin13" in bottle, false, "no barcode");
    assert.equal("gtin13" in five, false, "13 digits but a wrong check digit");
    assert.equal(twenty.gtin13, "8685317540030");
    // Variant pictures first, then the shared ones.
    assert.deepEqual((five.image as string[])[0], `${ORIGIN}/media/urunler/lavanta/5l-1024.webp`);
    assert.deepEqual((twenty.image as string[])[0], "https://cdn.example/lavanta/20l.webp");
    assert.equal((bottle.image as string[]).includes(`${ORIGIN}/media/urunler/lavanta/5l-1024.webp`), false, "another variant's picture is not this one's");
  });

  test("English page: localized names, sizes and ?varyant= URLs under /en/products", () => {
    const [bottle] = nodes(build({ locale: "en" })!.hasVariant);
    assert.equal(bottle.name, "Lavender — Liquid Hand Soap (Pump Bottle 500 ml)");
    assert.equal(bottle.url, `${ORIGIN}/en/products/lavanta?varyant=4`);
  });

  test("offers: required price/priceCurrency, recommended availability/itemCondition/url/shippingDetails; policy lives on the Organization", () => {
    const [bottle, five, twenty] = nodes(build()!.hasVariant).map((v) => asNode(v.offers));
    for (const offer of [bottle, five, twenty]) {
      assert.equal(offer["@type"], "Offer");
      assert.equal(offer.priceCurrency, "TRY");
      assert.ok(Number(offer.price) > 0);
      assert.match(String(offer.price), /^\d+\.\d{2}$/);
      assert.equal(offer.itemCondition, S("NewCondition"));
      assert.equal("hasMerchantReturnPolicy" in offer, false);
      assert.equal("priceValidUntil" in offer, false, "no campaign → no end date");
      assert.deepEqual(asNode(offer.seller), { "@type": "Organization", "@id": ORG_ID(), name: "PRESTİJ" });
    }
    assert.equal(bottle.price, "149.90");
    assert.equal(bottle.url, `${ORIGIN}/tr/urunler/lavanta?varyant=4`);
    assert.equal(bottle.availability, S("InStock"));
    assert.equal(five.availability, S("OutOfStock"));
    assert.equal(twenty.price, "1499.90");
  });

  test("shippingDetails: one unit at the cart's rates, to TR, handling time from settings (business days)", () => {
    const [bottle, five, twenty] = nodes(build()!.hasVariant).map((v) => asNode(asNode(v.offers).shippingDetails));
    const rate = (d: JsonLdNode) => asNode(d.shippingRate);
    for (const d of [bottle, five, twenty]) {
      assert.equal(d["@type"], "OfferShippingDetails");
      assert.equal(rate(d)["@type"], "MonetaryAmount");
      assert.equal(rate(d).currency, "TRY");
      assert.deepEqual(d.shippingDestination, { "@type": "DefinedRegion", addressCountry: "TR" });
      assert.deepEqual(d.deliveryTime, {
        "@type": "ShippingDeliveryTime",
        handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 3, unitCode: "DAY" },
      });
    }
    assert.equal(rate(bottle).value, "99.90", "flat fee");
    assert.equal(rate(five).value, "99.90", "5.3 kg: no surcharge");
    // 1,499.90 TL is under the 1,500 TL threshold: flat fee + 11 started kg over 10 kg × 15 TL.
    assert.equal(rate(twenty).value, "264.90");
  });

  test("campaign: the discounted price the page shows, priceValidUntil = campaign end, free shipping when the unit reaches the threshold", () => {
    const campaign = { id: 3, percent: 10, label: null };
    const doc = build({ product: product({ campaign }), campaignEndsAt: "2026-11-30T21:00:00.000Z" });
    const [bottle, , twenty] = nodes(doc!.hasVariant).map((v) => asNode(v.offers));
    assert.equal(bottle.price, kurusToDecimal(campaignDisplayPrice({ price: 14990 }, 10).unitPrice));
    assert.equal(bottle.priceValidUntil, "2026-11-30T21:00:00.000Z");
    assert.equal(twenty.price, kurusToDecimal(campaignDisplayPrice({ price: 149990 }, 10).unitPrice));
    // An end date without a running campaign is ignored; a broken one too.
    assert.equal("priceValidUntil" in asNode(nodes(build({ campaignEndsAt: "2026-11-30T21:00:00.000Z" })!.hasVariant)[0].offers), false);
    assert.equal("priceValidUntil" in asNode(nodes(build({ product: product({ campaign }), campaignEndsAt: "nope" })!.hasVariant)[0].offers), false);
    // A 1,800 TL variant at 10 % off (1,620 TL) still ships free; a 1,600 TL one (1,440 TL) no longer does.
    const pricey = product({ campaign, variants: [variant(4, { optionValueIds: [4], price: 180000, weightGrams: 750 }), variant(5, { optionValueIds: [5], price: 160000, weightGrams: 750 })] });
    const [a, b] = nodes(build({ product: pricey })!.hasVariant).map((v) => asNode(asNode(asNode(v.offers).shippingDetails).shippingRate).value);
    assert.equal(a, "0.00");
    assert.equal(b, "99.90");
  });

  test("ratings: aggregateRating on the group and at most five newest reviews (author, date in Istanbul, rating)", () => {
    const doc = build({ reviews: REVIEWS })!;
    assert.deepEqual(doc.aggregateRating, { "@type": "AggregateRating", ratingValue: 4.6, reviewCount: 7, ratingCount: 7, bestRating: 5, worstRating: 1 });
    const reviews = nodes(doc.review);
    assert.equal(reviews.length, MAX_JSONLD_REVIEWS);
    assert.deepEqual(reviews[0], {
      "@type": "Review",
      author: { "@type": "Person", name: "Müşteri 7" },
      datePublished: "2026-11-03", // 21:30 UTC is already the 3rd in Istanbul
      inLanguage: "tr",
      name: "Harika",
      reviewBody: "Çok güzel koku.",
      reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
    });
    assert.equal(reviews[1].inLanguage, "en");
    assert.equal(nodes(doc.hasVariant).some((v) => "review" in v || "aggregateRating" in v), false);
  });

  test("a free (0 kuruş) variant is not an offer; the markup stays inert", () => {
    const withFree = product({ variants: [...product().variants, variant(9, { sku: "PR-LAV-0", price: 0, optionValueIds: [] })] });
    assert.equal(nodes(build({ product: withFree })!.hasVariant).length, 3);
    const text = jsonLd(build({ product: product({ shortDescription: { tr: "x </script><script>alert(1)</script>" } }) }));
    assert.equal(text.includes("</script>"), false);
    assert.equal(text.includes("<"), false);
  });

  test("no handling time when the setting is unusable", () => {
    const d = offerShippingDetails(14990, 750, { ...shipping, estimatedDays: { min: 3, max: 1 } });
    assert.equal("deliveryTime" in d, false);
  });
});

describe("Product (one sellable variant) and edge cases", () => {
  test("the bundle: a Product with one Offer on the clean URL, no size, free flat fee but the heavy surcharge", () => {
    const doc = build({ product: bundle() })!;
    assert.equal(doc["@type"], "Product");
    assert.equal(doc.name, "Dört Koku Koleksiyonu — 4 × 5 L Bidon Seti");
    assert.equal(doc.url, `${ORIGIN}/tr/urunler/dort-koku-koleksiyonu`);
    assert.equal(doc.sku, "PR-SET-4X5L");
    assert.equal("size" in doc, false);
    assert.equal("productGroupID" in doc, false);
    assert.deepEqual(doc.image, [`${ORIGIN}/media/urunler/collection/set-1536.webp`]);
    const offer = asNode(doc.offers);
    assert.equal(offer.url, `${ORIGIN}/tr/urunler/dort-koku-koleksiyonu`);
    assert.equal(offer.price, "1599.90");
    // 1,599.90 TL ≥ 1,500 TL → no flat fee; 21.2 kg → 12 started kg over 10 kg × 15 TL.
    assert.equal(asNode(asNode(offer.shippingDetails).shippingRate).value, "180.00");
  });

  test("a single-variant product with reviews gets them on the Product", () => {
    const doc = build({ product: bundle(), reviews: { ...REVIEWS, productId: 5 } })!;
    assert.equal(asNode(doc.aggregateRating).reviewCount, 7);
    assert.equal(nodes(doc.review).length, 5);
  });

  test("nothing to sell and nothing reviewed → null; samples never get offers", () => {
    assert.equal(build({ product: product({ variants: [] }) }), null);
    assert.equal(build({ product: product({ type: "sample", variants: [variant(14, { price: 0 })] }) }), null);
    const reviewedOnly = build({ product: product({ variants: [] }), reviews: REVIEWS })!;
    assert.equal(reviewedOnly["@type"], "Product");
    assert.equal("offers" in reviewedOnly, false);
    assert.equal(asNode(reviewedOnly.aggregateRating).ratingCount, 7);
  });
});

describe("one-unit shipping = the money engine's shipping for a one-unit cart", () => {
  const campaign = (percent: number): EngineCampaign => ({ id: 1, percent, priority: 0, productIds: null, categoryIds: null, customerGroupIds: null, startsAt: null, endsAt: null });
  const ruleSets: Settings<"shipping">[] = [
    shipping,
    { ...shipping, freeThreshold: 0 },
    { ...shipping, heavy: { enabled: false, thresholdGrams: 10000, feePerKg: 1500 } },
    { ...shipping, flatFee: 0, heavy: { enabled: true, thresholdGrams: 0, feePerKg: 999 } },
    { ...shipping, freeThreshold: 44990 },
  ];

  test("every price × weight × campaign × rule set matches computeCart", () => {
    let checked = 0;
    for (const rules of ruleSets) {
      for (const price of [100, 14990, 44990, 149990, 150000, 159990, 166656]) {
        for (const weight of [null, 0, 750, 5300, 10000, 10001, 21000, 21200]) {
          for (const percent of [0, 10, 25]) {
            const cart = computeCart(
              input([line({ basePrice: price, weightGrams: weight })], {
                settings: engineSettings({ shipping: { flatFee: rules.flatFee, freeThreshold: rules.freeThreshold, heavy: rules.heavy } }),
                campaigns: percent ? [campaign(percent)] : [],
                now: NOW,
              }),
            );
            const unitPrice = campaignDisplayPrice({ price }, percent || null).unitPrice;
            assert.equal(oneUnitShippingFee(unitPrice, weight, rules), cart.shipping.total, `price=${price} weight=${weight} percent=${percent}`);
            checked++;
          }
        }
      }
    }
    assert.equal(checked, 5 * 7 * 8 * 3);
  });
});

describe("CollectionPage", () => {
  test("@id, url, isPartOf the WebSite, ItemList with positions and absolute product URLs", () => {
    const card = (slug: string, name: string, subtitle: string): ProductCardData => ({ ...product(), slug, name: { tr: name }, subtitle: { tr: subtitle } }) as unknown as ProductCardData;
    const page = collectionPageJsonLd({ locale: "tr", name: "Sıvı El Sabunu", description: "x", path: "/tr/kategori/el-sabunu", products: [card("lavanta", "Lavanta", "Sıvı El Sabunu")] });
    assert.equal(page["@id"], `${ORIGIN}/tr/kategori/el-sabunu`);
    assert.deepEqual(page.isPartOf, { "@id": WEBSITE_ID() });
    assert.deepEqual(asNode(page.mainEntity).itemListElement, [{ "@type": "ListItem", position: 1, url: `${ORIGIN}/tr/urunler/lavanta`, name: "Lavanta — Sıvı El Sabunu" }]);
  });
});

describe("BlogPosting — Google: no required properties; author, dates, headline, image recommended", () => {
  const post = (overrides: Partial<PostDetail> = {}): PostDetail => ({
    id: 1,
    slug: "sivi-el-sabunu-nasil-secilir",
    title: { tr: "Sıvı el sabunu nasıl seçilir?", en: "How to choose a liquid hand soap" },
    excerpt: { tr: "Kısa bir rehber." },
    cover: media(30, "/media/yasam/kapak-1200.webp", 1200, 800),
    authorName: "PRESTİJ",
    publishedAt: "2026-10-20T09:00:00.000Z",
    readingMinutes: 6,
    body: { tr: "<p>…</p>" },
    tags: ["sıvı sabun", "temizlik"],
    relatedProductIds: [2],
    seo: null,
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  });

  test("the shop's byline → author and publisher are the Organization (by @id, with name and url)", () => {
    const doc = blogPostingJsonLd({ post: post(), locale: "tr", general, logo: LOGO });
    assert.equal(doc["@type"], "BlogPosting");
    assert.equal(doc.headline, "Sıvı el sabunu nasıl seçilir?");
    assert.equal(doc.description, "Kısa bir rehber.");
    assert.deepEqual(doc.image, [`${ORIGIN}/media/yasam/kapak-1200.webp`]);
    assert.equal(doc.datePublished, "2026-10-20T09:00:00.000Z");
    assert.equal(doc.dateModified, "2026-11-01T09:00:00.000Z");
    assert.equal(doc.inLanguage, "tr-TR");
    const org = { "@type": "Organization", "@id": ORG_ID(), name: "PRESTİJ", url: `${ORIGIN}/tr` };
    assert.deepEqual(doc.author, org);
    assert.deepEqual(doc.publisher, { ...org, logo: { "@type": "ImageObject", url: `${ORIGIN}/media/marka/prestij-logo-652.webp` } });
    assert.deepEqual(doc.mainEntityOfPage, { "@type": "WebPage", "@id": `${ORIGIN}/tr/blog/sivi-el-sabunu-nasil-secilir` });
    assert.equal(doc.url, `${ORIGIN}/tr/blog/sivi-el-sabunu-nasil-secilir`);
    assert.equal(doc.keywords, "sıvı sabun, temizlik");
    assert.equal(doc.timeRequired, "PT6M");
    // ISO 8601 with a time zone.
    for (const key of ["datePublished", "dateModified"]) assert.match(String(doc[key]), /T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  });

  test("a person's byline → Person author (name only); no byline → the Organization; no cover/logo → left out", () => {
    const person = blogPostingJsonLd({ post: post({ authorName: "Ayşe Yılmaz" }), locale: "en", general, logo: null });
    assert.deepEqual(person.author, { "@type": "Person", name: "Ayşe Yılmaz" });
    assert.equal(person.headline, "How to choose a liquid hand soap");
    assert.equal("logo" in asNode(person.publisher), false);
    const anonymous = blogPostingJsonLd({ post: post({ authorName: null, cover: null, tags: [], readingMinutes: null }), locale: "tr", general, logo: LOGO });
    assert.equal(asNode(anonymous.author)["@id"], ORG_ID());
    for (const key of ["image", "keywords", "timeRequired"]) assert.equal(key in anonymous, false, key);
    // The tags are Turkish (not localized): keywords only on the Turkish page (day 5 FIX).
    assert.equal("keywords" in person, false, "no Turkish keywords on the English page");
    assert.equal("keywords" in blogPostingJsonLd({ post: post(), locale: "ar", general, logo: null }), false);
    assert.deepEqual(postKeywords(post(), "tr"), ["sıvı sabun", "temizlik"]);
    assert.deepEqual(postKeywords(post(), "en"), []);
    // Byline spelled differently (case, legal name) is still the shop.
    assert.equal(asNode(blogPostingJsonLd({ post: post({ authorName: "prestij" }), locale: "tr", general, logo: null }).author)["@type"], "Organization");
  });
});
