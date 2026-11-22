// Turns the client's logo (navy wordmark + gold crown on a near-white, slightly noisy background) into
// a transparent PNG, a dark-background variant (navy -> ivory) and app icons built from the crown.
import sharp from "sharp";

type Rgba = { data: Buffer; width: number; height: number };

const IVORY = [0xf9, 0xf8, 0xf5] as const;
const NAVY = "#03265F";

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Median of the outer 4px frame: the background color. */
function backgroundOf(rgb: Buffer, w: number, h: number): [number, number, number] {
  const samples: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= 4 && y >= 4 && x < w - 4 && y < h - 4) continue;
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) samples[c].push(rgb[i + c]);
    }
  }
  return samples.map((s) => s.sort((a, b) => a - b)[s.length >> 1]) as [number, number, number];
}

/**
 * Background -> alpha with a smooth edge. "Ink" is how much darker than the background a pixel is
 * (largest channel drop) or how colorful it is (the gold highlights are bright but saturated, while
 * the background noise is neutral). Edge colors are un-blended from the background to avoid halos.
 */
function removeBackground(rgb: Buffer, w: number, h: number): Rgba {
  const bg = backgroundOf(rgb, w, h);
  const alpha = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 3;
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const drop = Math.max(bg[0] - r, bg[1] - g, bg[2] - b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    alpha[p] = Math.max(smoothstep(14, 52, drop), smoothstep(24, 52, chroma));
  }
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y * w + x]);

  // Despeckle: background noise survives as isolated dots with almost no solid neighbours.
  const cleaned = Float32Array.from(alpha);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!alpha[y * w + x]) continue;
      let solid = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy) > 0.5) solid++;
      if (solid < 2) cleaned[y * w + x] = 0;
    }
  }

  // Choke the outermost ring (light, half-covered edge pixels) so no pale fringe shows on dark backgrounds.
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = cleaned[p];
      if (a <= 0.004) continue; // fully transparent (RGB stays 0)
      const c = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : cleaned[yy * w + xx]);
      const min4 = Math.min(a, c(x - 1, y), c(x + 1, y), c(x, y - 1), c(x, y + 1));
      const i = p * 3, o = p * 4;
      out[o] = clamp(bg[0] + (rgb[i] - bg[0]) / a);
      out[o + 1] = clamp(bg[1] + (rgb[i + 1] - bg[1]) / a);
      out[o + 2] = clamp(bg[2] + (rgb[i + 2] - bg[2]) / a);
      out[o + 3] = Math.round((0.7 * min4 + 0.3 * a) * 255);
    }
  }
  return { data: out, width: w, height: h };
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Gold pixels are warm (red well above blue); the navy wordmark is cool. 0 = navy, 1 = gold. */
const warmth = (r: number, b: number) => smoothstep(8, 40, r - b);

function bbox(img: Rgba, keep: (o: number, x: number, y: number) => boolean) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!keep((y * img.width + x) * 4, x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("Logo: nothing left after background removal");
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function crop(img: Rgba, box: { left: number; top: number; width: number; height: number }, pad = 0): Rgba {
  const left = Math.max(0, box.left - pad), top = Math.max(0, box.top - pad);
  const width = Math.min(img.width - left, box.width + pad * 2), height = Math.min(img.height - top, box.height + pad * 2);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    img.data.copy(out, y * width * 4, ((top + y) * img.width + left) * 4, ((top + y) * img.width + left + width) * 4);
  }
  return { data: out, width, height };
}

const png = (img: Rgba) =>
  sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

/** Dark-background version: navy pixels become ivory, gold stays. */
function toDarkVariant(img: Rgba): Rgba {
  const out = Buffer.from(img.data);
  for (let o = 0; o < out.length; o += 4) {
    if (out[o + 3] === 0) continue;
    const t = warmth(out[o], out[o + 2]);
    for (let c = 0; c < 3; c++) out[o + c] = clamp(IVORY[c] * (1 - t) + out[o + c] * t);
  }
  return { ...img, data: out };
}

/** The crown alone: the widest run of gold columns (the sparkle beside it is a separate, narrower run). */
function extractCrown(img: Rgba): Rgba {
  const isGold = (o: number) => img.data[o + 3] > 64 && warmth(img.data[o], img.data[o + 2]) > 0.5;
  const cols = new Array<boolean>(img.width).fill(false);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (isGold((y * img.width + x) * 4)) cols[x] = true;
  }
  const runs: { start: number; end: number }[] = [];
  for (let x = 0; x < img.width; x++) {
    if (!cols[x]) continue;
    const last = runs.at(-1);
    if (last && x - last.end <= 4) last.end = x; // tolerate 3px gaps inside a shape
    else runs.push({ start: x, end: x });
  }
  const best = runs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a), { start: 0, end: -1 });
  const box = bbox(img, (o, x) => x >= best.start && x <= best.end && isGold(o));
  const crown = crop(img, box, 2);
  // Drop anything that is not gold (e.g. a stray tip of the wordmark).
  for (let o = 0; o < crown.data.length; o += 4) {
    const a = crown.data[o + 3];
    if (a && warmth(crown.data[o], crown.data[o + 2]) < 0.5) crown.data[o + 3] = 0;
  }
  return crown;
}

async function iconOn(crown: Buffer, size: number, markRatio: number, radius: number): Promise<Buffer> {
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${NAVY}"/></svg>`,
  );
  const mark = await sharp(crown)
    .resize({ width: Math.round(size * markRatio), kernel: "lanczos3" })
    .sharpen({ sigma: 0.5 })
    .png()
    .toBuffer({ resolveWithObject: true });
  // Optical centering: nudge the crown up slightly so its visual weight sits in the middle.
  const left = Math.round((size - mark.info.width) / 2);
  const top = Math.round((size - mark.info.height) / 2 - size * 0.02);
  return sharp(background)
    .composite([{ input: mark.data, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export type LogoAssets = {
  /** Transparent, trimmed logo for light backgrounds. */
  light: Buffer;
  /** Same with an ivory wordmark, for dark backgrounds. */
  dark: Buffer;
  /** 512×512 navy rounded square with the gold crown. */
  icon: Buffer;
  /** 180×180 solid navy (iOS applies its own mask). */
  appleIcon: Buffer;
};

export async function buildLogoAssets(source: Buffer): Promise<LogoAssets> {
  const { data, info } = await sharp(source).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const transparent = removeBackground(data, info.width, info.height);
  const trimmed = crop(transparent, bbox(transparent, (o) => transparent.data[o + 3] > 8), 2);
  const crown = await png(extractCrown(trimmed));
  const [light, dark, icon, appleIcon] = await Promise.all([
    png(trimmed),
    png(toDarkVariant(trimmed)),
    iconOn(crown, 512, 0.66, 112),
    iconOn(crown, 180, 0.62, 0),
  ]);
  return { light, dark, icon, appleIcon };
}
