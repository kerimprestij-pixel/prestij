// Day 5 CORE: variant links (src/lib/seo/variant-url.ts) and the merchant feed URL (src/lib/seo/feed-url.ts).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MERCHANT_FEED_PATH, merchantFeedUrl } from "@/lib/seo/feed-url";
import { parseVariantParam, VARIANT_QUERY_PARAM, variantPath, variantUrl } from "@/lib/seo/variant-url";

const ORIGIN = "https://prestij.example";
let savedOrigin: string | undefined;

before(() => {
  savedOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = `${ORIGIN}/`;
});

after(() => {
  if (savedOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedOrigin;
});

describe("variantPath / variantUrl", () => {
  test("the localized product path plus ?varyant=<id> in every locale", () => {
    assert.equal(VARIANT_QUERY_PARAM, "varyant");
    assert.equal(variantPath("tr", "lavanta", 12), "/tr/urunler/lavanta?varyant=12");
    assert.equal(variantPath("en", "lavanta", 12), "/en/products/lavanta?varyant=12");
    assert.equal(variantPath("ar", "okyanus", 7), "/ar/products/okyanus?varyant=7");
  });

  test("an id that is not a positive integer gives the clean product path", () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(variantPath("tr", "lavanta", id), "/tr/urunler/lavanta", String(id));
    }
  });

  test("the slug is URL-encoded like every other product link", () => {
    assert.equal(variantPath("tr", "a b", 3), "/tr/urunler/a%20b?varyant=3");
  });

  test("variantUrl is absolute (site origin, trailing slash ignored)", () => {
    assert.equal(variantUrl("en", "portakal", 41), `${ORIGIN}/en/products/portakal?varyant=41`);
  });
});

describe("parseVariantParam", () => {
  test("plain positive integers", () => {
    assert.equal(parseVariantParam("12"), 12);
    assert.equal(parseVariantParam("1"), 1);
    assert.equal(parseVariantParam(["34", "56"]), 34);
  });

  test("anything else is null", () => {
    for (const value of [null, undefined, "", "0", "-3", " 12", "12 ", "12abc", "1e3", "0x1f", "1.5", "012", "١٢", "9".repeat(16), [], [""]]) {
      assert.equal(parseVariantParam(value as string | string[] | null | undefined), null, JSON.stringify(value));
    }
  });

  test("round-trips with variantPath", () => {
    const url = new URL(variantUrl("tr", "lavanta-latte", 205));
    assert.equal(parseVariantParam(url.searchParams.get(VARIANT_QUERY_PARAM)), 205);
  });
});

describe("merchant feed URL", () => {
  test("fixed, non-localized path; absolute URL from the site origin", () => {
    assert.equal(MERCHANT_FEED_PATH, "/feeds/google-merchant.xml");
    assert.equal(merchantFeedUrl(), `${ORIGIN}/feeds/google-merchant.xml`);
    assert.equal(merchantFeedUrl("http://check.localhost:3590/"), "http://check.localhost:3590/feeds/google-merchant.xml");
  });
});
