// Day 5 UI2 (verification AP-1…AP-4, SEO-6): only the above-the-fold fonts are preloaded (Cormorant
// italic is its own, non-preloaded face that italic heading text still reaches), /media caching, both
// header logos eager, and image alts for image search (card name + type, gallery thumbnails, blog cards).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import nextConfig from "../../next.config";
import { richTextClass } from "@/components/sections/RichText";
import PostCard, { LeadPost } from "@/components/store/blog/PostCard";
import Logo from "@/components/store/Logo";
import ProductGallery, { type GalleryImage } from "@/components/store/ProductGallery";
import { proseClass } from "@/components/store/ProductInfoAccordion";
import { productCardImageAlt } from "@/components/store/product-heading";
import { VariantProvider } from "@/components/store/VariantContext";
import type { Messages } from "@/i18n/get-messages";
import type { PostCardData } from "@/lib/data/blog";
import type { MediaLike } from "@/lib/media/types";
import { DEFAULT_THEME_TOKENS } from "@/lib/theme/defaults";
import { buildThemeCss, themeVars } from "@/lib/theme/engine";

const t = (tr: string, en?: string, ar?: string) => ({ tr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) });

function media(id: number, alt: ReturnType<typeof t> | null, name = `x-${id}`): MediaLike {
  return {
    id,
    url: `/media/${name}-1024.webp`,
    width: 1200,
    height: 1500,
    alt,
    blurDataUrl: null,
    dominantColor: null,
    variants: [
      { key: "480.avif", width: 480, format: "avif" },
      { key: "480.webp", width: 480, format: "webp" },
    ] as MediaLike["variants"],
  };
}

/** Every <img …> tag of the markup with its attributes (srcset left out for readability). */
const imgTags = (html: string) => [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? null;

describe("AP-1: fonts", () => {
  const source = readFileSync("src/lib/fonts.ts", "utf8");
  const calls = [...source.matchAll(/const (\w+) = Cormorant_Garamond\(\{([^}]*)\}\);/g)].map((m) => ({ name: m[1], options: m[2] }));

  test("Cormorant roman is preloaded (latin + latin-ext for Turkish); the italic face is its own instance with preload: false", () => {
    assert.equal(calls.length, 2, "two Cormorant instances");
    const roman = calls.find((c) => /style: "normal"/.test(c.options));
    const italic = calls.find((c) => /style: "italic"/.test(c.options));
    assert.ok(roman && italic);
    assert.doesNotMatch(roman.options, /preload: false/);
    assert.match(roman.options, /subsets: \["latin", "latin-ext"\]/);
    assert.match(roman.options, /variable: "--font-cormorant"/);
    assert.match(italic.options, /preload: false/);
    assert.match(italic.options, /display: "swap"/);
    assert.doesNotMatch(italic.options, /adjustFontFallback: false/, "keeps the size-adjusted fallback");
    assert.match(italic.options, /variable: "--font-cormorant-italic"/);
    assert.match(source, new RegExp(`fontVariables = \\[[^\\]]*\\b${italic.name}\\.variable\\b`), "its variable is on <html>");
  });

  test("the theme engine gives italic heading text a stack that names the italic face first", () => {
    const light = themeVars(DEFAULT_THEME_TOKENS).light;
    assert.equal(light["--font-heading"], 'var(--font-cormorant, Georgia), Georgia, "Times New Roman", serif');
    assert.equal(light["--font-heading-italic"], 'var(--font-cormorant-italic, var(--font-cormorant, Georgia)), Georgia, "Times New Roman", serif');
    // A heading font without a separate italic face keeps its stack.
    const manrope = themeVars({ ...DEFAULT_THEME_TOKENS, fonts: { heading: "manrope", body: "manrope" } }).light;
    assert.equal(manrope["--font-heading-italic"], manrope["--font-heading"]);
    // A custom family stays first, in front of the italic default stack.
    const custom = themeVars({ ...DEFAULT_THEME_TOKENS, fonts: { heading: "Playfair Display", body: "manrope" } }).light;
    assert.equal(custom["--font-heading-italic"], `"Playfair Display", ${light["--font-heading-italic"]}`);
  });

  test("globals.css: fallback block up to date, italic elements switch --font-heading, Arabic keeps its stack", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const START = "/* @generated theme-fallback:start (npx tsx scripts/check-theme.ts --write) */";
    const block = css.slice(css.indexOf(START) + START.length, css.indexOf("/* @generated theme-fallback:end */")).trim();
    const generated = buildThemeCss(DEFAULT_THEME_TOKENS, { pretty: true })
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n")
      .trim();
    assert.equal(block, generated);
    assert.match(css, /:is\(\.italic, em, i, cite\) \{\s*--font-heading: var\(--font-heading-italic\);\s*\}/);
    assert.match(css, /:is\(h1, h2, h3, h4, \.font-heading\) :is\(em, i, cite\) \{\s*font-family: var\(--font-heading\);\s*\}/);
    assert.match(css, /html\[lang="ar"\] \{[^}]*--font-heading-italic: var\(--font-heading\);/);
  });

  test("rich-text blockquotes (heading font, italic) use the italic stack", () => {
    for (const cls of [richTextClass, proseClass]) {
      assert.ok(cls.includes("[&_blockquote]:italic"));
      assert.ok(cls.includes("[&_blockquote]:[--font-heading:var(--font-heading-italic)]"), cls);
    }
  });
});

