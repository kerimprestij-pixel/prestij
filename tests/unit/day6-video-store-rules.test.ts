// Day 6 VIDEO-STORE, pure rules: when a storefront video may start by itself, source types and
// durations, the media field `accept` (video fields) and its path lookup, the new "video" section and the
// hero's videoMediaId (schemas + field specs), and the product gallery's save-time kind rules
// (productMediaKindErrors, shared by the editor and the service) with the `autoplay` save field.
//   npx tsx --test tests/unit/day6-video-store-rules.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { emptyValueFor, flattenFieldSpecs, mediaAcceptAt, type FieldSpec } from "@/components/sections/field-spec";
import { sectionMeta, sectionTypes } from "@/components/sections/schemas";
import {
  formatVideoDuration,
  isConstrainedConnection,
  isMostlyVisible,
  mayAutoplay,
  readPlaybackEnv,
  videoAspectRatio,
  videoSourceType,
  VISIBILITY_THRESHOLDS,
} from "@/components/sections/video-rules";
import { productSaveSchema } from "@/lib/panel/products/schema";
import { MAX_PRODUCT_VIDEOS, PRODUCT_MEDIA_MESSAGES, productMediaKindErrors, type ProductMediaFacts } from "@/lib/panel/products/types";

describe("video playback rules", () => {
  test("a muted video starts by itself only without reduced motion and on an unconstrained connection", () => {
    assert.equal(mayAutoplay({ reducedMotion: false }), true, "no Network Information API = fast");
    assert.equal(mayAutoplay({ reducedMotion: false, effectiveType: "4g", saveData: false }), true);
    assert.equal(mayAutoplay({ reducedMotion: true, effectiveType: "4g" }), false, "reduced motion");
    assert.equal(mayAutoplay({ reducedMotion: false, saveData: true }), false, "Save-Data");
    for (const slow of ["slow-2g", "2g", "3g"]) assert.equal(mayAutoplay({ reducedMotion: false, effectiveType: slow }), false, slow);
    assert.equal(isConstrainedConnection({ effectiveType: "4g" }), false);
    assert.equal(isConstrainedConnection({ saveData: true, effectiveType: "4g" }), true);
  });

  test("outside a browser nothing would start", () => {
    assert.deepEqual(readPlaybackEnv(), { reducedMotion: true });
  });

  test("in view: half of the box, or a visible part covering 30 % of the screen (a tall 4:5 slide on a laptop)", () => {
    assert.equal(isMostlyVisible({ isIntersecting: true, ratio: 0.5, visibleHeight: 100, viewportHeight: 900 }), true);
    // Found in the live check: an 819 px slide with 384 px visible (47 %) on a 900 px screen.
    assert.equal(isMostlyVisible({ isIntersecting: true, ratio: 0.47, visibleHeight: 384, viewportHeight: 900 }), true);
    assert.equal(isMostlyVisible({ isIntersecting: true, ratio: 0.2, visibleHeight: 200, viewportHeight: 900 }), false);
    assert.equal(isMostlyVisible({ isIntersecting: false, ratio: 0, visibleHeight: 0, viewportHeight: 900 }), false);
    assert.equal(isMostlyVisible({ isIntersecting: true, ratio: 0.3, visibleHeight: 400, viewportHeight: null }), false, "no viewport size: half of the box only");
    assert.ok(VISIBILITY_THRESHOLDS.includes(0) && VISIBILITY_THRESHOLDS.includes(0.5));
  });

  test("source types: the stored video mime, else the URL's extension, else none", () => {
    assert.equal(videoSourceType("/uploads/a.mp4", "video/mp4"), "video/mp4");
    assert.equal(videoSourceType("/uploads/a.bin", "VIDEO/WEBM"), "video/webm");
    assert.equal(videoSourceType("https://cdn.example.com/kapak.webm?v=2"), "video/webm");
    assert.equal(videoSourceType("https://cdn.example.com/kapak.MP4#t=1"), "video/mp4");
    assert.equal(videoSourceType("https://cdn.example.com/kapak.m4v"), "video/mp4");
    assert.equal(videoSourceType("https://cdn.example.com/kapak", "image/webp"), undefined, "an image mime is not a video type");
    assert.equal(videoSourceType("https://cdn.example.com/kapak.mov"), undefined);
  });

  test("durations read the same in every locale (Western digits)", () => {
    assert.equal(formatVideoDuration(42_000), "0:42");
    assert.equal(formatVideoDuration(605_000), "10:05");
    assert.equal(formatVideoDuration(3_725_000), "1:02:05");
    assert.equal(formatVideoDuration(89_600), "1:30", "rounded to whole seconds");
    assert.equal(formatVideoDuration(null), "");
    assert.equal(formatVideoDuration(-1), "");
    assert.equal(formatVideoDuration(Number.NaN), "");
  });

  test("the video box takes the stored size, else 16 / 9", () => {
    assert.equal(videoAspectRatio(1920, 1080), "1920 / 1080");
    assert.equal(videoAspectRatio(1080, 1350), "1080 / 1350");
    assert.equal(videoAspectRatio(null, 1080), "16 / 9");
    assert.equal(videoAspectRatio(0, 0, "4 / 5"), "4 / 5");
  });
});

