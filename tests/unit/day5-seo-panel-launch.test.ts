// Day 5 SEO-PANEL: search engine tools (src/lib/panel/seo/launch.ts) and the SEO settings panel schema:
// tool URLs, local-origin detection, the IndexNow key state (never the value), verification-code
// clean-up (pasted meta tag / DNS TXT), the "Yayına çıkınca" checklist, and the seo save schema.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractVerificationCode,
  indexNowKeyState,
  isLocalOrigin,
  launchChecklist,
  normalizeVerificationCodes,
  seoToolUrls,
} from "@/lib/panel/seo/launch";
import { seoSettingsInput, settingsPayloadSchema } from "@/lib/panel/settings/schemas";
import { GOOGLE_PRODUCT_CATEGORIES, settingsSchemas } from "@/lib/settings/types";

const GOOGLE_CODE = "AbCdEf0123456789_-AbCdEf0123456789xyzXYZ123";

describe("tool URLs", () => {
  test("absolute URLs of sitemap, robots.txt, merchant feed and IndexNow key file (trailing slash ignored)", () => {
    assert.deepEqual(seoToolUrls("https://prestij.com.tr/"), {
      site: "https://prestij.com.tr/",
      storefront: "https://prestij.com.tr/tr",
      sitemap: "https://prestij.com.tr/sitemap.xml",
      robots: "https://prestij.com.tr/robots.txt",
      merchantFeed: "https://prestij.com.tr/feeds/google-merchant.xml",
      indexNowKey: "https://prestij.com.tr/indexnow-key.txt",
    });
  });

  test("local origins are recognised (the site is not reachable by search engines yet)", () => {
    for (const origin of ["http://localhost:3000", "http://check.localhost:3540", "http://127.0.0.1:3000", "http://[::1]:3000", "http://prestij.test", "nonsense"]) {
      assert.equal(isLocalOrigin(origin), true, origin);
    }
    assert.equal(isLocalOrigin("https://prestij.com.tr"), false);
    assert.equal(isLocalOrigin("https://staging.prestij.com.tr"), false);
  });
});

describe("IndexNow key state", () => {
  test("8–128 letters, digits and hyphens; whitespace around ignored; the value never comes back", () => {
    assert.equal(indexNowKeyState(undefined), "missing");
    assert.equal(indexNowKeyState(""), "missing");
    assert.equal(indexNowKeyState("   "), "missing");
    assert.equal(indexNowKeyState("abcd1234"), "set");
    assert.equal(indexNowKeyState(`  ${"a".repeat(128)}  `), "set");
    assert.equal(indexNowKeyState("abc-123"), "invalid", "7 characters");
    assert.equal(indexNowKeyState("a".repeat(129)), "invalid");
    assert.equal(indexNowKeyState("abcd_1234"), "invalid", "underscore");
    assert.equal(indexNowKeyState("abcd 1234"), "invalid", "inner space");
  });
});

describe("verification codes", () => {
  test("a pasted meta tag, a DNS TXT value or the bare code all become the code", () => {
    assert.equal(extractVerificationCode(`<meta name="google-site-verification" content="${GOOGLE_CODE}" />`), GOOGLE_CODE);
    assert.equal(extractVerificationCode(`<meta name='msvalidate.01' content='0123456789ABCDEF0123456789ABCDEF'>`), "0123456789ABCDEF0123456789ABCDEF");
    assert.equal(extractVerificationCode(`<meta content="abc123" name="yandex-verification">`), "abc123");
    assert.equal(extractVerificationCode(`google-site-verification=${GOOGLE_CODE}`), GOOGLE_CODE);
    assert.equal(extractVerificationCode("yandex-verification: 1a2b3c4d5e6f7a8b"), "1a2b3c4d5e6f7a8b");
    assert.equal(extractVerificationCode(`  ${GOOGLE_CODE}  `), GOOGLE_CODE);
    assert.equal(extractVerificationCode(""), "");
    assert.equal(extractVerificationCode(42), "");
    assert.equal(extractVerificationCode("<script>x</script>"), "<script>x</script>", "anything else is left for the schema to refuse");
  });

  test("normalizeVerificationCodes cleans the three engines and passes other shapes through", () => {
    assert.deepEqual(normalizeVerificationCodes({ google: `content="${GOOGLE_CODE}"`, bing: " x ", yandex: 1 }), { google: GOOGLE_CODE, bing: "x", yandex: 1 });
    assert.equal(normalizeVerificationCodes(null), null);
    assert.deepEqual(normalizeVerificationCodes(["a"]), ["a"]);
  });
});

