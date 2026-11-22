// Day 5 CONTENT-BLOG: the seeded blog posts (scripts/seed-data/blog.ts) against the contract
// (docs/DAY5-SEO.md §1, §2, §5.6): completeness in tr/en/ar, length, structure, links that resolve,
// the copy rules, the panel accepting every post unchanged, and the row builder.
//   npx tsx --test tests/unit/day5-content-blog-posts.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { localizeBodyLinks } from "@/components/sections/localize-links";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { normalizeTags, plainTextOf, readingMinutes, wordCount } from "@/lib/panel/blog/reading";
import { BLOG_LIMITS, blogPostInput } from "@/lib/panel/blog/schema";
import { SLUG_PATTERN } from "@/lib/panel/format";
import {
  BLOG_AUTHOR,
  BLOG_POSTS,
  EYE_CAUTION,
  SAMPLES_NOTE,
  blogPostRow,
  mediaStem,
  type FullText,
  type SeedBlogPost,
} from "../../scripts/seed-data/blog";
import { BUNDLE, SCENTS } from "../../scripts/seed-data/products";
import { CATEGORIES } from "../../scripts/seed-data/site";

const LOCALES = ["tr", "en", "ar"] as const;
type L = (typeof LOCALES)[number];
/** The day the posts were written: every publish date is before it. */
const WRITTEN_ON = new Date("2026-11-10T00:00:00+03:00");

const SELLABLE = new Set<string>([...SCENTS.map((s) => s.slug), BUNDLE.slug]);
const CATEGORY_SLUGS = new Set<string>(CATEGORIES.filter((c) => c.isVisible).map((c) => c.slug));
const POST_SLUGS = new Set(BLOG_POSTS.map((p) => p.slug));

const hrefsOf = (html: string) => [...html.matchAll(/<a href="([^"]*)">/g)].map((m) => m[1]);
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
const texts = (post: SeedBlogPost): [string, FullText][] => [
  ["title", post.title],
  ["excerpt", post.excerpt],
  ["body", post.body],
  ["seo.title", post.seo.title],
  ["seo.description", post.seo.description],
];
const chars = (s: string) => [...s].length;

describe("the set of posts", () => {
  test("six or seven posts with unique ASCII slugs", () => {
    assert.ok(BLOG_POSTS.length >= 6 && BLOG_POSTS.length <= 7, `${BLOG_POSTS.length} posts`);
    assert.equal(POST_SLUGS.size, BLOG_POSTS.length, "slugs are unique");
    for (const post of BLOG_POSTS) assert.match(post.slug, SLUG_PATTERN);
  });

  test("published in the past, in chronological order, spread over several weeks", () => {
    const dates = BLOG_POSTS.map((p) => new Date(p.publishedAt));
    for (const [i, d] of dates.entries()) {
      assert.ok(!Number.isNaN(d.getTime()), `${BLOG_POSTS[i].slug}: valid date`);
      assert.ok(d.getTime() < WRITTEN_ON.getTime(), `${BLOG_POSTS[i].slug}: not in the future`);
      if (i > 0) assert.ok(d.getTime() > dates[i - 1].getTime(), `${BLOG_POSTS[i].slug}: after the previous post`);
    }
    const spanDays = (dates.at(-1)!.getTime() - dates[0].getTime()) / 86_400_000;
    assert.ok(spanDays >= 21, `spread over ${spanDays} days`);
  });

  test("covers are distinct seeded product photos; 1–3 related sellable products; tidy tags", () => {
    assert.equal(new Set(BLOG_POSTS.map((p) => p.cover)).size, BLOG_POSTS.length, "one cover per post");
    for (const post of BLOG_POSTS) {
      assert.match(post.cover, /^PRESTIJ_[A-Za-z0-9_]+$/, `${post.slug}: cover is a product photo stem`);
      assert.ok(post.related.length >= 1 && post.related.length <= 3, `${post.slug}: 1–3 related products`);
      assert.equal(new Set(post.related).size, post.related.length);
      for (const slug of post.related) assert.ok(SELLABLE.has(slug), `${post.slug}: "${slug}" is a sellable product (never a sample)`);
      assert.ok(post.tags.length >= 2 && post.tags.length <= 5, `${post.slug}: 2–5 tags`);
      assert.deepEqual(normalizeTags(post.tags, { max: BLOG_LIMITS.tags, maxLength: BLOG_LIMITS.tagLength }), post.tags, `${post.slug}: tags already normalized`);
    }
  });
});

