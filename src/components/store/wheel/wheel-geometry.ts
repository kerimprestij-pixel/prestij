// Geometry of the gift wheel (pure: unit-tested, shared by WheelGraphic, the spin animation and the
// panel preview). Angles are degrees, clockwise from the top (12 o'clock), where the pointer sits.
// Slice 0 is centred under the pointer at rotation 0; slice i is centred at i × sliceAngle.
// Owner: WHEEL-UI (created by CORE, day 6).
//
//   sliceAngle / polar / slicePath                 wedges
//   landingRotation / sliceAtRotation              where a spin stops (and the inverse)
//   fitWheelLabels                                 label size and line breaks that fit every wedge
//   cubicBezier / pointerTickKeyframes             the spin easing and the pointer's synced "ticks"

/** Degrees per slice. */
export function sliceAngle(count: number): number {
  return count > 0 ? 360 / count : 360;
}

/** Point at `deg` (clockwise from the top) on a circle of radius `r` around (cx, cy). */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: round(cx + r * Math.sin(rad)), y: round(cy - r * Math.cos(rad)) };
}

/** SVG path of slice `index` of `count` (a pie wedge centred on index × sliceAngle). */
export function slicePath(index: number, count: number, cx: number, cy: number, r: number): string {
  const a = sliceAngle(count);
  if (count <= 1) return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  const start = polar(cx, cy, r, index * a - a / 2);
  const end = polar(cx, cy, r, index * a + a / 2);
  const large = a > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

/**
 * Wheel rotation (clockwise degrees) that stops with slice `index` under the pointer, at least `turns`
 * full turns after the current rotation `from` (so a CSS transition from `from` spins forward).
 */
export function landingRotation(index: number, count: number, options: { from?: number; turns?: number } = {}): number {
  const { from = 0, turns = 5 } = options;
  const a = sliceAngle(count);
  const target = mod(-index * a, 360);
  const delta = mod(target - mod(from, 360), 360);
  return from + Math.max(0, Math.floor(turns)) * 360 + delta;
}

/** The slice under the pointer for a rotation (inverse of landingRotation; for tests and the preview). */
export function sliceAtRotation(rotation: number, count: number): number {
  if (count <= 0) return -1;
  const a = sliceAngle(count);
  return mod(Math.round(mod(-rotation, 360) / a), count);
}

// ---------------------------------------------------------------------------------------------------
// Labels

/** Layout constants of WheelGraphic's 200-unit viewBox (exported for the graphic and the tests). */
export const WHEEL_VIEWBOX = 200;
export const WHEEL_CENTER = 100;
/** Wedge radius (inside the metal rim). */
export const WHEEL_FACE_RADIUS = 84;
/** Labels stay inside this radius (clear of the rim pegs). */
export const WHEEL_TEXT_OUTER = 78;
/** …and outside this one (clear of the hub). */
export const WHEEL_TEXT_INNER = 24;

const LABEL_FONT = { max: 11.8, min: 5 } as const;
const LINE_HEIGHT = 1.16;
/** Gap to the wedge edges, in viewBox units. */
const SIDE_PAD = 2.6;

export type WheelLabelLine = { text: string; /** Distance of the line's centre from the wheel centre. */ radius: number };
export type WheelLabelLayout = { fontSize: number; lines: WheelLabelLine[] };

/** Approximate advance width of `text` in em (body font, semi-bold): good enough to fit labels without measuring. */
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === " ") w += 0.27;
    else if (/[iljı.,:;!|'’ıİI]/.test(ch)) w += 0.3;
    else if (/[mwMW%@₺]/.test(ch)) w += 0.86;
    else if (code >= 0x0600 && code <= 0x06ff) w += 0.52; // Arabic letters (joined forms are narrow)
    else if (/[A-ZÇĞÖŞÜ0-9]/.test(ch)) w += 0.66;
    else w += 0.57;
  }
  return w * 1.04;
}

