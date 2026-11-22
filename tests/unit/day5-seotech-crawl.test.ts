// Day 5 SEO-TECH: crawling and indexing. The sitemap list (buildSitemap: hreflang, images, blog),
// robots.txt, the verification meta tags, and IndexNow (key, local-origin guard, change detection,
// batching, the job's skip reasons) with an injected fetch: nothing here touches the network.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import robots from "@/app/robots";
import {
  changedUrls,
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS_PER_REQUEST,
  indexNowKeyUrl,
  indexNowPayload,
  indexNowSkipReason,
  isLocalOrigin,
  lastCheckedAt,
  readIndexNowKey,
  runIndexNow,
  submitIndexNow,
  type FetchLike,
  type IndexNowDeps,
} from "@/lib/seo/indexnow";
import { postLastModified } from "@/lib/panel/blog/reading";
import { buildSitemap, sitemapImageUrl, SITEMAP_PRODUCT_IMAGES, type SitemapData } from "@/lib/seo/sitemap-entries";
import { verificationMetadata } from "@/lib/seo/verification-metadata";

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

const DATA: SitemapData = {
  products: [
    {
      slug: "lavanta",
      updatedAt: "2026-11-05T10:00:00.000Z",
      images: ["/media/urunler/lavanta/a-1024.webp", "/media/urunler/lavanta/b-1024.webp", "/media/x/c.webp", "/media/x/d.webp", "/media/x/e.webp", "/media/x/f.webp"],
    },
    { slug: "dort-koku-koleksiyonu", updatedAt: "2026-11-04T10:00:00.000Z" },
  ],
  categories: [{ slug: "el-sabunu", updatedAt: "2026-11-06T10:00:00.000Z" }],
  pages: [{ slug: "hakkimizda", updatedAt: "2026-11-01T10:00:00.000Z" }],
  reservedPages: [{ slug: "kurumsal", updatedAt: "2026-11-02T10:00:00.000Z" }],
  posts: [{ slug: "sivi-el-sabunu-nasil-secilir", updatedAt: "2026-11-07T10:00:00.000Z", images: ["https://cdn.example/kapak a&b.webp"] }],
};