describe("texts in every language", () => {
  test("title, excerpt, body and SEO texts are filled in tr, en and ar", () => {
    for (const post of BLOG_POSTS) {
      for (const [field, text] of texts(post)) {
        for (const l of LOCALES) assert.ok(text[l]?.trim(), `${post.slug} ${field}.${l} is filled`);
      }
      for (const l of LOCALES) {
        assert.ok(!/[<>]/.test(post.excerpt[l]), `${post.slug} excerpt.${l} is plain text`);
        assert.ok(chars(post.excerpt[l]) <= BLOG_LIMITS.excerpt, `${post.slug} excerpt.${l} fits`);
        assert.ok(chars(post.title[l]) <= BLOG_LIMITS.title, `${post.slug} title.${l} fits`);
      }
    }
  });

  test("SEO titles ≤ 60 characters and meta descriptions 120–155 characters", () => {
    for (const post of BLOG_POSTS) {
      for (const l of LOCALES) {
        const title = chars(post.seo.title[l]);
        const description = chars(post.seo.description[l]);
        assert.ok(title >= 25 && title <= 60, `${post.slug} seo.title.${l}: ${title}`);
        assert.ok(description >= 120 && description <= 155, `${post.slug} seo.description.${l}: ${description}`);
      }
    }
  });

  test("titles, SEO titles and descriptions are unique within each language", () => {
    for (const l of LOCALES) {
      for (const pick of [(p: SeedBlogPost) => p.title[l], (p: SeedBlogPost) => p.seo.title[l], (p: SeedBlogPost) => p.seo.description[l]]) {
        const values = BLOG_POSTS.map(pick);
        assert.equal(new Set(values).size, values.length, `unique in ${l}: ${values.join(" | ")}`);
      }
    }
  });
});

describe("bodies", () => {
  test("Turkish 700–1200 words; English and Arabic complete (≥ 700 words each)", () => {
    for (const post of BLOG_POSTS) {
      const tr = wordCount(post.body.tr);
      assert.ok(tr >= 700 && tr <= 1200, `${post.slug} tr: ${tr} words`);
      for (const l of ["en", "ar"] as const) {
        const n = wordCount(post.body[l]);
        assert.ok(n >= 700 && n <= 1500, `${post.slug} ${l}: ${n} words`);
      }
      const minutes = readingMinutes(post.body.tr);
      assert.ok(minutes !== null && minutes >= 3 && minutes <= 6, `${post.slug}: ${minutes} min`);
    }
  });

  test("the same structure and the same links in every language", () => {
    for (const post of BLOG_POSTS) {
      for (const tag of ["p", "h2", "h3", "ul", "ol", "li", "strong"]) {
        const tr = count(post.body.tr, tag);
        for (const l of ["en", "ar"] as const) assert.equal(count(post.body[l], tag), tr, `${post.slug}: <${tag}> count in ${l}`);
      }
      const tr = hrefsOf(post.body.tr).sort();
      for (const l of ["en", "ar"] as const) assert.deepEqual(hrefsOf(post.body[l]).sort(), tr, `${post.slug}: links in ${l}`);
    }
  });

  test("HTML is the blog subset, survives the sanitizer unchanged, starts with a paragraph, has no <h1>", () => {
    for (const post of BLOG_POSTS) {
      for (const l of LOCALES) {
        const html = post.body[l];
        assert.equal(sanitizeHtml(html), html, `${post.slug} body.${l} is stored exactly as the storefront renders it`);
        assert.ok(html.startsWith("<p>"), `${post.slug} body.${l} opens with a paragraph`);
        assert.ok(!/<h1\b/i.test(html), `${post.slug} body.${l}: the page owns the only <h1>`);
        assert.ok(count(html, "h2") >= 5, `${post.slug} body.${l}: structured with <h2> sections`);
        const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
        for (const tag of tags) assert.ok(["p", "h2", "h3", "ul", "ol", "li", "strong", "a"].includes(tag), `${post.slug} body.${l}: <${tag}>`);
      }
    }
  });

  test("internal links resolve; each post links a product or category, /kurumsal or /numune, and another post", () => {
    for (const post of BLOG_POSTS) {
      const links = hrefsOf(post.body.tr);
      for (const href of links) {
        const [, folder, slug, extra] = href.split("/");
        const ok =
          extra === undefined &&
          ((folder === "urunler" && SELLABLE.has(slug)) ||
            (folder === "kategori" && CATEGORY_SLUGS.has(slug)) ||
            (folder === "blog" && POST_SLUGS.has(slug) && slug !== post.slug) ||
            (["kurumsal", "numune", "iletisim"].includes(folder) && slug === undefined));
        assert.ok(ok, `${post.slug}: ${href} is a real, indexable internal page (no self link, no external link)`);
      }
      assert.ok(links.some((h) => h.startsWith("/urunler/") || h.startsWith("/kategori/")), `${post.slug}: links the catalog`);
      assert.ok(links.some((h) => h === "/kurumsal" || h === "/numune"), `${post.slug}: links /kurumsal or /numune`);
      assert.ok(links.some((h) => h.startsWith("/blog/")), `${post.slug}: links another article`);
    }
  });

  test("links point to the reader's language once rendered", () => {
    for (const post of BLOG_POSTS) {
      for (const l of LOCALES) {
        const rendered = hrefsOf(localizeBodyLinks(post.body[l], l));
        for (const href of rendered) assert.ok(href.startsWith(`/${l}/`), `${post.slug} ${l}: ${href}`);
      }
    }
    const choosing = BLOG_POSTS.find((p) => p.slug === "sivi-el-sabunu-nasil-secilir")!;
    const en = hrefsOf(localizeBodyLinks(choosing.body.en, "en"));
    assert.ok(en.includes("/en/products/lavanta") && en.includes("/en/category/el-sabunu") && en.includes("/en/samples"), en.join(" "));
    assert.ok(hrefsOf(localizeBodyLinks(choosing.body.ar, "ar")).includes("/ar/business"));
  });
});