describe("media fields: accept and path lookup", () => {
  const fields: FieldSpec[] = [
    { key: "imageId", type: "media", label: "Görsel" },
    { key: "videoMediaId", type: "media", accept: "video", label: "Video" },
    { key: "title", type: "localized", label: "Başlık" },
    {
      key: "items",
      type: "repeater",
      label: "Öğeler",
      itemLabel: "Öğe",
      fields: [
        { key: "imageId", type: "media", label: "Görsel" },
        { key: "clipMediaId", type: "media", accept: "video", label: "Klip" },
      ],
    },
  ];

  test("top-level and repeater paths resolve to the field's kind (image by default)", () => {
    assert.equal(mediaAcceptAt(fields, "imageId"), "image");
    assert.equal(mediaAcceptAt(fields, "videoMediaId"), "video");
    assert.equal(mediaAcceptAt(fields, "items.0.imageId"), "image");
    assert.equal(mediaAcceptAt(fields, "items.12.clipMediaId"), "video");
  });

  test("paths that are not media fields give null", () => {
    assert.equal(mediaAcceptAt(fields, "title"), null);
    assert.equal(mediaAcceptAt(fields, "items"), null);
    assert.equal(mediaAcceptAt(fields, "items.0"), null);
    assert.equal(mediaAcceptAt(fields, "nope"), null);
    assert.equal(mediaAcceptAt(fields, "imageId.extra"), null);
    assert.equal(mediaAcceptAt(fields, ""), null);
  });

  test("an empty video field starts as null like any media field", () => {
    assert.equal(emptyValueFor({ key: "videoMediaId", type: "media", accept: "video", label: "Video" }), null);
  });

  test("every video field's key ends in MediaId (media usage tracking reads (image|media)ids?$)", () => {
    for (const type of sectionTypes) {
      for (const field of flattenFieldSpecs(sectionMeta[type].fields)) {
        if (field.type !== "media") continue;
        assert.match(field.key, /(image|media)ids?$/i, `${type}.${field.key} is tracked`);
        if (field.accept === "video") assert.match(field.key, /MediaId$/, `${type}.${field.key}`);
      }
    }
  });
});

