// The gift wheel: a gold-rimmed SVG wheel (slices in the four tones, labels across each wedge, rim studs,
// PRESTİJ hub, a gold pointer at the top). Pure (no state, no effects; useId only), so the storefront
// dialog and the panel preview (WHEEL-PANEL) render the same component. Display data only
// (WheelDisplaySlice: no weights). Owner: WHEEL-UI.
//
// Layers, so a spin is one composited transform and nothing repaints while it turns:
//   1. static SVG: metal rim and dark bezel;
//   2. the face (wedges, labels, studs) in an HTML <div> rotated by CSS `transform` + `transition`
//      (`rotation`, `spinDurationMs`); the dialog drops the transition after landing so the face is
//      painted crisply again at rest;
//   3. static SVG: depth shading, sheen and the hub (its label stays upright);
//   4. the pointer (`data-wheel-pointer`): its own element, so the dialog can flick it with a
//      transform-only Web Animation as the studs pass (see pointerTickKeyframes).
// Colours use the theme's brand/gold scales, which do not change in dark mode: the wheel is an object,
// it looks the same on a light page, a dark page and the panel.
import { useId, type CSSProperties } from "react";
import type { WheelGraphicProps, WheelTone } from "@/lib/wheel/types";
import { cn } from "@/lib/utils";
import { WHEEL_CENTER as C, WHEEL_FACE_RADIUS as R, WHEEL_SPIN_EASING_CSS, WHEEL_VIEWBOX, fitWheelLabels, polar, sliceAngle, slicePath } from "./wheel-geometry";

/** Slice fill and label colour per tone (brand/gold scale tokens: the same in light and dark mode). */
export const WHEEL_TONE_COLORS: Record<WheelTone, { fill: string; text: string }> = {
  brand: { fill: "var(--brand-800)", text: "var(--gold-50)" },
  gold: { fill: "var(--gold-300)", text: "var(--brand-950)" },
  cream: { fill: "var(--gold-50)", text: "var(--brand-900)" },
  ink: { fill: "var(--brand-950)", text: "var(--gold-300)" },
};

const VIEWBOX = `0 0 ${WHEEL_VIEWBOX} ${WHEEL_VIEWBOX}`;
const RIM_OUTER = 98;
const RIM_INNER = 88.5;
const STUD_RADIUS = (RIM_OUTER + RIM_INNER) / 2;
const HUB = 20;