describe("copy rules (contract §2)", () => {
  const FORBIDDEN: Record<L | "all", RegExp[]> = {
    all: [/%\s*99/, /99[.,]9/, /\bpH\b/, /\d+\s*ml\b/i, /₺/, /\bTL\b/, /\bTRY\b/, /\bISO\b/],
    tr: [/antibakteri/i, /bakteri/i, /mikrop/i, /virüs/i, /dezenfekt/i, /dermatolo/i, /hipoalerjen/i, /doğal/i, /organik/i, /vegan/i, /paraben/i, /hastal/i, /en iyi/i, /en ucuz/i, /1 numara/i, /sertifika/i, /kuruş/i, /garanti/i],
    en: [/antibacter/i, /bacteri/i, /germ/i, /virus/i, /disinfect/i, /dermatolog/i, /hypoallergen/i, /natural/i, /organic/i, /vegan/i, /paraben/i, /disease/i, /illness/i, /\bbest\b/i, /cheapest/i, /number one/i, /certif/i, /guarante/i],
    ar: [/بكتيري/, /جراثيم/, /جرثوم/, /فيروس/, /تعقيم/, /معقّم/, /طبيعي/, /عضوي/, /نباتي/, /بارابين/, /مرض/, /أفضل/, /الأرخص/, /شهادة/, /مضمون/, /\d+\s*مل/],
  };

  test("no medical/biocidal claims, unprovable superlatives, prices, certificates or pump volumes", () => {
    for (const post of BLOG_POSTS) {
      for (const [field, text] of texts(post)) {
        for (const l of LOCALES) {
          const plain = plainTextOf(text[l]);
          for (const re of [...FORBIDDEN.all, ...FORBIDDEN[l]]) assert.ok(!re.test(plain), `${post.slug} ${field}.${l} matches ${re}`);
        }
      }
      for (const tag of post.tags) assert.ok(!FORBIDDEN.tr.some((re) => re.test(tag)), `${post.slug} tag "${tag}"`);
    }
  });

  test("Arabic uses Arabic punctuation and Western digits", () => {
    for (const post of BLOG_POSTS) {
      for (const [field, text] of texts(post)) {
        const plain = plainTextOf(text.ar);
        assert.ok(!/[٠-٩]/.test(plain), `${post.slug} ${field}.ar: Western digits`);
        assert.ok(!/[,;?]/.test(plain), `${post.slug} ${field}.ar: Arabic comma, semicolon and question mark`);
      }
    }
  });

  test("the eye-contact caution goes with every usage description", () => {
    for (const post of BLOG_POSTS) {
      if (!/köpürt/i.test(post.body.tr)) continue;
      for (const l of LOCALES) assert.ok(post.body[l].includes(EYE_CAUTION[l]), `${post.slug} body.${l} carries the caution`);
    }
    assert.ok(BLOG_POSTS.filter((p) => p.body.tr.includes(EYE_CAUTION.tr)).length >= 5, "most posts describe usage, so most carry it");
  });

  test("every link to /numune says samples are free and not for sale", () => {
    for (const post of BLOG_POSTS) {
      for (const l of LOCALES) {
        if (post.body[l].includes('href="/numune"')) assert.ok(post.body[l].includes(SAMPLES_NOTE[l]), `${post.slug} body.${l}`);
      }
    }
  });

  test("only the label claims and label facts: the four claims, 12 months after opening, Kayseri / Türkiye", () => {
    const choosing = BLOG_POSTS.find((p) => p.slug === "sivi-el-sabunu-nasil-secilir")!;
    // The four label claims as a list of nouns (day 5 FIX: "cildi koruyan yapı", not a bare adjective).
    assert.match(plainTextOf(choosing.body.tr), /etkili temizlik, cildi koruyan yapı, ferah koku ve yumuşak his/);
    assert.match(plainTextOf(choosing.body.en), /effective cleansing, care for the skin, a fresh scent and a soft feel/);
    assert.match(plainTextOf(choosing.body.ar), /تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم/);
    assert.match(plainTextOf(choosing.body.tr), /PRESTİJ ürünleri Kayseri'de üretilir; menşei Türkiye'dir/);
    for (const post of BLOG_POSTS) {
      const plain = plainTextOf(post.body.tr);
      for (const months of plain.matchAll(/(\d+) ay/g)) assert.equal(months[1], "12", `${post.slug}: "${months[0]}"`);
    }
  });
});