describe("SEO settings panel schema", () => {
  const base = {
    titleTemplate: "%s | PRESTİJ",
    defaultTitle: { tr: "PRESTİJ — Sıvı El Sabunu ve Duş Jeli" },
    description: { tr: "Açıklama" },
    ogImageId: null,
  };

  test("a pasted meta tag is stored as the code; the output is a valid storefront seo value", () => {
    const parsed = seoSettingsInput.parse({
      ...base,
      verification: { google: `<meta name="google-site-verification" content="${GOOGLE_CODE}" />`, bing: "", yandex: "yandex-verification: 1a2b3c4d" },
      returns: { days: 30, freeReturns: true },
      merchantCategory: " 3208 ",
    });
    assert.deepEqual(parsed.verification, { google: GOOGLE_CODE, bing: "", yandex: "1a2b3c4d" });
    assert.deepEqual(parsed.returns, { days: 30, freeReturns: true });
    assert.equal(parsed.merchantCategory, "3208");
    assert.ok(settingsSchemas.seo.safeParse(parsed).success);
  });

  test("missing day-5 fields keep their defaults (a pre-day-5 payload)", () => {
    const parsed = seoSettingsInput.parse(base);
    assert.deepEqual(parsed.verification, { google: "", bing: "", yandex: "" });
    assert.deepEqual(parsed.returns, { days: 14, freeReturns: null });
    assert.equal(parsed.merchantCategory, GOOGLE_PRODUCT_CATEGORIES.liquidHandSoap);
  });

  test("errors land on the field paths the form shows (verification.google, returns.days, merchantCategory)", async () => {
    const schema = settingsPayloadSchema("seo");
    const result = await schema.safeParseAsync({
      ...base,
      updatedAt: null,
      verification: { google: "<b>kod</b>", bing: "", yandex: "" },
      returns: { days: 400, freeReturns: null },
      merchantCategory: "<script>",
    });
    assert.equal(result.success, false);
    const paths = new Set(result.error!.issues.map((i) => i.path.join(".")));
    assert.ok(paths.has("verification.google"), [...paths].join(","));
    assert.ok(paths.has("returns.days"), [...paths].join(","));
    assert.ok(paths.has("merchantCategory"), [...paths].join(","));
    const messages = result.error!.issues.map((i) => i.message).join(" ");
    assert.match(messages, /Yalnızca kodu yapıştırın/);
    assert.match(messages, /365/);
  });

  test("returns.freeReturns accepts true / false / null and nothing else", () => {
    for (const freeReturns of [true, false, null]) {
      assert.ok(seoSettingsInput.safeParse({ ...base, returns: { days: 14, freeReturns } }).success, String(freeReturns));
    }
    assert.equal(seoSettingsInput.safeParse({ ...base, returns: { days: 14, freeReturns: "yes" } }).success, false);
    assert.equal(seoSettingsInput.safeParse({ ...base, returns: { days: 14.5, freeReturns: null } }).success, false);
  });
});