describe("sitemap (buildSitemap)", () => {
  test("every indexable URL in each enabled locale, hreflang + x-default, priorities, lastModified", () => {
    const map = buildSitemap(DATA, ["tr", "en", "ar"]);
    const urls = map.map((e) => e.url);
    // home, products, 1 category, 2 products, 1 page, kurumsal, blog index, 1 post = 9 targets × 3 locales.
    assert.equal(map.length, 27);
    for (const expected of [
      `${ORIGIN}/tr`,
      `${ORIGIN}/en/products`,
      `${ORIGIN}/ar/category/el-sabunu`,
      `${ORIGIN}/tr/urunler/lavanta`,
      `${ORIGIN}/en/page/hakkimizda`,
      `${ORIGIN}/tr/kurumsal`,
      `${ORIGIN}/en/business`,
      `${ORIGIN}/ar/blog`,
      `${ORIGIN}/tr/blog/sivi-el-sabunu-nasil-secilir`,
    ]) {
      assert.ok(urls.includes(expected), expected);
    }
    assert.equal(new Set(urls).size, urls.length, "no duplicates");
    const product = map.find((e) => e.url === `${ORIGIN}/en/products/lavanta`)!;
    assert.deepEqual(product.alternates?.languages, {
      tr: `${ORIGIN}/tr/urunler/lavanta`,
      en: `${ORIGIN}/en/products/lavanta`,
      ar: `${ORIGIN}/ar/products/lavanta`,
      "x-default": `${ORIGIN}/tr/urunler/lavanta`,
    });
    assert.equal(product.lastModified, "2026-11-05T10:00:00.000Z");
    assert.equal(map.find((e) => e.url === `${ORIGIN}/tr`)!.lastModified, "2026-11-06T10:00:00.000Z", "home: newest product/category change");
    assert.equal(map.find((e) => e.url === `${ORIGIN}/tr/blog`)!.lastModified, "2026-11-07T10:00:00.000Z", "blog index: newest post");
  });

  test("images: up to five absolute product images; the blog cover, percent-encoded and XML-escaped", () => {
    const map = buildSitemap(DATA, ["tr", "en", "ar"]);
    const lavanta = map.find((e) => e.url === `${ORIGIN}/tr/urunler/lavanta`)!;
    assert.equal(lavanta.images?.length, SITEMAP_PRODUCT_IMAGES);
    assert.equal(lavanta.images?.[0], `${ORIGIN}/media/urunler/lavanta/a-1024.webp`);
    assert.ok(lavanta.images?.every((u) => u.startsWith(`${ORIGIN}/`)));
    assert.equal(map.find((e) => e.url === `${ORIGIN}/tr/urunler/dort-koku-koleksiyonu`)!.images, undefined);
    const post = map.find((e) => e.url === `${ORIGIN}/ar/blog/sivi-el-sabunu-nasil-secilir`)!;
    assert.deepEqual(post.images, ["https://cdn.example/kapak%20a&amp;b.webp"]);
    assert.equal(map.find((e) => e.url === `${ORIGIN}/tr`)!.images, undefined);
  });

  test("no posts → no blog index; a disabled locale is left out and x-default follows the first enabled one", () => {
    const noBlog = buildSitemap({ ...DATA, posts: [] }, ["tr", "en", "ar"]);
    assert.equal(noBlog.some((e) => e.url.endsWith("/blog")), false);
    const enOnly = buildSitemap(DATA, ["en"]);
    assert.ok(enOnly.every((e) => e.url.startsWith(`${ORIGIN}/en`)));
    assert.equal(enOnly[0].alternates?.languages?.["x-default"], `${ORIGIN}/en`);
    const trEn = buildSitemap(DATA, ["tr", "en"]);
    assert.equal(trEn.some((e) => e.url.startsWith(`${ORIGIN}/ar`)), false);
    assert.equal(trEn[0].alternates?.languages?.["x-default"], `${ORIGIN}/tr`);
  });

  test("home and /urunler lastmod include their own page rows; a noindex urunler row leaves /urunler out (day 5 FIX)", () => {
    const at = (map: ReturnType<typeof buildSitemap>, url: string) => map.find((e) => e.url === url)?.lastModified;
    // Copy edits (hero, FAQ, guide) newer than the catalog move the lastmod.
    const edited = buildSitemap({ ...DATA, homeUpdatedAt: "2026-11-09T08:00:00.000Z", productsPage: { updatedAt: "2026-11-08T08:00:00.000Z", noIndex: false } }, ["tr", "en", "ar"]);
    assert.equal(at(edited, `${ORIGIN}/tr`), "2026-11-09T08:00:00.000Z");
    assert.equal(at(edited, `${ORIGIN}/ar/products`), "2026-11-08T08:00:00.000Z");
    // Older page rows: the newest catalog change still wins.
    const older = buildSitemap({ ...DATA, homeUpdatedAt: "2026-10-01T08:00:00.000Z", productsPage: { updatedAt: "2026-10-01T08:00:00.000Z", noIndex: false } }, ["tr"]);
    assert.equal(at(older, `${ORIGIN}/tr`), "2026-11-06T10:00:00.000Z");
    assert.equal(at(older, `${ORIGIN}/tr/urunler`), "2026-11-06T10:00:00.000Z");
    const hidden = buildSitemap({ ...DATA, productsPage: { updatedAt: "2026-11-08T08:00:00.000Z", noIndex: true } }, ["tr", "en", "ar"]);
    assert.equal(hidden.some((e) => /\/(urunler|products)$/.test(e.url)), false);
    assert.equal(hidden.length, 24);
  });

  test("a scheduled post: lastmod is its publish date, so the first IndexNow run after it goes live submits it (day 5 FIX)", async () => {
    // Saved on Nov 1 to go live on Nov 15 at 06:00; the daily runs up to Nov 15 03:30 moved checkedAt past Nov 1.
    const saved = new Date("2026-11-01T09:00:00.000Z");
    const live = new Date("2026-11-15T06:00:00.000Z");
    assert.equal(postLastModified({ updatedAt: saved, publishedAt: live }), live);
    assert.equal(postLastModified({ updatedAt: live, publishedAt: saved }), live, "edited after publishing: updatedAt");
    assert.equal(postLastModified({ updatedAt: saved, publishedAt: null }), saved);
    const data: SitemapData = { ...DATA, posts: [{ slug: "yeni-yazi", updatedAt: postLastModified({ updatedAt: saved, publishedAt: live }).toISOString() }] };
    const posted: string[][] = [];
    const result = await runIndexNow({
      env: { NODE_ENV: "production", INDEXNOW_KEY: "a1b2c3d4e5f60718" },
      origin: ORIGIN,
      fetch: async (_url, init) => {
        posted.push(JSON.parse(init.body).urlList);
        return { status: 200 };
      },
      loadEntries: async () => buildSitemap(data, ["tr"]),
      loadLastRun: async () => ({ status: "ok", result: { submitted: 0, requests: 0, checkedAt: Math.floor(Date.parse("2026-11-15T03:30:00.000Z") / 1000) } }),
      now: () => Date.parse("2026-11-16T03:30:00.000Z"),
    });
    assert.equal(result.submitted, 2);
    assert.deepEqual(posted, [[`${ORIGIN}/tr/blog`, `${ORIGIN}/tr/blog/yeni-yazi`]], "the post and the blog index, nothing else");
  });

  test("sitemapImageUrl: absolute, encoded, escaped; non-http is dropped", () => {
    assert.equal(sitemapImageUrl("/media/a b/ş.webp"), `${ORIGIN}/media/a%20b/%C5%9F.webp`);
    assert.equal(sitemapImageUrl("https://cdn.example/x.webp?a=1&b=2"), "https://cdn.example/x.webp?a=1&amp;b=2");
    assert.equal(sitemapImageUrl("javascript:alert(1)"), `${ORIGIN}/javascript:alert(1)`, "a bare value is a site path, never a script URL");
    assert.equal(sitemapImageUrl("ftp://example.com/x.webp"), `${ORIGIN}/ftp://example.com/x.webp`);
    assert.equal(sitemapImageUrl(""), null);
  });
});