describe('the "video" section and the hero video', () => {
  const video = sectionMeta.video;

  test("defaults parse (no video yet) and render choices default to wide + click to play", () => {
    const parsed = video.schema.parse(video.defaults);
    assert.deepEqual(parsed, { layout: "wide", playback: "click_to_play" });
  });

  test("a full section parses; ids may come as numeric strings; unknown layouts and playbacks fail", () => {
    const parsed = video.schema.parse({
      eyebrow: { tr: "Yakından" },
      title: { tr: "Lavanta nasıl köpürür", en: "How Lavender lathers" },
      text: { tr: "Kısa bir tanıtım." },
      videoMediaId: "41",
      posterImageId: 7,
      layout: "split",
      playback: "autoplay_muted",
    });
    assert.equal(parsed.videoMediaId, 41);
    assert.equal(parsed.posterImageId, 7);
    assert.equal(video.schema.safeParse({ videoMediaId: 1, layout: "full" }).success, false);
    assert.equal(video.schema.safeParse({ videoMediaId: 1, playback: "autoplay" }).success, false);
  });

  test("the panel requires the video, offers only videos there and only images for the cover", () => {
    const byKey = new Map(video.fields.map((f) => [f.key, f]));
    const clip = byKey.get("videoMediaId");
    assert.ok(clip && clip.type === "media");
    assert.equal(clip.accept, "video");
    assert.equal(clip.required, true);
    const cover = byKey.get("posterImageId");
    assert.ok(cover && cover.type === "media");
    assert.equal(cover.accept ?? "image", "image");
    assert.equal(mediaAcceptAt(video.fields, "videoMediaId"), "video");
    assert.equal(mediaAcceptAt(video.fields, "posterImageId"), "image");
    assert.match(video.label, /Video/);
  });

  test("hero: videoMediaId (a video field) next to the legacy videoUrl; both optional", () => {
    const hero = sectionMeta.hero;
    const base = { headline: { tr: "Merhaba" } };
    assert.equal(hero.schema.parse({ ...base, videoMediaId: 12 }).videoMediaId, 12);
    assert.equal(hero.schema.parse({ ...base, videoMediaId: null }).videoMediaId, null);
    assert.equal(hero.schema.parse(base).videoMediaId, undefined);
    assert.equal(mediaAcceptAt(hero.fields, "videoMediaId"), "video");
    assert.equal(mediaAcceptAt(hero.fields, "imageId"), "image");
    assert.equal(mediaAcceptAt(hero.fields, "mobileImageId"), "image");
    const keys = hero.fields.map((f) => f.key);
    assert.ok(keys.indexOf("videoMediaId") < keys.indexOf("videoUrl"), "the library video comes first in the editor");
  });

  test("every existing image field stays an image field", () => {
    for (const type of sectionTypes) {
      for (const field of flattenFieldSpecs(sectionMeta[type].fields)) {
        if (field.type === "media" && field.accept === "video") assert.ok(["hero.videoMediaId", "video.videoMediaId"].includes(`${type}.${field.key}`), `${type}.${field.key}`);
      }
    }
  });
});

describe("product gallery: save-time kind rules", () => {
  const facts = new Map<number, ProductMediaFacts>([
    [1, { video: false, hasPoster: false }],
    [2, { video: false, hasPoster: false }],
    [10, { video: true, hasPoster: true }],
    [11, { video: true, hasPoster: true }],
    [12, { video: true, hasPoster: true }],
    [13, { video: true, hasPoster: true }],
    [20, { video: true, hasPoster: false }],
  ]);
  const rows = (...ids: number[]) => ids.map((mediaId) => ({ mediaId }));
  const errors = (...ids: number[]) => productMediaKindErrors(rows(...ids), (id) => facts.get(id));

  test("images first, up to three videos with covers: no error", () => {
    assert.deepEqual(errors(1, 10, 2, 11, 12), {});
    assert.deepEqual(errors(), {});
    assert.deepEqual(errors(1), {});
  });

  test("a video in the first row is refused at media.0.mediaId", () => {
    assert.deepEqual(errors(10, 1), { "media.0.mediaId": PRODUCT_MEDIA_MESSAGES.firstIsVideo });
  });

  test("a video without a cover image is refused at its row", () => {
    assert.deepEqual(errors(1, 20), { "media.1.mediaId": PRODUCT_MEDIA_MESSAGES.videoWithoutPoster });
  });

  test(`more than ${MAX_PRODUCT_VIDEOS} videos are refused on the list`, () => {
    assert.equal(MAX_PRODUCT_VIDEOS, 3);
    assert.deepEqual(errors(1, 10, 11, 12, 13), { media: PRODUCT_MEDIA_MESSAGES.tooManyVideos });
  });

  test("unknown media count as images (the existence check reports them)", () => {
    assert.deepEqual(errors(99, 10), {});
  });

  test("the messages are Turkish and say what to do", () => {
    assert.match(PRODUCT_MEDIA_MESSAGES.firstIsVideo, /^İlk sırada bir görsel olmalı/);
    assert.match(PRODUCT_MEDIA_MESSAGES.tooManyVideos, /en fazla 3 video/);
    assert.match(PRODUCT_MEDIA_MESSAGES.videoWithoutPoster, /kapak görseli/);
  });
});

