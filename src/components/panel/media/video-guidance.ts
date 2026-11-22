// Day 6 follow-up (lead decision D16): there is no captions feature (no subtitle files per video). Instead,
// wherever the owner chooses or uploads a video, the panel gives this short tip, so visitors who cannot hear
// the sound (muted autoplay, hearing impairment, a quiet place) still get everything: the product editor's
// "Video ekle" area, the hero and video section video fields, the media picker for videos (above its tabs,
// so the library tab has it too) and the upload area when it takes videos.
// Pure (no React): the editors import the text, a unit test checks it.

/** Panel tip for videos, in "siz" (one or two short sentences). */
export const VIDEO_SPEECH_TIP =
  "İpucu: Konuşmasız videolar kullanın ya da altyazıyı videonun görüntüsüne ekleyin. Videoda gösterilen önemli bilgileri ürün veya sayfa metnine de yazın.";
