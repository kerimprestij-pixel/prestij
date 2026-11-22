// Day 6 CORE: media kinds. isVideoMedia (kind or mime), toMediaLike keeping kind/mime only when the row
// has them (image objects from before day 6 keep their exact shape), and the panel MediaThumb: an image
// renders as itself, a video as its cover with a play badge, its duration and "Video" for screen readers.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MediaThumb, { formatMediaDuration } from "@/components/panel/media/MediaThumb";
import { isVideoMedia, MEDIA_KINDS, toMediaLike, type MediaLike } from "@/lib/media/types";
import { MEDIA_KIND_FILTERS } from "@/lib/panel/media/types";

const image: MediaLike = {
  id: 7,
  url: "/uploads/urunler/lavanta-abc-1200.webp",
  width: 1200,
  height: 1200,
  alt: { tr: "Lavanta şişe" },
  blurDataUrl: null,
  dominantColor: "#8E61B6",
  variants: [{ width: 1200, height: 1200, format: "webp", key: "urunler/lavanta-abc-1200.webp", bytes: 1000 }],
};
const video = { ...image, id: 9, url: "/uploads/urunler/tanitim-abc.mp4", variants: null, kind: "video" as const, mime: "video/mp4", durationMs: 42_400 };

describe("media kinds", () => {
  test("isVideoMedia reads the kind, else the mime; a missing kind is an image", () => {
    assert.deepEqual([...MEDIA_KINDS], ["image", "video"]);
    assert.deepEqual([...MEDIA_KIND_FILTERS], ["image", "video", "all"]);
    assert.equal(isVideoMedia(image), false);
    assert.equal(isVideoMedia({ kind: "video" }), true);
    assert.equal(isVideoMedia({ mime: "video/webm" }), true);
    assert.equal(isVideoMedia({ mime: "VIDEO/MP4" }), true);
    assert.equal(isVideoMedia({ kind: "image", mime: "image/webp" }), false);
    assert.equal(isVideoMedia(null), false);
  });

  test("toMediaLike keeps kind and mime only when the row has them", () => {
    assert.deepEqual(Object.keys(toMediaLike({ ...image, folder: "urunler" })).sort(), Object.keys(image).sort());
    const narrowed = toMediaLike({ ...video, posterId: 3 });
    assert.equal(narrowed.kind, "video");
    assert.equal(narrowed.mime, "video/mp4");
    assert.equal("posterId" in narrowed, false);
  });
});

describe("MediaThumb", () => {
  test("durations read m:ss or h:mm:ss", () => {
    assert.equal(formatMediaDuration(42_400), "0:42");
    assert.equal(formatMediaDuration(605_000), "10:05");
    assert.equal(formatMediaDuration(3_725_000), "1:02:05");
    assert.equal(formatMediaDuration(null), "");
    assert.equal(formatMediaDuration(-5), "");
  });

  test("an image renders as the image", () => {
    const html = renderToStaticMarkup(createElement(MediaThumb, { media: image, sizes: "48px", fill: true }));
    assert.match(html, /<img[^>]+lavanta-abc-1200\.webp/);
    assert.doesNotMatch(html, /Video/);
  });

  test("a video renders its cover image, a play badge, the duration and 'Video' for screen readers", () => {
    const poster: MediaLike = { ...image, id: 8, url: "/uploads/urunler/tanitim-kapak-768.webp", variants: null };
    const html = renderToStaticMarkup(createElement(MediaThumb, { media: { ...video, poster }, sizes: "160px", fill: true }));
    assert.match(html, /<img[^>]+tanitim-kapak-768\.webp/);
    assert.doesNotMatch(html, /\.mp4/, "the video file is never used as an image");
    assert.match(html, /0:42/);
    assert.match(html, /class="sr-only">Video, 0:42</);
  });

  test("a video without a cover gets a neutral tile; duration can be hidden for tiny thumbnails", () => {
    const html = renderToStaticMarkup(createElement(MediaThumb, { media: video, sizes: "48px", showDuration: false }));
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /class="sr-only">Video</);
    assert.doesNotMatch(html, /0:42/);
  });
});
