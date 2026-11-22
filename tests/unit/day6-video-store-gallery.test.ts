// Day 6 VIDEO-STORE, storefront rendering: the gallery's ordering rule (videos at their slot, the first
// item of every variant view is an image), video thumbnails (play badge, duration, "Video" for screen
// readers), no <video> in the static HTML of a product page, the shared VideoPlayer (click: preload none
// + play button; autoplay: nothing attached before it is seen), the hero video island (renders nothing on
// the server) and <Img> refusing a video row.
//   npx tsx --test tests/unit/day6-video-store-gallery.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HeroVideo from "@/components/sections/HeroVideo";
import LazyVideoPlayer from "@/components/sections/LazyVideoPlayer";
import VideoPlayer from "@/components/sections/VideoPlayer";
import ProductGallery, { firstImageFirst, imagesFor, type GalleryImage } from "@/components/store/ProductGallery";
import { productGalleryImages } from "@/components/store/product-heading";
import { VariantProvider } from "@/components/store/VariantContext";
import type { ProductDetail, ProductVideoData } from "@/lib/data/catalog";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";

const t = (tr: string, en?: string, ar?: string) => ({ tr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) });

function media(id: number, alt: ReturnType<typeof t> | null = null): MediaLike {
  return {
    id,
    url: `/media/x-${id}-1200.webp`,
    width: 1200,
    height: 1500,
    alt,
    blurDataUrl: null,
    dominantColor: null,
    variants: [
      { key: `x-${id}-480.webp`, width: 480, height: 600, format: "webp", bytes: 1 },
      { key: `x-${id}-1200.webp`, width: 1200, height: 1500, format: "webp", bytes: 1 },
    ],
    kind: "image",
    mime: "image/webp",
  };
}

function video(id: number, slot: number, overrides: Partial<ProductVideoData> = {}): ProductVideoData {
  return {
    id,
    url: `/uploads/videos/v-${id}.mp4`,
    mime: "video/mp4",
    width: 1080,
    height: 1350,
    durationMs: 42_000,
    autoplay: false,
    alt: null,
    uploadedAt: "2026-11-12T08:00:00.000Z",
    poster: media(900 + id),
    variantId: null,
    slot,
    ...overrides,
  };
}

type Source = Parameters<typeof productGalleryImages>[0];

function product(overrides: Partial<Source> = {}): Source {
  return {
    name: t("Lavanta", "Lavender", "اللافندر"),
    subtitle: t("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين"),
    category: null,
    options: [
      {
        id: 1,
        name: t("Ambalaj"),
        display: "buttons",
        values: [
          { id: 10, value: t("Pompalı Şişe", "Pump Bottle", "زجاجة بمضخة"), swatchColor: null, swatchMediaId: null },
          { id: 11, value: t("5 L Bidon", "5 L Canister", "عبوة 5 لترات"), swatchColor: null, swatchMediaId: null },
        ],
      },
    ],
    variants: [{ id: 4, optionValueIds: [10] }, { id: 5, optionValueIds: [11] }] as ProductDetail["variants"],
    media: [],
    ...overrides,
  };
}

const ids = (items: GalleryImage[]) => items.map((i) => (i.video ? `v${i.video.id}` : `m${i.media.id}`));

describe("productGalleryImages: videos at their slot", () => {
  test("without videos the list is exactly the images (day 5 output unchanged)", () => {
    const p = product({ media: [{ media: media(1), variantId: null, role: "packshot" }] as ProductDetail["media"] });
    const items = productGalleryImages(p, "tr");
    assert.deepEqual(items, [{ media: p.media[0].media, variantId: null, alt: "Lavanta Sıvı El Sabunu" }]);
    assert.equal("video" in items[0], false);
  });

  test("videos are placed among the images in the owner's order; extra images stay at the end", () => {
    const p = product({
      media: [
        { media: media(1), variantId: null, role: "packshot" },
        { media: media(2), variantId: null, role: "gallery" },
        { media: media(3), variantId: 4, role: "packshot" }, // a variant image appended by the loader
      ] as ProductDetail["media"],
      videos: [video(20, 3), video(21, 1, { variantId: 5 })],
    });
    assert.deepEqual(ids(productGalleryImages(p, "tr")), ["m1", "v21", "m2", "v20", "m3"]);
  });

  test("a video item shows its cover, carries the file and takes the video's own alt (else the fallback)", () => {
    const p = product({
      media: [{ media: media(1), variantId: null, role: "packshot" }] as ProductDetail["media"],
      videos: [video(20, 1, { alt: t("Lavanta köpüğü yakından", "Lavender lather close up"), autoplay: true }), video(21, 2, { variantId: 5 })],
    });
    const [, first, second] = productGalleryImages(p, "en");
    assert.equal(first.media.id, 920, "the cover image");
    assert.deepEqual(first.video, { id: 20, src: "/uploads/videos/v-20.mp4", mime: "video/mp4", durationMs: 42_000, autoplay: true });
    assert.equal(first.alt, "Lavender lather close up");
    assert.equal(second.alt, "Lavender Liquid Hand Soap, 5 L Canister", "no own alt: the phrase + the variant's size");
    assert.equal(productGalleryImages(p, "ar")[1].alt, "اللافندر — صابون سائل لليدين", "no Turkish alt on /ar");
  });

  test("a slot beyond the images simply appends", () => {
    const p = product({ media: [{ media: media(1), variantId: null, role: "packshot" }] as ProductDetail["media"], videos: [video(20, 7)] });
    assert.deepEqual(ids(productGalleryImages(p, "tr")), ["m1", "v20"]);
  });
});

