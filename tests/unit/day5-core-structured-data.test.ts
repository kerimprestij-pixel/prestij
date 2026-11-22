// Day 5 CORE: src/lib/seo/structured-data.ts. The @id helpers and the Organization / WebSite /
// CollectionPage / FAQPage builders. (The pre-day-5 byte-for-byte checks of the product and blog markup
// were retired when SEO-TECH completed those builders; see day5-seotech-structured-data.test.ts.)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { jsonLd } from "@/components/store/format";
import type { Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import type { ProductCardData, ProductDetail } from "@/lib/data/catalog";
import type { MediaLike } from "@/lib/media/types";
import type { ProductReviewsData } from "@/lib/reviews/types";
import {
  absoluteLink,
  collectionPageJsonLd,
  faqPageJsonLd,
  jsonLdLanguage,
  ORG_ID,
  organizationJsonLd,
  productGroupJsonLd,
  SCHEMA_CONTEXT,
  WEBSITE_ID,
  webSiteJsonLd,
} from "@/lib/seo/structured-data";
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
const LOGO = media(1, "/media/marka/prestij-logo-652.webp");

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 1,
    slug: "lavanta",
    type: "standard",
    name: { tr: "Lavanta", en: "Lavender", ar: "اللافندر" },
    subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap" },
    shortDescription: { tr: "Klasik bir zarafet </script><script>alert(1)</script>" },
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
    ratingAverage: 0,
    ratingCount: 0,
    categoryId: 1,
    category: { id: 1, slug: "el-sabunu", name: { tr: "El Sabunu", en: "Hand Soap" } },
    options: [],
    variants: [
      { id: 11, sku: "LAV-500", barcode: "8680000000011", price: 14990, compareAtPrice: null, vatRate: 20, stock: 10, trackStock: true, allowBackorder: false, lowStockThreshold: 5, volumeMl: 500, weightGrams: 750, minQuantity: 1, maxQuantity: null, imageId: null, isDefault: true, optionValueIds: [] },
      { id: 12, sku: "LAV-5L", barcode: "123", price: 89990, compareAtPrice: null, vatRate: 20, stock: 0, trackStock: true, allowBackorder: false, lowStockThreshold: 5, volumeMl: 5000, weightGrams: 5400, minQuantity: 1, maxQuantity: null, imageId: null, isDefault: false, optionValueIds: [] },
    ],
    defaultVariantId: 11,
    media: [
      { media: media(5, "/media/urunler/lavanta/a-1200.webp"), variantId: null, role: "packshot" },
      { media: media(6, "https://cdn.example/b.webp"), variantId: 12, role: "gallery" },
    ],
    tiers: [],
    bundleItems: [],
    related: [],
    sampleProductSlug: null,
    campaign: { id: 3, percent: 10, label: null },
    ...overrides,
  };
}

const REVIEWS: ProductReviewsData = {
  productId: 1,
  summary: { count: 2, average: 450, distribution: [0, 0, 0, 1, 1] },
  reviews: [
    { id: 1, rating: 5, title: "Harika", body: "Çok güzel koku.", authorName: "Ayşe", locale: "tr", verified: true, createdAt: "2026-11-01T10:00:00.000Z", reply: null },
    { id: 2, rating: 4, title: null, body: null, authorName: "John", locale: "en", verified: false, createdAt: "2026-11-02T21:30:00.000Z", reply: null },
  ],
  hasMore: false,
};

describe("ids and helpers", () => {
  test("ORG_ID / WEBSITE_ID: origin + fragment, trailing slash ignored", () => {
    assert.equal(ORG_ID(), `${ORIGIN}/#organization`);
    assert.equal(WEBSITE_ID(), `${ORIGIN}/#website`);
    assert.equal(ORG_ID("http://check.localhost:3590/"), "http://check.localhost:3590/#organization");
  });

  test("jsonLdLanguage and absoluteLink", () => {
    assert.deepEqual((["tr", "en", "ar"] as Locale[]).map(jsonLdLanguage), ["tr-TR", "en-US", "ar"]);
    assert.equal(absoluteLink("/media/x.webp"), `${ORIGIN}/media/x.webp`);
    assert.equal(absoluteLink("https://cdn.example/x.webp"), "https://cdn.example/x.webp");
  });
});

