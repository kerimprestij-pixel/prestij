// Day 6 follow-up, lead decision D16 (UX-12, captions): no captions feature; a short, friendly Turkish tip
// in "siz" wherever the owner chooses or uploads videos: use videos without speech or with subtitles
// burned into the picture, and write important information shown in the video in the product or page text
// too. Checked: the text (one or two short sentences, formal, the three points), and where it appears (the
// product editor's "Video ekle" area, every video field of the section editor, i.e. the hero video and the
// video section, and the upload area whenever it takes videos; never on image-only fields or uploads).
//   npx tsx --test tests/unit/day6-decide-video-tip.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { VIDEO_SPEECH_TIP } from "@/components/panel/media/video-guidance";
import { sectionMeta } from "@/components/sections/schemas";

const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("D16: the tip", () => {
  test("one or two short sentences", () => {
    const sentences = VIDEO_SPEECH_TIP.replace(/^İpucu:\s*/, "").split(/(?<=\.)\s+/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 2, VIDEO_SPEECH_TIP);
    for (const s of sentences) assert.ok(s.split(/\s+/).length <= 14, `short: ${s}`);
    assert.ok(VIDEO_SPEECH_TIP.length <= 170);
  });

  test("says the three things: no speech or burned-in subtitles, and the important information in the text too", () => {
    assert.match(VIDEO_SPEECH_TIP, /Konuşmasız videolar/);
    assert.match(VIDEO_SPEECH_TIP, /altyazıyı videonun görüntüsüne/);
    assert.match(VIDEO_SPEECH_TIP, /önemli bilgileri ürün veya sayfa metnine de yazın/);
  });

  test('formal "siz" imperatives, no "sen" forms, no exclamation mark (friendly, not loud)', () => {
    for (const verb of ["kullanın", "ekleyin", "yazın"]) assert.match(VIDEO_SPEECH_TIP, new RegExp(`(?<!\\p{L})${verb}(?!\\p{L})`, "u"), verb);
    for (const sen of ["kullan", "ekle", "yaz"]) assert.doesNotMatch(VIDEO_SPEECH_TIP, new RegExp(`(?<!\\p{L})${sen}(?!\\p{L})`, "u"), sen);
    assert.doesNotMatch(VIDEO_SPEECH_TIP, /!/);
  });
});

describe("D16: where the owner chooses or uploads videos", () => {
  test('the product editor\'s "Video ekle" area: right under the header actions, above the media list', () => {
    const tab = src("src/components/panel/products/editor/MediaTab.tsx");
    assert.match(tab, /import \{ VIDEO_SPEECH_TIP \} from "@\/components\/panel\/media\/video-guidance";/);
    assert.match(tab, /\{VIDEO_SPEECH_TIP\}/);
    assert.match(tab, /Video ekle/);
    // DU-5: the tip is the Section's first child, before the list error and the (long) sortable list.
    const tip = tab.indexOf("{VIDEO_SPEECH_TIP}");
    assert.ok(tab.indexOf("Video ekle") < tip, "after the Video ekle action");
    assert.ok(tip < tab.indexOf("{listError ?"), "before the list error");
    assert.ok(tip < tab.indexOf("<SortableList"), "before the media list");
  });

  test("the media picker for videos: once above its tabs, so the library tab (opened first) has it too", () => {
    const picker = src("src/components/panel/form/MediaPickerDialog.tsx");
    assert.match(picker, /useState<"library" \| "upload">\("library"\)/, "the library tab opens first");
    assert.match(picker, /const videoTip = kind !== "image";/);
    assert.match(picker, /\{videoTip \? <VideoSpeechTip id=\{videoTipId\}/);
    assert.ok(picker.indexOf("<VideoSpeechTip") < picker.indexOf("<Tabs"), "above the tabs");
    // The upload tab links its file input to that tip instead of showing a second copy.
    assert.match(picker, /videoTipId=\{videoTip \? videoTipId : undefined\}/);
  });

  test("every video field of the section editor (the hero video and the video section), never an image field", () => {
    const editor = src("src/components/panel/sections/SectionFieldsEditor.tsx");
    assert.match(editor, /spec\.accept === "video" \? \(/);
    assert.match(editor, /\{VIDEO_SPEECH_TIP\}/);
    const videoFields = Object.entries(sectionMeta).flatMap(([type, def]) =>
      def.fields.filter((f) => f.type === "media" && f.accept === "video").map((f) => `${type}.${f.key}`),
    );
    assert.ok(videoFields.includes("hero.videoMediaId"), videoFields.join(", "));
    assert.ok(videoFields.includes("video.videoMediaId"), videoFields.join(", "));
  });

  test("the upload area (the media library's upload dialog) when it takes videos, linked to the file input", () => {
    const upload = src("src/components/panel/media/MediaUploadDialog.tsx");
    assert.match(upload, /const videoTip = accept !== "image";/);
    assert.match(upload, /const ownTip = videoTip && !videoTipId;/);
    assert.match(upload, /\{ownTip \? <VideoSpeechTip id=\{tipId\} \/> : null\}/);
    assert.match(upload, /<span>\{VIDEO_SPEECH_TIP\}<\/span>/);
    assert.match(upload, /const tipId = videoTipId \?\? ownTipId;/);
    assert.match(upload, /aria-describedby=\{videoTip \? `\$\{hintId\} \$\{tipId\}` : hintId\}/);
    // The library's upload dialog renders the dropzone without videoTipId: it shows its own tip.
    assert.match(upload, /<UploadDropzone folders=\{folders\} defaultFolder=\{defaultFolder\} queue=\{queue\} busy=\{busy\} onStart=\{onStart\} onCancel=\{onCancel\} \/>/);
  });
});