describe("AP-2: hover-only card photo", () => {
  test("globals.css defines can-hover as a real hover pointer", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    assert.match(css, /@custom-variant can-hover \{\s*@media \(hover: hover\) and \(pointer: fine\) \{\s*@slot;/);
    const card = readFileSync("src/components/store/ProductCard.tsx", "utf8");
    assert.match(card, /className="absolute inset-0 hidden opacity-0 [^"]*can-hover:block group-hover:opacity-100/);
  });
});

describe("AP-3: /media caching", () => {
  test("one headers() rule sets Cache-Control, for /media only, without immutable", async () => {
    const rules = await nextConfig.headers!();
    const caching = rules.filter((r) => r.headers.some((h) => h.key.toLowerCase() === "cache-control"));
    assert.equal(caching.length, 1);
    assert.equal(caching[0].source, "/media/:path*");
    assert.deepEqual(caching[0].headers, [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }]);
    // Next's own matcher: the seeded files match, storefront and upload routes do not.
    const requireFromRoot = createRequire(path.resolve("package.json"));
    const { pathToRegexp } = requireFromRoot("next/dist/compiled/path-to-regexp") as { pathToRegexp: (path: string, keys: unknown[], options: object) => RegExp };
    const re = pathToRegexp(caching[0].source, [], {});
    assert.ok(re.test("/media/urunler/lavanta_latte/PRESTIJ_Lavanta_Latte_Pompali_spa_buzlu_cam-768.avif"));
    for (const path of ["/tr", "/tr/urunler", "/uploads/2026/x.webp", "/mediax/a.avif", "/tr/media/a.avif"]) assert.equal(re.test(path), false, path);
  });
});

describe("AP-4: header logos", () => {
  test("with eager, the light and the dark logo both load eagerly, without high fetch priority", () => {
    const html = renderToStaticMarkup(
      createElement(Logo, { locale: "tr", siteName: "PRESTİJ", logo: media(1, null, "prestij-logo"), logoDark: media(2, null, "prestij-logo-dark"), eager: true }),
    );
    const imgs = imgTags(html);
    assert.equal(imgs.length, 2);
    for (const img of imgs) {
      assert.equal(attr(img, "loading"), "eager", img);
      assert.equal(attr(img, "fetchPriority"), null, img);
      assert.equal(attr(img, "alt"), "PRESTİJ");
    }
    // Without eager (e.g. a logo further down) both stay lazy.
    const lazy = renderToStaticMarkup(createElement(Logo, { locale: "tr", siteName: "PRESTİJ", logo: media(1, null), logoDark: media(2, null) }));
    assert.deepEqual(imgTags(lazy).map((img) => attr(img, "loading")), ["lazy", "lazy"]);
  });
});