describe("robots.txt", () => {
  test("disallows panel, API, cart, checkout, account and order pages in every language; points to the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = [rule.disallow].flat();
    for (const path of ["/panel", "/api", "/tr/sepet", "/en/cart", "/ar/checkout", "/tr/odeme", "/tr/hesap", "/en/account", "/tr/siparis", "/en/order", "/ar/order"]) {
      assert.ok(disallow.includes(path), path);
    }
    // Pages that must stay crawlable so their noindex is seen, and every catalog page.
    for (const path of ["/tr/bulten", "/en/newsletter", "/tr/urunler", "/tr/kategori", "/tr/blog", "/tr/sayfa"]) assert.equal(disallow.includes(path), false, path);
    assert.equal(rule.allow, "/");
    assert.equal(r.sitemap, `${ORIGIN}/sitemap.xml`);
  });
});

describe("verification meta tags", () => {
  test("google → verification.google, yandex → verification.yandex, bing → other['msvalidate.01']", () => {
    assert.deepEqual(verificationMetadata({ google: "abc_DEF-123", bing: "0123456789ABCDEF", yandex: "y4nd3x" }), {
      google: "abc_DEF-123",
      yandex: "y4nd3x",
      other: { "msvalidate.01": "0123456789ABCDEF" },
    });
    assert.deepEqual(verificationMetadata({ google: "", bing: "B1", yandex: "" }), { other: { "msvalidate.01": "B1" } });
  });

  test("no codes → no tags; a code that breaks the settings rule is ignored (never a broken tag)", () => {
    assert.equal(verificationMetadata({ google: "", bing: "", yandex: "" }), undefined);
    assert.deepEqual(verificationMetadata({ google: '"><script>', bing: "  ok-code  ", yandex: "x".repeat(101) }), { other: { "msvalidate.01": "ok-code" } });
  });
});