/**
 * Whether a line box of half-width `hw` whose outer edge is `top` and inner edge `bottom` (distances from
 * the centre, along the slice's axis) fits the wedge of half-angle `half` (degrees): its inner corners
 * inside the wedge sides, its outer corners inside the text circle. Glyph boxes have some air above and
 * below the ink, so the corners are taken a little inside the box.
 */
function boxFits(hw: number, top: number, bottom: number, half: number): boolean {
  const ink = (top - bottom) * 0.14;
  const inner = bottom + ink;
  const outer = top - ink;
  const side = inner * Math.tan((Math.min(half, 80) * Math.PI) / 180) - SIDE_PAD;
  return hw <= side && hw * hw + outer * outer <= WHEEL_TEXT_OUTER * WHEEL_TEXT_OUTER;
}

/**
 * Lines stacked across the wedge at `fontSize`, as close to the rim as they fit (the wedge is widest
 * there), or null when they do not fit at all.
 */
function placeLines(lines: readonly string[], fontSize: number, half: number): WheelLabelLine[] | null {
  const lh = fontSize * LINE_HEIGHT;
  const widths = lines.map((line) => (textWidthEm(line) * fontSize) / 2);
  for (let top = WHEEL_TEXT_OUTER; top - lh * lines.length >= WHEEL_TEXT_INNER; top -= 0.5) {
    if (widths.every((hw, j) => boxFits(hw, top - lh * j, top - lh * (j + 1), half))) {
      return lines.map((text, j) => ({ text, radius: round(top - lh * j - lh / 2) }));
    }
  }
  return null;
}

/** Largest font size (in [min, max], 0.1 steps) at which `lines` fit, or 0. */
function fitSize(lines: readonly string[], half: number): number {
  if (!placeLines(lines, LABEL_FONT.min, half)) return 0;
  let lo: number = LABEL_FONT.min;
  let hi: number = LABEL_FONT.max;
  if (placeLines(lines, hi, half)) return hi;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (placeLines(lines, mid, half)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 10) / 10;
}

/** The most balanced split of `words` into `n` lines (longest line as short as possible). */
function splitLines(words: readonly string[], n: number): string[] | null {
  if (n === 1) return [words.join(" ")];
  if (words.length < n) return null;
  let best: string[] | null = null;
  let bestWidth = Infinity;
  const walk = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const lines = [...acc, words.slice(start).join(" ")];
      const widest = Math.max(...lines.map(textWidthEm));
      if (widest < bestWidth - 1e-9) {
        bestWidth = widest;
        best = lines;
      }
      return;
    }
    for (let end = start + 1; end <= words.length - (left - 1); end++) walk(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
  };
  walk(0, n, []);
  return best;
}

/**
 * Label layouts for every slice of a wheel with `labels.length` wedges: text runs across the wedge
 * (upright when the slice stops under the pointer), stacked from the rim inwards, up to three lines.
 * All labels share one font size (the smallest that fits them all), except outliers far below the
 * median, which shrink on their own so one long label does not shrink the whole wheel. Labels with
 * two or more words use two lines when that keeps the shared size (a consistent rhythm).
 */
export function fitWheelLabels(labels: readonly string[]): WheelLabelLayout[] {
  const count = labels.length;
  const half = sliceAngle(Math.max(count, 1)) / 2;
  const options = labels.map((label) => {
    const words = label.trim().split(/\s+/).filter(Boolean);
    const candidates = [1, 2, 3]
      .map((n) => (words.length === 0 ? null : splitLines(words, n)))
      .map((lines) => (lines ? { lines, size: fitSize(lines, half) } : null));
    return { words, candidates };
  });
  const bests = options.map((o) => Math.max(0, ...o.candidates.map((c) => c?.size ?? 0)));
  const sorted = bests.filter((b) => b > 0).sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : LABEL_FONT.min;
  const floor = median * 0.85;
  const shared = Math.max(Math.min(...bests.filter((b) => b >= floor)), LABEL_FONT.min);

  return options.map((o, i) => {
    if (o.words.length === 0) return { fontSize: LABEL_FONT.min, lines: [] };
    const size = bests[i] >= floor ? shared : Math.max(bests[i], LABEL_FONT.min);
    const fits = (n: number) => {
      const c = o.candidates[n - 1];
      return c && c.size >= size - 1e-9 ? c : null;
    };
    // Two lines for multi-word labels when they fit at the size, else one line, else three.
    const chosen = (o.words.length >= 2 ? fits(2) : null) ?? fits(1) ?? fits(2) ?? fits(3) ?? o.candidates.find(Boolean)!;
    const lines = placeLines(chosen.lines, size, half) ?? placeLines(chosen.lines, LABEL_FONT.min, half) ?? [];
    return { fontSize: lines.length ? size : LABEL_FONT.min, lines };
  });
}