describe("product save schema: autoplay", () => {
  const base = {
    id: 1,
    updatedAt: "2026-11-12T10:00:00.000Z",
    slug: "day6-test",
    type: "standard",
    status: "draft",
    name: { tr: "Deneme" },
    subtitle: null,
    shortDescription: null,
    description: null,
    categoryId: null,
    isFeatured: false,
    businessOnly: false,
    allowSubscription: false,
    accentColor: "",
    tint: "",
    tintDark: "",
    scentTop: null,
    scentHeart: null,
    scentBase: null,
    usage: null,
    warnings: null,
    ingredients: "",
    claims: [],
    specs: [],
    seo: { title: null, description: null, ogImageId: null, noIndex: false },
    options: [],
    variants: [
      {
        key: "v1",
        id: 1,
        sku: "DAY6TEST-1",
        barcode: "",
        price: 1000,
        compareAtPrice: null,
        costPrice: null,
        vatRate: 20,
        stock: 0,
        stockSeen: 0,
        trackStock: true,
        allowBackorder: false,
        lowStockThreshold: 5,
        volumeMl: null,
        weightGrams: null,
        desi: null,
        minQuantity: 1,
        maxQuantity: null,
        imageId: null,
        isDefault: true,
        isActive: true,
        optionValueKeys: [],
      },
    ],
    tiers: [],
    groupPrices: [],
    bundleItems: [],
    relatedIds: [],
  };

  test("a row without autoplay saves false; a boolean is kept; anything else is refused", () => {
    const parse = (media: unknown[]) => productSaveSchema.safeParse({ ...base, media });
    const row = { key: "m1", id: null, mediaId: 5, role: "gallery", variantKey: null };
    const missing = parse([row]);
    assert.ok(missing.success, missing.success ? "" : JSON.stringify(missing.error.issues));
    assert.equal(missing.data.media[0].autoplay, false);
    const on = parse([{ ...row, autoplay: true }]);
    assert.ok(on.success);
    assert.equal(on.data.media[0].autoplay, true);
    assert.equal(parse([{ ...row, autoplay: "yes" }]).success, false);
  });
});

describe("image consumers that need a session or a render (source checks; the others are DB-tested)", () => {
  const read = (file: string) => readFileSync(file, "utf8");

  test("the panel product picker's thumbnail query keeps images only (inside the DISTINCT ON)", () => {
    const src = read("src/lib/panel/pickers.ts");
    assert.match(src, /\.where\(and\(inArray\(schema\.productMedia\.productId, ids\), imageOnly\(\)\)\)/);
  });

  test("the hero never points a poster attribute at the largest WebP and never renders <video> itself", () => {
    const src = read("src/components/sections/Hero.tsx");
    assert.doesNotMatch(src, /poster=|^\s*<video/m);
    assert.match(src, /<HeroVideo src=\{video\.src\} type=\{video\.type\} labels=\{videoLabels\} toggleClassName="bottom-4 end-4" \/>/);
    assert.match(src, /<div data-hero-video-slot="" className="absolute inset-0" \/>/);
  });

  test("order snapshots never store a video as the line image", () => {
    assert.match(read("src/lib/orders/place.ts"), /const image = d\.image && !isVideoMedia\(d\.image\) \? d\.image : null;/);
  });

  test("the product page's share image falls back to the first image when the chosen one is a video", () => {
    assert.match(read("src/app/[locale]/urunler/[slug]/page.tsx"), /chosenOg && !isVideoMedia\(chosenOg\) \? chosenOg : undefined\) \?\? product\.media\[0\]\?\.media/);
  });
});