export default function WheelGraphic({
  slices,
  rotation = 0,
  spinDurationMs = 0,
  highlightIndex = null,
  dir = "ltr",
  label,
  centerLabel = "PRESTİJ",
  className,
}: WheelGraphicProps) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const ids = { rim: `${uid}-rim`, hub: `${uid}-hub`, depth: `${uid}-depth`, sheen: `${uid}-sheen`, pointer: `${uid}-ptr` };
  const count = slices.length;
  const a = sliceAngle(count);
  const layouts = fitWheelLabels(slices.map((s) => s.label));
  const spinning = spinDurationMs > 0;
  const faceStyle: CSSProperties = {
    transform: `rotate(${rotation}deg)`,
    transition: spinning ? `transform ${spinDurationMs}ms ${WHEEL_SPIN_EASING_CSS}` : "none",
    ...(spinning ? { willChange: "transform" } : {}),
  };
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  const rtl = dir === "rtl";

  return (
    <div className={cn("relative isolate aspect-square w-full select-none", className)} {...a11y}>
      {/* 1. Rim */}
      <svg viewBox={VIEWBOX} focusable="false" aria-hidden className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={ids.rim} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--gold-100)" />
            <stop offset="0.28" stopColor="var(--gold-300)" />
            <stop offset="0.52" stopColor="var(--gold-600)" />
            <stop offset="0.74" stopColor="var(--gold-200)" />
            <stop offset="1" stopColor="var(--gold-500)" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={RIM_OUTER + 1.2} style={{ fill: "var(--brand-950)", opacity: 0.55 }} />
        <circle cx={C} cy={C} r={RIM_OUTER} fill={`url(#${ids.rim})`} />
        <circle cx={C} cy={C} r={RIM_INNER} style={{ fill: "var(--gold-800)" }} />
        <circle cx={C} cy={C} r={RIM_INNER - 0.9} style={{ fill: "var(--brand-950)" }} />
      </svg>

      {/* 2. Face: rotates as one composited layer */}
      <div className="absolute inset-0" style={faceStyle}>
        <svg viewBox={VIEWBOX} focusable="false" aria-hidden className="size-full overflow-visible">
          {slices.map((slice, i) => {
            const tone = WHEEL_TONE_COLORS[slice.tone] ?? WHEEL_TONE_COLORS.brand;
            const layout = layouts[i];
            return (
              <g key={slice.key}>
                <path d={slicePath(i, count, C, C, R)} style={{ fill: tone.fill }} />
                {layout.lines.length > 0 ? (
                  <text
                    transform={`rotate(${round(i * a)} ${C} ${C})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    direction={dir}
                    style={{
                      fill: tone.text,
                      fontFamily: "var(--font-body)",
                      fontSize: layout.fontSize,
                      fontWeight: 650,
                      letterSpacing: rtl ? 0 : "0.01em",
                    }}
                  >
                    {layout.lines.map((line, j) => (
                      <tspan key={j} x={C} y={round(C - line.radius)}>
                        {line.text}
                      </tspan>
                    ))}
                  </text>
                ) : null}
              </g>
            );
          })}
          {count > 1
            ? slices.map((slice, i) => {
                const edge = polar(C, C, R, i * a + a / 2);
                return <line key={`sep-${slice.key}`} x1={C} y1={C} x2={edge.x} y2={edge.y} style={{ stroke: "var(--gold-300)", strokeWidth: 0.9, opacity: 0.9 }} />;
              })
            : null}
          {highlightIndex !== null && highlightIndex >= 0 && highlightIndex < count ? (
            <path
              d={slicePath(highlightIndex, count, C, C, R - 0.6)}
              style={{ fill: "#fff", fillOpacity: 0.14, stroke: "var(--gold-200)", strokeWidth: 1.8, strokeLinejoin: "round" }}
            />
          ) : null}
          {/* Studs on the rim: one on every slice edge (the pegs the pointer ticks against) and one mid-slice. */}
          {Array.from({ length: Math.max(count, 1) * 2 }, (_, k) => {
            const p = polar(C, C, STUD_RADIUS, (k * a) / 2 + a / 2);
            const peg = k % 2 === 0;
            return (
              <circle
                key={`stud-${k}`}
                cx={p.x}
                cy={p.y}
                r={peg ? 2.1 : 1.4}
                style={{ fill: peg ? "var(--gold-50)" : "var(--gold-100)", stroke: "var(--gold-800)", strokeWidth: 0.45 }}
              />
            );
          })}
        </svg>
      </div>

      {/* 3. Depth, sheen and hub (static) */}
      <svg viewBox={VIEWBOX} focusable="false" aria-hidden className="pointer-events-none absolute inset-0 size-full">
        <defs>
          <radialGradient id={ids.depth} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.62" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.32" />
          </radialGradient>
          <radialGradient id={ids.sheen} cx="0.32" cy="0.2" r="0.62">
            <stop offset="0" stopColor="#fff" stopOpacity="0.26" />
            <stop offset="0.6" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={ids.hub} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--gold-100)" />
            <stop offset="0.45" stopColor="var(--gold-400)" />
            <stop offset="1" stopColor="var(--gold-700)" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill={`url(#${ids.depth})`} />
        <circle cx={C} cy={C} r={R} fill={`url(#${ids.sheen})`} />
        <circle cx={C} cy={C + 1.2} r={HUB + 1.5} style={{ fill: "#000", opacity: 0.28 }} />
        <circle cx={C} cy={C} r={HUB} fill={`url(#${ids.hub})`} />
        <circle cx={C} cy={C} r={HUB - 3.2} style={{ fill: "var(--brand-950)" }} />
        <circle cx={C} cy={C} r={HUB - 5} style={{ fill: "none", stroke: "var(--gold-300)", strokeWidth: 0.45, opacity: 0.7 }} />
        <text
          x={C}
          y={C + 0.4}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fill: "var(--gold-200)", fontFamily: "var(--font-heading)", fontSize: 5.6, fontWeight: 600, letterSpacing: 0.7 }}
        >
          {centerLabel}
        </text>
      </svg>

      {/* 4. Pointer: pivot near its head, so a rotation flicks the tip */}
      <svg
        data-wheel-pointer=""
        viewBox="0 0 24 32"
        focusable="false"
        aria-hidden
        className="absolute top-[-3.5%] left-1/2 w-[12%] -translate-x-1/2 overflow-visible drop-shadow-[0_2px_2px_rgb(2_21_56/0.45)]"
        style={{ transformOrigin: "50% 31%" }}
      >
        <defs>
          <linearGradient id={ids.pointer} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--gold-100)" />
            <stop offset="0.5" stopColor="var(--gold-300)" />
            <stop offset="1" stopColor="var(--gold-600)" />
          </linearGradient>
        </defs>
        <path
          d="M12 31 C 9.6 24.5 4 17.6 4 10 A 8 8 0 1 1 20 10 C 20 17.6 14.4 24.5 12 31 Z"
          fill={`url(#${ids.pointer})`}
          style={{ stroke: "var(--gold-800)", strokeWidth: 0.7, strokeLinejoin: "round" }}
        />
        <circle cx="12" cy="10" r="3.4" style={{ fill: "var(--brand-950)", stroke: "var(--gold-100)", strokeWidth: 0.8 }} />
      </svg>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;