describe("IndexNow (pure parts)", () => {
  test("key: 8–128 of [A-Za-z0-9-], trimmed; anything else is no key", () => {
    assert.equal(readIndexNowKey({ INDEXNOW_KEY: "  a1b2c3d4e5f6-XYZ  " }), "a1b2c3d4e5f6-XYZ");
    for (const bad of [undefined, "", "short", "has space inside", "under_score1", "x".repeat(129), "ünicode123"]) {
      assert.equal(readIndexNowKey({ INDEXNOW_KEY: bad }), null, String(bad));
    }
    assert.equal(indexNowKeyUrl("https://prestij.com.tr/"), "https://prestij.com.tr/indexnow-key.txt");
  });

  test("local origins are never submitted", () => {
    for (const local of ["http://localhost:3000", "http://check.localhost:3590", "http://127.0.0.1:3510", "http://[::1]:3000", "http://192.168.1.20", "http://10.0.0.5", "http://172.20.0.1", "http://shop.test", "http://intranet", "not a url", "ftp://prestij.com.tr"]) {
      assert.equal(isLocalOrigin(local), true, local);
    }
    for (const live of ["https://prestij.com.tr", "https://www.prestij.com.tr", "https://prestij.vercel.app", "https://fcbarcelona.example"]) assert.equal(isLocalOrigin(live), false, live);
  });

  test("skip reasons, in order: not production, no key, local origin", () => {
    assert.equal(indexNowSkipReason({ nodeEnv: "development", key: "k", origin: "https://prestij.com.tr" }), "notProduction");
    assert.equal(indexNowSkipReason({ nodeEnv: "production", key: null, origin: "https://prestij.com.tr" }), "noKey");
    assert.equal(indexNowSkipReason({ nodeEnv: "production", key: "a1b2c3d4", origin: "http://check.localhost:3590" }), "localOrigin");
    assert.equal(indexNowSkipReason({ nodeEnv: "production", key: "a1b2c3d4", origin: "https://prestij.com.tr" }), null);
  });

  test("changedUrls: everything without a starting point; then only entries changed at or after it, own host only", () => {
    const entries = [
      { url: `${ORIGIN}/tr`, lastModified: "2026-11-05T10:00:00.000Z" },
      { url: `${ORIGIN}/tr/urunler/lavanta`, lastModified: new Date("2026-11-06T10:00:00.000Z") },
      { url: `${ORIGIN}/tr/sayfa/kvkk` },
      { url: "https://elsewhere.example/tr", lastModified: "2026-11-09T10:00:00.000Z" },
      { url: `${ORIGIN}/tr`, lastModified: "2026-11-05T10:00:00.000Z" },
    ];
    assert.deepEqual(changedUrls(entries, null, ORIGIN), [`${ORIGIN}/tr`, `${ORIGIN}/tr/urunler/lavanta`, `${ORIGIN}/tr/sayfa/kvkk`]);
    assert.deepEqual(changedUrls(entries, Date.parse("2026-11-06T10:00:00.000Z"), ORIGIN), [`${ORIGIN}/tr/urunler/lavanta`]);
    assert.deepEqual(changedUrls(entries, Date.parse("2026-11-08T00:00:00.000Z"), ORIGIN), []);
  });

  test("payload: host, key, keyLocation on the same host, urlList", () => {
    assert.deepEqual(indexNowPayload("https://prestij.com.tr", "a1b2c3d4", ["https://prestij.com.tr/tr"]), {
      host: "prestij.com.tr",
      key: "a1b2c3d4",
      keyLocation: "https://prestij.com.tr/indexnow-key.txt",
      urlList: ["https://prestij.com.tr/tr"],
    });
  });

  test("submitIndexNow: batches of 10,000 as JSON POSTs; 200 and 202 succeed, anything else throws", async () => {
    const calls: { url: string; body: { urlList: string[] }; headers: Record<string, string> }[] = [];
    const ok: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      assert.equal(init.method, "POST");
      assert.ok(init.signal, "every request has a timeout");
      return { status: calls.length === 1 ? 200 : 202 };
    };
    const urls = Array.from({ length: INDEXNOW_MAX_URLS_PER_REQUEST + 5 }, (_, i) => `https://prestij.com.tr/tr/x${i}`);
    assert.equal(await submitIndexNow(urls, { origin: "https://prestij.com.tr", key: "a1b2c3d4", fetch: ok }), 2);
    assert.deepEqual(calls.map((c) => [c.url, c.body.urlList.length]), [[INDEXNOW_ENDPOINT, 10_000], [INDEXNOW_ENDPOINT, 5]]);
    assert.equal(calls[0].headers["Content-Type"], "application/json; charset=utf-8");
    for (const status of [400, 403, 422, 429, 500]) {
      await assert.rejects(submitIndexNow(["https://prestij.com.tr/tr"], { origin: "https://prestij.com.tr", key: "a1b2c3d4", fetch: async () => ({ status }) }), new RegExp(`HTTP ${status}`));
    }
  });

  test("lastCheckedAt: only an ok run that submitted gives a starting point", () => {
    assert.equal(lastCheckedAt(null), null);
    assert.equal(lastCheckedAt({ status: "ok", result: { submitted: 3, requests: 1, checkedAt: 1_762_000_000 } }), 1_762_000_000_000);
    assert.equal(lastCheckedAt({ status: "ok", result: { skipped: 1, notProduction: 1 } }), null);
    assert.equal(lastCheckedAt({ status: "error", result: null }), null);
    assert.equal(lastCheckedAt({ status: "skipped", result: { submitted: 3, checkedAt: 1_762_000_000 } }), null);
  });
});