describe("SEO-6: image alts", () => {
  test("product card images: name + type, like the product page heading", () => {
    const product = { name: t("Lavanta", "Lavender", "اللافندر"), subtitle: t("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين") };
    assert.equal(productCardImageAlt(product, "tr"), "Lavanta Sıvı El Sabunu");
    assert.equal(productCardImageAlt(product, "en"), "Lavender Liquid Hand Soap");
    // Arabic: one noun phrase, never name + type read as a sentence (FIX2 R2-2; day5-fix2.test.ts).
    assert.equal(productCardImageAlt(product, "ar"), "اللافندر — صابون سائل لليدين");
    assert.equal(productCardImageAlt({ ...product, seoTitle: t("x", "x", "صابون اللافندر السائل لليدين — زجاجة بمضخة و5 و20 لترًا") }, "ar"), "صابون اللافندر السائل لليدين");
    assert.equal(productCardImageAlt({ name: t("Dört Koku Koleksiyonu"), subtitle: null }, "tr"), "Dört Koku Koleksiyonu");
    // A name that already says the type does not repeat it.
    assert.equal(productCardImageAlt({ name: t("Okyanus Duş Jeli"), subtitle: t("Duş Jeli") }, "tr"), "Okyanus Duş Jeli");
  });

  test("the card hides its photo from screen readers (the link reads type and name) and keeps the hover photo decorative", () => {
    const card = readFileSync("src/components/store/ProductCard.tsx", "utf8");
    assert.match(card, /<div\s+aria-hidden\s+className="absolute inset-0 transition-transform[^"]*"\s*>\s*<Img media=\{product\.image\} alt=\{productCardImageAlt\(product, locale\)\}/);
    assert.match(card, /<Img media=\{product\.hoverImage\} alt="" /);
  });

  test("gallery thumbnails: the <img> carries the alt, the button reads alt + position without aria-label", () => {
    const images: GalleryImage[] = [
      { media: media(1, null), variantId: null, alt: "Lavanta Sıvı El Sabunu, lila stüdyoda fasetli cam pompalı şişe" },
      { media: media(2, null), variantId: null, alt: "Lavanta Sıvı El Sabunu, aydınlık mermer banyoda yivli cam pompalı şişe" },
    ];
    const gallery = createElement(ProductGallery, { images, locale: "tr", labels: { gallery: "Galeri", previous: "Önceki", next: "Sonraki" } });
    const props = { defaultVariantId: null, variantIds: [] as number[] } as ComponentProps<typeof VariantProvider>;
    const html = renderToStaticMarkup(createElement(VariantProvider, props, gallery));
    const buttons = [...html.matchAll(/<button type="button"(?: aria-current="true")? class="relative block[^"]*">(.*?)<\/button>/g)];
    assert.equal(buttons.length, 2);
    buttons.forEach(([whole, inner], i) => {
      assert.doesNotMatch(whole, /aria-label=/);
      assert.equal(attr(imgTags(inner)[0], "alt"), images[i].alt);
      assert.ok(inner.includes(`<span class="sr-only"> (${i + 1}/2)</span>`), inner);
    });
    // The large image keeps the current alt.
    assert.equal(attr(imgTags(html)[0], "alt"), images[0].alt);
  });

  test("blog cards: the cover's own alt in the page language; none in that language → decorative", () => {
    const messages = { blog: { readingTime: "{minutes} dk okuma", featured: "Öne çıkan", readStory: "Yazıyı oku" } } as unknown as Messages;
    const post = {
      id: 1,
      slug: "dogru-el-yikama-adimlari",
      title: t("Doğru El Yıkama Adımları", "Proper Hand-Washing Steps"),
      excerpt: null,
      publishedAt: "2026-09-28T09:00:00.000Z",
      readingMinutes: 4,
      cover: media(30, t("Portakal sıvı el sabunu, modern lavaboda", "Orange liquid hand soap at a modern basin")),
    } as unknown as PostCardData;
    const card = (locale: "tr" | "en" | "ar") => imgTags(renderToStaticMarkup(createElement(PostCard, { post, locale, messages })))[0];
    assert.equal(attr(card("tr"), "alt"), "Portakal sıvı el sabunu, modern lavaboda");
    assert.equal(attr(card("en"), "alt"), "Orange liquid hand soap at a modern basin");
    assert.equal(attr(card("ar"), "alt"), "", "no Turkish alt on /ar");
    // The card link is the title alone (the image is outside it): nothing is read twice.
    const html = renderToStaticMarkup(createElement(PostCard, { post, locale: "tr", messages }));
    assert.match(html, /<a [^>]*>Doğru El Yıkama Adımları<\/a>/);
    // The lead keeps its alt (with the Turkish fallback), as before.
    const lead = imgTags(renderToStaticMarkup(createElement(LeadPost, { post, locale: "ar", messages })))[0];
    assert.equal(attr(lead, "alt"), "Portakal sıvı el sabunu, modern lavaboda");
  });
});
