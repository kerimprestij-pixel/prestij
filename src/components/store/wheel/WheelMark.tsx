// A miniature of the gift wheel for the floating teaser and the account card (decorative). Pure SVG,
// fixed palette like the big wheel: eight wedges in the four tones, a gold rim with studs, a gold hub
// and the pointer. The launcher CSS turns its face once when the teaser appears and while the wheel is
// loading; reduced motion stops it (global rule).
import { cn } from "@/lib/utils";

const TONES = ["var(--gold-50)", "var(--brand-800)", "var(--gold-300)", "var(--brand-950)"];
const R = 12.4;

function point(r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(16 + r * Math.sin(a)).toFixed(2)} ${(16 - r * Math.cos(a)).toFixed(2)}`;
}

const WEDGES = Array.from({ length: 8 }, (_, i) => ({
  d: `M16 16 L${point(R, i * 45 - 22.5)} A${R} ${R} 0 0 1 ${point(R, i * 45 + 22.5)} Z`,
  fill: TONES[i % 4],
}));
const STUDS = Array.from({ length: 8 }, (_, i) => point(14, i * 45 + 22.5).split(" ").map(Number));

export default function WheelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" className={cn("block", className)}>
      <circle cx="16" cy="16" r="15.6" style={{ fill: "var(--gold-300)" }} />
      <circle cx="16" cy="16" r="13" style={{ fill: "var(--gold-700)" }} />
      <g className="pw-mark-face">
        {WEDGES.map((w, i) => (
          <path key={i} d={w.d} style={{ fill: w.fill }} />
        ))}
        {STUDS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="0.75" style={{ fill: "var(--gold-50)" }} />
        ))}
      </g>
      <circle cx="16" cy="16" r="3.2" style={{ fill: "var(--gold-200)", stroke: "var(--gold-700)", strokeWidth: 0.6 }} />
      <path d="M13.9 0.9 L18.1 0.9 L16 5.2 Z" style={{ fill: "var(--brand-950)", stroke: "var(--gold-100)", strokeWidth: 0.5, strokeLinejoin: "round" }} />
    </svg>
  );
}
