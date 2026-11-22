// Blog (day 3, BLOG-MEDIA): reading time, visibility/scheduling, cache lifetime, editor schema,
// tag normalization, and localized links inside the article body.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { localizeBodyLinks } from "@/components/store/blog/format";
import { isBlankHtml, lifeUntil, normalizeTags, plainTextOf, postVisibility, readingMinutes, wordCount } from "@/lib/panel/blog/reading";
import { blogPostInput } from "@/lib/panel/blog/schema";

const words = (n: number) => Array.from({ length: n }, (_, i) => `kelime${i}`).join(" ");

const base = {
  id: null,
  updatedAt: null,
  title: { tr: "Lavanta ile akşam ritüeli" },
  slug: "lavanta-ile-aksam-rituali",
  status: "draft",
};

function issues(value: unknown): Record<string, string> {
  const parsed = blogPostInput.safeParse(value);
  if (parsed.success) return {};
  return Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("reading time", () => {
  test("counts visible words only and rounds to whole minutes (min 1)", () => {
    assert.equal(plainTextOf("<h2>Başlık</h2><p>Bir &amp; iki&nbsp;üç</p><ul><li>dört</li></ul>"), "Başlık Bir & iki üç dört");
    assert.equal(wordCount("<p>Bir, iki — üç.</p>"), 3);
    assert.equal(readingMinutes(""), null);
    assert.equal(readingMinutes("<p><br></p>"), null);
    assert.equal(readingMinutes(`<p>${words(30)}</p>`), 1);
    assert.equal(readingMinutes(`<p>${words(450)}</p>`), 2);
    assert.equal(readingMinutes(`<p>${words(1000)}</p>`), 5);
    assert.equal(isBlankHtml("<p> </p><p><br></p>"), true);
    assert.equal(isBlankHtml("<p>x</p>"), false);
  });
});

describe("visibility and scheduling", () => {
  const now = new Date("2026-11-09T12:00:00Z").getTime();
  test("draft / scheduled / published", () => {
    assert.equal(postVisibility({ status: "draft", publishedAt: null }, now), "draft");
    assert.equal(postVisibility({ status: "draft", publishedAt: "2026-01-01T00:00:00Z" }, now), "draft");
    assert.equal(postVisibility({ status: "published", publishedAt: null }, now), "published");
    assert.equal(postVisibility({ status: "published", publishedAt: "2026-11-09T11:59:00Z" }, now), "published");
    assert.equal(postVisibility({ status: "published", publishedAt: "2026-11-09T12:00:01Z" }, now), "scheduled");
  });

  test("cache entries go stale at the next publish time (1 min … 1 week)", () => {
    assert.equal(lifeUntil(null, now), "max");
    assert.deepEqual(lifeUntil(new Date(now + 3600_000), now), { stale: 300, revalidate: 3600, expire: 7200 });
    assert.equal((lifeUntil(new Date(now + 5_000), now) as { revalidate: number }).revalidate, 60);
    assert.equal((lifeUntil(new Date(now - 5_000), now) as { revalidate: number }).revalidate, 60);
    assert.equal((lifeUntil(new Date(now + 30 * 86400_000), now) as { revalidate: number }).revalidate, 7 * 86400);
    const short = lifeUntil(new Date(now + 90_000), now) as { revalidate: number; expire: number };
    assert.ok(short.expire > short.revalidate && short.expire >= 3600, "expire stays above 5 min so the page is still prerendered");
  });
});

describe("blogPostInput", () => {
  test("a minimal draft parses; empty fields become null/[]", () => {
    const parsed = blogPostInput.parse({ ...base, body: { tr: "<p><br></p>", en: "" }, excerpt: { tr: "" }, tags: [], seo: undefined });
    assert.equal(parsed.body, null);
    assert.equal(parsed.excerpt, null);
    assert.deepEqual(parsed.tags, []);
    assert.deepEqual(parsed.relatedProductIds, []);
    assert.deepEqual(parsed.seo, { title: null, description: null, ogImageId: null, noIndex: false });
    assert.equal(parsed.publishedAt, null);
  });

  test("rich text is sanitized on parse (scripts, handlers, javascript: links)", () => {
    const parsed = blogPostInput.parse({
      ...base,
      body: { tr: '<h2 onclick="x()">Ara</h2><p>Metin <a href="javascript:alert(1)">kötü</a> <a href="/urunler/lavanta">iyi</a></p><script>alert(1)</script><img src=x onerror=y>' },
    });
    const html = parsed.body!.tr;
    assert.ok(!/script|onclick|onerror|javascript|<img/i.test(html), html);
    assert.ok(html.includes("<h2>Ara</h2>"));
    assert.ok(html.includes('<a href="/urunler/lavanta">iyi</a>'));
  });

  test("publishing needs a Turkish body; translations need Turkish first", () => {
    assert.equal(issues({ ...base, status: "published" })["body.tr"], "Yayınlamak için Türkçe metni yazın.");
    assert.equal(issues({ ...base, body: { tr: "", en: "<p>Hello</p>" } })["body.tr"], "Önce Türkçe metni yazın.");
    assert.deepEqual(issues({ ...base, status: "published", body: { tr: "<p>Metin</p>" } }), {});
  });

  test("title, slug, status and dates are validated with Turkish messages", () => {
    const errors = issues({ ...base, title: { tr: " " }, slug: "Lavanta Şişe", status: "live", publishedAt: "yarın" });
    assert.ok(errors["title.tr"]);
    assert.ok(errors.slug);
    assert.ok(errors.status);
    assert.equal(errors.publishedAt, "Geçerli bir tarih ve saat girin.");
  });

  test("tags are trimmed and unique ignoring case; related products de-duplicated and capped", () => {
    const parsed = blogPostInput.parse({ ...base, tags: [" Bakım ", "bakım", "BAKIM", "Koku  notaları", ""], relatedProductIds: [3, 3, "4"] });
    assert.deepEqual(parsed.tags, ["Bakım", "Koku notaları"]);
    assert.deepEqual(parsed.relatedProductIds, [3, 4]);
    assert.ok(issues({ ...base, relatedProductIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).relatedProductIds);
  });

  test("a future publish date is kept (scheduling) and datetime-local is read as Istanbul time", () => {
    const parsed = blogPostInput.parse({ ...base, status: "published", body: { tr: "<p>x</p>" }, publishedAt: "2030-01-01T09:00" });
    assert.equal(parsed.publishedAt?.toISOString(), "2030-01-01T06:00:00.000Z");
  });

  test("normalizeTags caps count and length", () => {
    assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 12);
    assert.equal(normalizeTags(["x".repeat(60)])[0].length, 40);
    assert.deepEqual(normalizeTags(["İstanbul", "istanbul"]), ["İstanbul"]);
  });
});

describe("localizeBodyLinks", () => {
  const html = '<p><a href="/urunler/lavanta?x=1#a">Ürün</a> <a href="/tr/sayfa/kvkk">KVKK</a> <a href="https://example.com" rel="noopener noreferrer" target="_blank">dış</a> <a href="#not">çapa</a> <a href="mailto:a@b.co">posta</a></p>';
  test("internal locale-less links follow the reader's language; others stay", () => {
    const en = localizeBodyLinks(html, "en");
    assert.ok(en.includes('href="/en/products/lavanta?x=1#a"'), en);
    assert.ok(en.includes('href="/tr/sayfa/kvkk"'), "already localized links are kept");
    assert.ok(en.includes('href="https://example.com"'));
    assert.ok(en.includes('href="#not"'));
    assert.ok(en.includes('href="mailto:a@b.co"'));
    assert.ok(localizeBodyLinks(html, "tr").includes('href="/tr/urunler/lavanta?x=1#a"'));
    assert.ok(localizeBodyLinks(html, "ar").includes('href="/ar/products/lavanta?x=1#a"'));
  });
});