describe("gallery order: the first item of every variant view is an image", () => {
  const img = (id: number, variantId: number | null = null): GalleryImage => ({ media: media(id), variantId, alt: `img ${id}` });
  const vid = (id: number, variantId: number | null = null): GalleryImage => ({
    media: media(900 + id),
    variantId,
    alt: `video ${id}`,
    video: { id, src: `/v-${id}.mp4`, mime: "video/mp4", durationMs: 1000, autoplay: false },
  });

  test("firstImageFirst moves the first image to the front and keeps the rest in order", () => {
    assert.deepEqual(ids(firstImageFirst([vid(1), vid(2), img(3), img(4)])), ["m3", "v1", "v2", "m4"]);
    assert.deepEqual(ids(firstImageFirst([img(3), vid(1)])), ["m3", "v1"]);
    assert.deepEqual(ids(firstImageFirst([vid(1), vid(2)])), ["v1", "v2"], "only videos: unchanged");
    assert.deepEqual(firstImageFirst([]), []);
  });

  test("a variant's own video before the shared images still leaves an image first", () => {
    const all = [img(1), vid(10, 5), img(2, 5), vid(11)];
    assert.deepEqual(ids(imagesFor(all, 5)), ["m2", "v10", "m1", "v11"]);
    assert.deepEqual(ids(imagesFor(all, 4)), ["m1", "v11"], "another variant: shared items only");
    assert.deepEqual(ids(imagesFor([vid(10, 5), img(1)], 5)), ["m1", "v10"]);
  });
});