describe("site builders (minimal bodies)", () => {
  test("Organization: @id, names, home URL and logo", () => {
    const org = organizationJsonLd({ locale: "tr", general, seo, logo: LOGO });
    assert.equal(org["@context"], SCHEMA_CONTEXT);
    assert.equal(org["@type"], "OnlineStore"); // day 5 SEO-TECH: the subtype Google recommends for online stores
    assert.equal(org["@id"], ORG_ID());
    assert.equal(org.name, "PRESTİJ");
    assert.equal(org.legalName, general.legalName);
    assert.equal(org.url, `${ORIGIN}/tr`);
    assert.equal(org.logo, `${ORIGIN}/media/marka/prestij-logo-652.webp`);
    assert.equal("logo" in organizationJsonLd({ locale: "tr", general, seo, logo: null }), false);
  });

  test("WebSite: the domain root as url, every language, localized description, publisher by @id, no SearchAction", () => {
    const site = webSiteJsonLd({ locale: "en", general, seo: { ...seo, description: { tr: "TR açıklama", en: "EN description" } } });
    assert.equal(site["@id"], WEBSITE_ID());
    assert.equal(site.url, `${ORIGIN}/`); // day 5 FIX: Google site names need the domain home page, not /en
    assert.deepEqual(site.inLanguage, ["tr-TR", "en-US", "ar"]);
    assert.equal(site.description, "EN description");
    assert.deepEqual(site.publisher, { "@id": ORG_ID() });
    assert.equal("potentialAction" in site, false);
  });
});

describe("collectionPageJsonLd", () => {
  const card = (id: number, slug: string, name: string, subtitle: string | null): ProductCardData =>
    ({ ...product(), id, slug, name: { tr: name }, subtitle: subtitle ? { tr: subtitle } : null }) as unknown as ProductCardData;

  test("ItemList in grid order with absolute product URLs", () => {
    const page = collectionPageJsonLd({
      locale: "tr",
      name: "El Sabunu",
      description: "  Sıvı el sabunları  ",
      path: href("tr", "category", { slug: "el-sabunu" }),
      products: [card(1, "lavanta", "Lavanta", "Sıvı El Sabunu"), card(2, "portakal", "Portakal", null)],
    });
    assert.equal(page["@type"], "CollectionPage");
    assert.equal(page.url, `${ORIGIN}/tr/kategori/el-sabunu`);
    assert.equal(page.description, "Sıvı el sabunları");
    assert.deepEqual(page.mainEntity, {
      "@type": "ItemList",
      numberOfItems: 2,
      itemListElement: [
        { "@type": "ListItem", position: 1, url: `${ORIGIN}/tr/urunler/lavanta`, name: "Lavanta — Sıvı El Sabunu" },
        { "@type": "ListItem", position: 2, url: `${ORIGIN}/tr/urunler/portakal`, name: "Portakal" },
      ],
    });
    const empty = collectionPageJsonLd({ locale: "ar", name: "x", description: "", path: href("ar", "products"), products: [] });
    assert.equal("description" in empty, false);
    assert.equal(empty.url, `${ORIGIN}/ar/products`);
  });
});

describe("faqPageJsonLd", () => {
  test("drops empty items, null when nothing is left", () => {
    assert.equal(faqPageJsonLd([]), null);
    assert.equal(faqPageJsonLd([{ question: " ", answer: "x" }]), null);
    assert.deepEqual(faqPageJsonLd([{ question: "Soru?", answer: "Cevap." }, { question: "Boş", answer: "" }]), {
      "@context": SCHEMA_CONTEXT,
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Soru?", acceptedAnswer: { "@type": "Answer", text: "Cevap." } }],
    });
  });
});

describe("product and blog markup (completed by SEO-TECH on day 5)", () => {
  // The byte-for-byte comparisons with the pre-day-5 markup were retired when SEO-TECH replaced it
  // (ProductGroup/Product, Organization author); tests/unit/day5-seotech-structured-data.test.ts covers it.
  test("jsonLd() keeps the product markup inert: no </script> survives", () => {
    const doc = productGroupJsonLd({ product: product(), locale: "tr", reviews: REVIEWS, general, shipping, seo });
    assert.ok(doc);
    assert.equal(jsonLd(doc).includes("</script>"), false);
  });
});