describe("IndexNow job run (runIndexNow, injected fetch)", () => {
  const LIVE = "https://prestij.com.tr";
  const entries = [
    { url: `${LIVE}/tr`, lastModified: "2026-11-05T10:00:00.000Z" },
    { url: `${LIVE}/tr/urunler/lavanta`, lastModified: "2026-11-09T10:00:00.000Z" },
  ];
  const deps = (overrides: Partial<IndexNowDeps> = {}): { deps: IndexNowDeps; posted: string[][] } => {
    const posted: string[][] = [];
    return {
      posted,
      deps: {
        env: { NODE_ENV: "production", INDEXNOW_KEY: "a1b2c3d4e5f60718" },
        origin: LIVE,
        fetch: async (_url, init) => {
          posted.push(JSON.parse(init.body).urlList);
          return { status: 200 };
        },
        loadEntries: async () => entries,
        loadLastRun: async () => null,
        now: () => Date.parse("2026-11-10T03:30:00.000Z"),
        ...overrides,
      },
    };
  };

  test("skips (counts only, no fetch, no data read) outside production, without a key, on a local origin", async () => {
    const cases: [Partial<IndexNowDeps>, string][] = [
      [{ env: { NODE_ENV: "development", INDEXNOW_KEY: "a1b2c3d4e5f60718" } }, "notProduction"],
      [{ env: { NODE_ENV: "test" } }, "notProduction"],
      [{ env: { NODE_ENV: "production" } }, "noKey"],
      [{ env: { NODE_ENV: "production", INDEXNOW_KEY: "bad key!" } }, "noKey"],
      [{ origin: "http://check.localhost:3590" }, "localOrigin"],
    ];
    for (const [overrides, reason] of cases) {
      let read = false;
      const { deps: d, posted } = deps({ ...overrides, loadEntries: async () => ((read = true), entries) });
      assert.deepEqual(await runIndexNow(d), { skipped: 1, [reason]: 1 }, reason);
      assert.equal(posted.length, 0);
      assert.equal(read, false);
    }
  });

  test("first run submits every sitemap URL; the next one only what changed since; nothing changed → no request", async () => {
    const first = deps();
    const checkedAt = Math.floor(Date.parse("2026-11-10T03:30:00.000Z") / 1000);
    assert.deepEqual(await runIndexNow(first.deps), { submitted: 2, requests: 1, checkedAt });
    assert.deepEqual(first.posted, [[`${LIVE}/tr`, `${LIVE}/tr/urunler/lavanta`]]);

    const second = deps({ loadLastRun: async () => ({ status: "ok", result: { submitted: 2, requests: 1, checkedAt: Math.floor(Date.parse("2026-11-08T03:30:00.000Z") / 1000) } }) });
    assert.deepEqual((await runIndexNow(second.deps)).submitted, 1);
    assert.deepEqual(second.posted, [[`${LIVE}/tr/urunler/lavanta`]]);

    const third = deps({ loadLastRun: async () => ({ status: "ok", result: { submitted: 1, requests: 1, checkedAt } }) });
    assert.deepEqual(await runIndexNow(third.deps), { submitted: 0, requests: 0, checkedAt });
    assert.equal(third.posted.length, 0);
  });

  test("a rejected submission throws (the job records an error; the next run starts over)", async () => {
    const { deps: d } = deps({ fetch: async () => ({ status: 403 }) });
    await assert.rejects(runIndexNow(d), /HTTP 403/);
  });
});