describe("ProductGallery with videos (server render)", () => {
  const images: GalleryImage[] = [
    { media: media(1), variantId: null, alt: "Lavanta Sıvı El Sabunu" },
    {
      media: media(901),
      variantId: null,
      alt: "Lavanta köpüğü yakından",
      video: { id: 1, src: "/uploads/v-1.mp4", mime: "video/mp4", durationMs: 42_000, autoplay: false },
    },
  ];
  const labels = { gallery: "Ürün görselleri", previous: "Önceki", next: "Sonraki", video: "Video", play: "Videoyu oynat", pause: "Videoyu duraklat" };
  const render = (items: GalleryImage[]) => {
    const props = { defaultVariantId: null, variantIds: [] as number[] } as ComponentProps<typeof VariantProvider>;
    return renderToStaticMarkup(createElement(VariantProvider, props, createElement(ProductGallery, { images: items, locale: "tr", labels })));
  };

  test("the static HTML has the preloaded first image and no <video>", () => {
    const html = render(images);
    assert.doesNotMatch(html, /<video/);
    assert.match(html, /<img[^>]*fetchPriority="high"[^>]*>/i);
    const main = /<div class="prestij-gallery-in absolute inset-0">(.*?)<\/div>/.exec(html);
    assert.ok(main);
    assert.match(main[1], /alt="Lavanta Sıvı El Sabunu"/);
  });

  test("a list that starts with a video still opens on the image", () => {
    const html = render([images[1], images[0]]);
    const main = /<div class="prestij-gallery-in absolute inset-0">(.*?)<\/div>/.exec(html);
    assert.ok(main);
    assert.match(main[1], /alt="Lavanta Sıvı El Sabunu"/);
    assert.doesNotMatch(html, /<video/);
  });

  test("a video thumbnail: cover with the alt, play badge with the duration, 'Video' and position for screen readers", () => {
    const html = render(images);
    const buttons = [...html.matchAll(/<button type="button"(?: aria-current="true")? class="relative block[^"]*">(.*?)<\/button>/g)];
    assert.equal(buttons.length, 2);
    const [, imageThumb] = buttons[0];
    const [whole, videoThumb] = buttons[1];
    assert.doesNotMatch(whole, /aria-label=/, "the button is named by its content, as before");
    assert.match(videoThumb, /<img[^>]*alt="Lavanta köpüğü yakından"/);
    assert.match(videoThumb, /<span aria-hidden="true" class="[^"]*">.*<span dir="ltr">0:42<\/span><\/span>/);
    assert.ok(videoThumb.includes('<span class="sr-only">, Video 0:42</span><span class="sr-only"> (2/2)</span>'), videoThumb);
    assert.ok(imageThumb.includes('<span class="sr-only"> (1/2)</span>'));
    assert.doesNotMatch(imageThumb, /Video/);
  });

  test("Arabic: the word for video after an Arabic comma", () => {
    const props = { defaultVariantId: null, variantIds: [] as number[] } as ComponentProps<typeof VariantProvider>;
    const html = renderToStaticMarkup(
      createElement(VariantProvider, props, createElement(ProductGallery, { images, locale: "ar", labels: { ...labels, video: "فيديو" } })),
    );
    assert.ok(html.includes('<span class="sr-only">، فيديو 0:42</span>'), html);
  });
});

describe("VideoPlayer (server render)", () => {
  const cover = createElement("img", { alt: "Kapak", src: "/media/c.webp" });
  const labels = { play: "Videoyu oynat", pause: "Videoyu duraklat" };

  test("click to play: the cover, a <video> that downloads nothing, and a play button", () => {
    const html = renderToStaticMarkup(createElement(VideoPlayer, { src: "/uploads/a.mp4", type: "video/mp4", mode: "click", label: "Lavanta köpüğü", labels }, cover));
    assert.match(html, /<img alt="Kapak"/);
    const tag = /<video[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(tag, /preload="none"/);
    assert.match(tag, /aria-label="Lavanta köpüğü"/);
    assert.match(tag, /playsinline=""/i);
    assert.doesNotMatch(tag, /autoplay|controls|muted|loop/i);
    assert.match(html, /<source src="\/uploads\/a\.mp4" type="video\/mp4"\/>/);
    assert.match(html, /<button type="button" aria-label="Videoyu oynat" data-video-control=""/);
  });

  test("autoplay: nothing is attached before the video is seen; the play/pause button is there from the start", () => {
    const html = renderToStaticMarkup(createElement(VideoPlayer, { src: "/uploads/a.mp4", type: "video/mp4", mode: "autoplay", label: "Lavanta köpüğü", labels }, cover));
    assert.doesNotMatch(html, /<video|<source/);
    assert.match(html, /<img alt="Kapak"/);
    assert.match(html, /<button type="button" aria-label="Videoyu oynat" data-video-control=""/);
  });
});

describe("hero video island (server render)", () => {
  test("no <video> and no button in the static HTML (the player loads after load + idle, on the client)", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(HeroVideo, { src: "/uploads/hero.mp4", type: "video/mp4", labels: { play: "Oynat", pause: "Duraklat" } })));
    assert.equal(html, "<div></div>");
  });
});

describe("LazyVideoPlayer", () => {
  test("shows the cover while the player's chunk loads", () => {
    const html = renderToStaticMarkup(
      createElement(LazyVideoPlayer, { src: "/uploads/a.mp4", mode: "click", label: "Klip", labels: { play: "Oynat", pause: "Duraklat" } }, createElement("img", { alt: "Kapak", src: "/c.webp" })),
    );
    assert.match(html, /<img alt="Kapak"/);
  });
});

describe("<Img> never renders a video row", () => {
  const clip: MediaLike = { ...media(50), url: "/uploads/v.mp4", variants: null, kind: "video", mime: "video/mp4" };

  test("a video (by kind or by mime) renders nothing", () => {
    assert.equal(renderToStaticMarkup(createElement(Img, { media: clip, sizes: "100vw" })), "");
    const byMime: MediaLike = { ...clip, kind: undefined };
    assert.equal(renderToStaticMarkup(createElement(Img, { media: byMime, sizes: "100vw" })), "");
  });

  test("a video given as the phone crop is ignored; the desktop image renders alone", () => {
    const html = renderToStaticMarkup(createElement(Img, { media: media(1, t("Lavanta")), sizes: "100vw", mobile: { media: clip, sizes: "100vw" } }));
    assert.match(html, /<img[^>]*alt="Lavanta"/);
    assert.doesNotMatch(html, /max-width: 767\.98px|\.mp4/);
  });

  test("image rows render as before", () => {
    const html = renderToStaticMarkup(createElement(Img, { media: media(1, t("Lavanta")), sizes: "100vw" }));
    assert.match(html, /<picture class="contents"><source type="image\/webp"/);
  });
});