// ---------------------------------------------------------------------------------------------------
// Spin easing and the pointer ticks

/** The spin's CSS easing: a short push, then a long, slowing glide (a real wheel under friction). */
export const WHEEL_SPIN_EASING: readonly [number, number, number, number] = [0.3, 0.1, 0.1, 1];
export const WHEEL_SPIN_EASING_CSS = `cubic-bezier(${WHEEL_SPIN_EASING.join(", ")})`;

/**
 * A CSS cubic-bezier as functions: `progress(t)` = eased progress at time fraction t (like the browser),
 * `timeAt(p)` = the time fraction at which the progress reaches p (inverse; progress must be monotonic).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const coord = (s: number, p1: number, p2: number) => 3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
  const solve = (target: number, p1: number, p2: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (coord(mid, p1, p2) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    progress: (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : coord(solve(t, x1, x2), y1, y2)),
    timeAt: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : coord(solve(p, y1, y2), x1, x2)),
  };
}

/** Rotations in (from, to] at which a slice boundary passes the pointer (boundaries sit at (k + ½) × sliceAngle). */
export function boundaryCrossings(from: number, to: number, count: number): number[] {
  if (count < 2 || !(to > from)) return [];
  const a = sliceAngle(count);
  // A boundary at wheel angle b is under the pointer when rotation ≡ -b (mod 360), i.e. rotation = a/2 + m·a.
  const out: number[] = [];
  for (let m = Math.floor((from - a / 2) / a) + 1; a / 2 + m * a <= to; m++) out.push(a / 2 + m * a);
  return out;
}

export type PointerKeyframe = { offset: number; transform: string };

/**
 * Keyframes (Web Animations) for the pointer's flick each time a rim peg passes it during a spin from
 * `from` to `to` over the CSS easing above: the flapper is pushed sideways (counter-clockwise: the rim
 * moves to the right at the top) and springs back, with smaller flicks as the wheel slows. Pegs closer
 * than ~2 frames apart blur into one deflection, as on a real wheel. Composited (transform only).
 */
export function pointerTickKeyframes(from: number, to: number, count: number, maxAngle = 16): PointerKeyframe[] {
  const ease = cubicBezier(...WHEEL_SPIN_EASING);
  const span = to - from;
  const times = boundaryCrossings(from, to, count).map((r) => ease.timeAt((r - from) / span));
  const frames: PointerKeyframe[] = [{ offset: 0, transform: "rotate(0deg)" }];
  let last = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const gap = (times[i + 1] ?? 1) - t;
    if (t - last < 0.006) continue; // less than ~30 ms after the previous flick: still deflected
    const angle = -Math.min(maxAngle, 6 + gap * 260);
    const peak = Math.min(t + Math.max(gap * 0.3, 0.004), 1);
    const back = Math.min(t + Math.max(gap * 0.8, 0.01), 1);
    frames.push({ offset: round(t), transform: "rotate(0deg)" });
    frames.push({ offset: round(peak), transform: `rotate(${round(angle)}deg)` });
    if (back < 1) frames.push({ offset: round(back), transform: "rotate(0deg)" });
    last = back;
  }
  frames.push({ offset: 1, transform: "rotate(0deg)" });
  // Offsets must not decrease (rounding can produce equal neighbours, which is allowed).
  for (let i = 1; i < frames.length; i++) if (frames[i].offset < frames[i - 1].offset) frames[i].offset = frames[i - 1].offset;
  return frames;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;
const round = (n: number) => Math.round(n * 1000) / 1000;