describe("launch checklist", () => {
  const input = {
    origin: "https://prestij.com.tr",
    verification: { google: GOOGLE_CODE, bing: "", yandex: "" },
    socialLinks: 0,
    indexNow: "missing" as const,
    address: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E, Kocasinan / Kayseri",
  };

  test("covers every off-site step of the contract in order, with the exact URLs to paste", () => {
    const steps = launchChecklist(input);
    assert.deepEqual(
      steps.map((s) => s.key),
      // Grouped (FIX B-F9): before go-live (media storage, the go-live CF-9/CF-10 steps, the SR-6 sales steps; havale
      // only while it is on), before the wheel (the two day-6 wheel steps), then the search-engine steps after go-live.
      ["media-storage", "seller-identity", "checkout-contracts", "email-sending", "site-url", "cron-secret", "admin-recipients", "real-prices", "shipping-settings", "gift-wheel-slices", "wheel-terms-review", "google-search-console", "bing-webmaster", "yandex-webmaster", "google-business-profile", "google-merchant-center", "social-profiles", "indexnow", "links"],
    );
    assert.deepEqual(
      [...new Set(steps.map((s) => s.group))],
      ["before", "wheel", "after"],
      "the groups follow each other in display order",
    );
    const copy = (key: string) => steps.find((s) => s.key === key)!.links.filter((l) => l.copy).map((l) => l.url);
    // The Search Console property is the domain root (a /tr URL-prefix property would leave out /en, /ar,
    // the sitemap and the feed); visitor-facing links use the Turkish home page.
    assert.deepEqual(copy("google-search-console"), ["https://prestij.com.tr/", "https://prestij.com.tr/sitemap.xml"]);
    assert.deepEqual(copy("google-business-profile"), ["https://prestij.com.tr/tr"]);
    assert.deepEqual(copy("links"), ["https://prestij.com.tr/tr"]);
    assert.match(steps.find((s) => s.key === "google-search-console")!.steps[0], /\/tr olmadan/);
    assert.deepEqual(copy("google-merchant-center"), ["https://prestij.com.tr/feeds/google-merchant.xml"]);
    assert.deepEqual(copy("indexnow"), ["https://prestij.com.tr/indexnow-key.txt"]);
    assert.match(steps.find((s) => s.key === "google-business-profile")!.steps[0], /Kocasinan \/ Kayseri/);
    for (const step of steps) {
      for (const link of step.links) assert.match(link.url, /^https:\/\//, `${step.key}: ${link.url}`);
    }
  });

  test("done flags come from settings where the panel can tell, null elsewhere", () => {
    const done = (steps: ReturnType<typeof launchChecklist>) => Object.fromEntries(steps.map((s) => [s.key, s.done]));
    assert.deepEqual(done(launchChecklist(input)), {
      // Day 6 steps: no badge while their inputs are not passed (tests/unit/day6-content-launch.test.ts).
      "media-storage": null,
      "gift-wheel-slices": null,
      "wheel-terms-review": null,
      // Go-live steps: no badge without their inputs; the https site address is known from the origin.
      "seller-identity": null,
      "checkout-contracts": null,
      "email-sending": null,
      "site-url": true,
      "cron-secret": null,
      "admin-recipients": null,
      // SR-6 sales steps: no badge without their inputs.
      "real-prices": null,
      "shipping-settings": null,
      "google-search-console": true,
      "bing-webmaster": null,
      "yandex-webmaster": false,
      "google-business-profile": null,
      "google-merchant-center": null,
      "social-profiles": false,
      indexnow: false,
      links: null,
    });
    const later = done(launchChecklist({ ...input, verification: { google: "", bing: "x", yandex: "y" }, socialLinks: 2, indexNow: "set" }));
    assert.equal(later["google-search-console"], false);
    assert.equal(later["bing-webmaster"], true);
    assert.equal(later["yandex-webmaster"], true);
    assert.equal(later["social-profiles"], true);
    assert.equal(later.indexnow, true);
  });

  test("the copy never promises a ranking", () => {
    const text = JSON.stringify(launchChecklist(input)).toLocaleLowerCase("tr-TR");
    assert.ok(!/garanti|1\. sıra|ilk sıra|birinci/.test(text), "no promise in the checklist copy");
  });
});
