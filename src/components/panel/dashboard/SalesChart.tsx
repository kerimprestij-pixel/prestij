"use client";
// Daily revenue for the last 30 days as thin columns (one series, so no legend: the card title names it).
// Hover or arrow keys show a tooltip with the day, revenue and order count; screen readers get the same
// numbers as a table. Columns grow from one baseline, 4px rounded tops, 2px gaps; axis text uses the
// text tokens, never the bar color.
import { useState } from "react";
import type { DailySales } from "@/app/panel/_lib/dashboard";
import { formatNumber } from "@/components/panel/labels";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

const dayFormat = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** Smallest 1/2/5 × 10^k (whole liras, in kuruş) at or above `value`. */
function niceMax(kurus: number): number {
  const lira = Math.max(1, Math.ceil(kurus / 100));
  const magnitude = 10 ** Math.floor(Math.log10(lira));
  const step = [1, 2, 5, 10].find((m) => m * magnitude >= lira) ?? 10;
  return step * magnitude * 100;
}

const liraLabel = (kurus: number) => `${formatNumber(Math.round(kurus / 100))} ₺`;

export default function SalesChart({ days }: { days: DailySales[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...days.map((d) => d.revenue)));
  const total = days.reduce((sum, d) => sum + d.revenue, 0);
  const current = active === null ? null : days[active];
  const last = days.length - 1;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActive((i) => Math.min(last, Math.max(0, (i ?? (delta > 0 ? -1 : last + 1)) + delta)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : last);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  return (
    <figure className="m-0">
      <div className="flex gap-3">
        {/* Y axis: the nice maximum, the midpoint and zero. */}
        <div aria-hidden className="relative h-44 w-14 shrink-0 text-end text-[0.6875rem] tabular-nums text-text-muted">
          <span className="absolute end-0 top-0 -translate-y-1/2">{liraLabel(max)}</span>
          <span className="absolute end-0 top-1/2 -translate-y-1/2">{liraLabel(max / 2)}</span>
          <span className="absolute end-0 bottom-0 translate-y-1/2">0 ₺</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            role="group"
            aria-label="Günlük ciro grafiği. Günler arasında sol ve sağ ok tuşlarıyla gezinin."
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
            className="relative h-44 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            {/* Recessive hairline grid. */}
            <span aria-hidden className="absolute inset-x-0 top-0 border-t border-border" />
            <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-border" />
            <span aria-hidden className="absolute inset-x-0 bottom-0 border-t border-border" />
            <div aria-hidden className="absolute inset-0 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d, i) => {
                const height = d.revenue > 0 ? Math.max(2, (d.revenue / max) * 100) : 0;
                return (
                  <div key={d.day} className="relative flex h-full items-end justify-center" onMouseEnter={() => setActive(i)}>
                    <span
                      className={cn(
                        "block w-full max-w-6 rounded-t-[4px] transition-opacity motion-reduce:transition-none",
                        active === null || active === i ? "bg-gold" : "bg-gold opacity-45",
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
            {current ? <Tooltip day={current} index={active ?? 0} count={days.length} /> : null}
          </div>
          <div aria-hidden className="mt-2 flex justify-between text-[0.6875rem] text-text-muted">
            <span>{days[0] ? dayFormat.format(asDate(days[0].day)) : ""}</span>
            <span>{days[Math.floor(last / 2)] ? dayFormat.format(asDate(days[Math.floor(last / 2)].day)) : ""}</span>
            <span>Bugün</span>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        Son {formatNumber(days.length)} günde toplam {formatPrice(total, "tr")} ciro.
      </figcaption>
      {/* sr-only on a <table> does not clip it (tables ignore overflow), so the wrapper hides it. */}
      <div className="sr-only">
        <table>
          <caption>Günlük ciro</caption>
          <thead>
            <tr>
              <th scope="col">Gün</th>
              <th scope="col">Ciro</th>
              <th scope="col">Sipariş</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <th scope="row">{longDayFormat.format(asDate(d.day))}</th>
                <td>{formatPrice(d.revenue, "tr")}</td>
                <td>{formatNumber(d.orders)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Tooltip({ day, index, count }: { day: DailySales; index: number; count: number }) {
  // Keep the tooltip inside the plot: anchor left on the first third, right on the last third.
  const position = (index + 0.5) / count;
  const align = position < 0.33 ? "start" : position > 0.67 ? "end" : "center";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute -top-2 z-10 w-max max-w-[14rem] -translate-y-full rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-[0_8px_24px_-12px_rgb(3_38_95/0.35)]",
        align === "center" && "-translate-x-1/2",
        align === "end" && "-translate-x-full",
      )}
      style={{ left: `${position * 100}%` }}
    >
      <p className="font-medium text-text">{longDayFormat.format(asDate(day.day))}</p>
      <p className="mt-0.5 tabular-nums text-text">{formatPrice(day.revenue, "tr")}</p>
      <p className="text-text-muted">
        <span className="tabular-nums">{formatNumber(day.orders)}</span> sipariş
      </p>
    </div>
  );
}
