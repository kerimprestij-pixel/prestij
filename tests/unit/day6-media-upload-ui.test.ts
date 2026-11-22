// Day 6 MEDIA-UPLOAD: the panel upload UI pieces that render without a browser: the shared progress list
// (phases, progressbar semantics, errors as alerts), the drop zone's accept attribute and copy per kind,
// MediaThumb tiles, and the display helpers (labels, sizes, durations, formats).
//   npx tsx --test tests/unit/day6-media-upload-ui.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatBytes, formatLabel, formatMediaDuration, mediaLabel } from "@/components/panel/media/media-format";
import MediaThumb from "@/components/panel/media/MediaThumb";
import { UploadDropzone, UploadQueueList } from "@/components/panel/media/MediaUploadDialog";
import type { QueueItem } from "@/components/panel/media/useUploadQueue";
import type { MediaLike } from "@/lib/media/types";
import { MEDIA_UPLOAD } from "@/lib/panel/media/types";

const item = (patch: Partial<QueueItem>): QueueItem => ({ key: "k", name: "tanitim.mp4", size: 5 * 1024 * 1024, kind: "video", status: "waiting", phase: null, progress: 0, ...patch });

describe("UploadQueueList", () => {
  test("phases: preparing, cover, byte progress, processing, done, error", () => {
    const html = renderToStaticMarkup(
      createElement(UploadQueueList, {
        queue: [
          item({ key: "a", status: "uploading", phase: "preparing" }),
          item({ key: "b", status: "uploading", phase: "poster" }),
          item({ key: "c", status: "uploading", phase: "uploading", progress: 0.42 }),
          item({ key: "d", status: "uploading", phase: "processing", progress: 1 }),
          item({ key: "e", status: "done", progress: 1 }),
          item({ key: "f", status: "error", error: "MOV (iPhone) videoları yüklenemez." }),
        ],
      }),
    );
    assert.match(html, /Hazırlanıyor…/);
    assert.match(html, /Kapak hazırlanıyor…/);
    assert.match(html, /%42/);
    assert.match(html, /İşleniyor…/);
    assert.match(html, /aria-valuenow="42"/);
    assert.match(html, /aria-valuenow="100"/);
    assert.match(html, /aria-valuetext="Hazırlanıyor…"/, "indeterminate phases are announced as text");
    assert.match(html, /role="alert"[^>]*>MOV \(iPhone\) videoları yüklenemez\.</);
    assert.match(html, /aria-label="Yükleme durumu"/);
  });

  test("empty queue renders nothing", () => {
    assert.equal(renderToStaticMarkup(createElement(UploadQueueList, { queue: [] })), "");
  });
});

describe("UploadDropzone", () => {
  const render = (accept: "image" | "video" | "all") =>
    renderToStaticMarkup(createElement(UploadDropzone, { folders: ["genel"], defaultFolder: "genel", queue: [], busy: false, onStart: () => undefined, accept }));

  test("accept attribute and limits per kind", () => {
    assert.match(render("image"), new RegExp(`accept="${MEDIA_UPLOAD.accept}"`));
    const video = render("video");
    assert.match(video, /accept="video\/mp4,video\/webm,\.mp4,\.m4v,\.webm"/);
    assert.match(video, /MP4 \(H\.264\) veya WebM · en fazla 50 MB ve 90 saniye/);
    assert.match(video, /MOV\/HEVC için önce MP4 \(H\.264\) olarak dışa aktarın/);
    const all = render("all");
    assert.match(all, /accept="image\/jpeg,image\/png,image\/webp,image\/avif,video\/mp4,video\/webm/);
    assert.match(all, /Görselleri veya videoları buraya sürükleyin/);
    assert.match(all, /aria-describedby=/);
  });
});

describe("MediaThumb and helpers", () => {
  const image: MediaLike = { id: 1, url: "/uploads/a-768.webp", width: 768, height: 512, alt: null, blurDataUrl: null, dominantColor: null, variants: null };

  test("a video tile never renders the video file as an image", () => {
    const html = renderToStaticMarkup(
      createElement(MediaThumb, { media: { ...image, id: 2, url: "/uploads/klip.mp4", kind: "video", mime: "video/mp4", durationMs: 62_000, poster: image }, sizes: "160px", fill: true }),
    );
    assert.match(html, /a-768\.webp/);
    assert.doesNotMatch(html, /<img[^>]+klip\.mp4/);
    assert.match(html, /1:02/);
    assert.match(html, /Video, 1:02/);
  });

  test("labels, sizes, durations, formats", () => {
    assert.equal(mediaLabel({ id: 5, alt: null, originalName: null, kind: "video" }), "Video #5");
    assert.equal(mediaLabel({ id: 5, alt: { tr: " Lavanta " }, originalName: "x.mp4", kind: "video" }), "Lavanta");
    assert.equal(formatBytes(2_621_440), "2,5 MB");
    assert.equal(formatBytes(null), "");
    assert.equal(formatMediaDuration(3_725_000), "1:02:05");
    assert.equal(formatLabel("video/webm"), "WebM");
    assert.equal(formatLabel("video/mp4"), "MP4");
    assert.equal(formatLabel("image/webp"), "WebP");
  });
});