describe("panel and rows", () => {
  test("the blog editor's schema accepts every post unchanged", () => {
    for (const post of BLOG_POSTS) {
      const parsed = blogPostInput.safeParse({
        id: null,
        updatedAt: null,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        body: post.body,
        coverId: 1,
        authorName: BLOG_AUTHOR,
        tags: post.tags,
        relatedProductIds: post.related.map((_, i) => i + 1),
        status: "published",
        publishedAt: post.publishedAt,
        seo: { title: post.seo.title, description: post.seo.description, ogImageId: null, noIndex: false },
      });
      assert.ok(parsed.success, `${post.slug}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
      const v = parsed.data;
      assert.deepEqual(v.title, post.title);
      assert.deepEqual(v.excerpt, post.excerpt);
      assert.deepEqual(v.body, post.body, `${post.slug}: the editor would save the same HTML`);
      assert.deepEqual(v.tags, post.tags);
      assert.deepEqual(v.seo.title, post.seo.title);
      assert.deepEqual(v.seo.description, post.seo.description);
      assert.equal(v.publishedAt?.toISOString(), new Date(post.publishedAt).toISOString());
    }
  });

  test("blogPostRow resolves references and mirrors the panel's save", () => {
    const post = BLOG_POSTS[0];
    const products = new Map(post.related.map((slug, i) => [slug, 100 + i]));
    const { values, missing } = blogPostRow(post, { media: new Map([[post.cover, 42]]), products });
    assert.deepEqual(missing, []);
    assert.equal(values.slug, post.slug);
    assert.equal(values.coverId, 42);
    assert.deepEqual(values.relatedProductIds, post.related.map((_, i) => 100 + i), "related products keep their order");
    assert.equal(values.authorName, "PRESTİJ");
    assert.equal(values.status, "published");
    assert.equal((values.publishedAt as Date).toISOString(), new Date(post.publishedAt).toISOString());
    assert.equal(values.readingMinutes, readingMinutes(post.body.tr));
    assert.deepEqual(values.seo, { title: post.seo.title, description: post.seo.description });
    assert.deepEqual(values.tags, post.tags);
    assert.deepEqual(values.body, post.body);
  });

  test("blogPostRow reports what it cannot resolve and still builds the row", () => {
    const post = BLOG_POSTS[0];
    const { values, missing } = blogPostRow(post, { media: new Map(), products: new Map([[post.related[0], 7]]) });
    assert.equal(values.coverId, null);
    assert.deepEqual(values.relatedProductIds, [7]);
    assert.equal(missing.length, 1 + post.related.length - 1);
    assert.match(missing[0], /cover .* not found/);
    const none = blogPostRow(post, { media: new Map(), products: new Map() });
    assert.equal(none.values.relatedProductIds, null, "no related products → null, as the panel stores it");
  });

  test("mediaStem strips the folder, the width suffix and the extension", () => {
    assert.equal(mediaStem("urunler/lavanta/PRESTIJ_Lavanta_5L_mermer_banyo-1024.webp"), "PRESTIJ_Lavanta_5L_mermer_banyo");
    assert.equal(mediaStem("urunler/collection/PRESTIJ_Koleksiyon_5L_yatay_koleksiyon-1536.webp"), "PRESTIJ_Koleksiyon_5L_yatay_koleksiyon");
    assert.equal(mediaStem("marka/prestij-logo-original.png"), "prestij-logo-original");
    assert.equal(mediaStem("PRESTIJ_X.webp"), "PRESTIJ_X");
  });

  test("scripts/seed.ts inserts the posts and owns the blog_posts table", () => {
    const seed = readFileSync(path.resolve("scripts/seed.ts"), "utf8");
    assert.match(seed, /seedBlogPosts\(db, \{ media: imported\.byStem, products: productIds \}\)/, "one seed call");
    const tables = /const SEED_TABLES: PgTable\[\] = \[([\s\S]*?)\];/.exec(seed)?.[1] ?? "";
    assert.match(tables, /\bblogPosts,/, "a reseed truncates its own posts instead of refusing (blog_posts.cover_id → media)");
  });
});
