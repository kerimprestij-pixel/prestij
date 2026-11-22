"use client";
// Daily gift wheel activity as thin columns, one series at a time (spins, prizes claimed or orders, picked
// with the buttons above the plot), so there is never a second axis or a legend to decode: the selected
// button names the series. A generalised copy of the dashboard's SalesChart: hover or arrow keys show a
// tooltip with every number of the day; screen readers get the whole period as a table. Columns grow
// from one baseline with 4px rounded tops and 2px gaps; axis text uses the text tokens.
import { useState } from "react";
import { formatNumber } from "@/components/panel/labels";
import { niceCountMax } from "@/lib/panel/gift-wheel/labels";
import type { WheelDay } from "@/lib/panel/gift-wheel/queries";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

const METRICS = [
  { key: "spins", label: "Çevirme", noun: "çevirme" },
  { key: "claims", label: "Hediye alındı", noun: "hediye alındı" },
  { key: "orders", label: "Sipariş", noun: "sipariş" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

const dayFormat = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export default function WheelDailyChart({ days }: { days: WheelDay[] }) {
  const [metric, setMetric] = useState<MetricKey>("spins");
  const [active, setActive] = useState<number | null>(null);
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const max = niceCountMax(Math.max(0, ...days.map((d) => d[metric])));
  const total = days.reduce((sum, d) => sum + d[metric], 0);
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
    <figure className="m-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Grafikte gösterilen değer" className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={m.key === metric}
              onClick={() => setMetric(m.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none",
                m.key === metric ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-text-muted">
          Toplam <span className="font-medium tabular-nums text-text">{formatNumber(total)}</span> {meta.noun}
        </p>
      </div>

      <div className="flex gap-3">
        <div aria-hidden className="relative h-44 w-10 shrink-0 text-end text-[0.6875rem] tabular-nums text-text-muted">
          <span className="absolute end-0 top-0 -translate-y-1/2">{formatNumber(max)}</span>
          <span className="absolute end-0 top-1/2 -translate-y-1/2">{formatNumber(max / 2)}</span>
          <span className="absolute end-0 bottom-0 translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            role="group"
            aria-label={`Günlük ${meta.noun} grafiği. Günler arasında sol ve sağ ok tuşlarıyla gezinin.`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
            className="relative h-44 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 border-t border-border" />
            <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-border" />
            <span aria-hidden className="absolute inset-x-0 bottom-0 border-t border-border" />
            <div aria-hidden className="absolute inset-0 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d, i) => {
                const value = d[metric];
                const height = value > 0 ? Math.max(2, (value / max) * 100) : 0;
                return (
                  <div key={d.day} className="relative flex h-full items-end justify-center" onMouseEnter={() => setActive(i)}>
                    <span
                      className={cn(
                        "block w-full max-w-6 rounded-t-[4px] bg-gold transition-opacity motion-reduce:transition-none",
                        active !== null && active !== i && "opacity-45",
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
        Son {formatNumber(days.length)} günde {formatNumber(days.reduce((s, d) => s + d.spins, 0))} çevirme,{" "}
        {formatNumber(days.reduce((s, d) => s + d.claims, 0))} hediye alındı, {formatNumber(days.reduce((s, d) => s + d.orders, 0))} sipariş.
      </figcaption>
      {/* sr-only on a wrapper: a <table> ignores overflow, so its caption and rows would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>Günlük hediye çarkı etkinliği</caption>
          <thead>
            <tr>
              <th scope="col">Gün</th>
              <th scope="col">Çevirme</th>
              <th scope="col">Hediye alındı</th>
              <th scope="col">Sipariş</th>
              <th scope="col">Ciro</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <th scope="row">{longDayFormat.format(asDate(d.day))}</th>
                <td>{formatNumber(d.spins)}</td>
                <td>{formatNumber(d.claims)}</td>
                <td>{formatNumber(d.orders)}</td>
                <td>{formatPrice(d.revenue, "tr")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Tooltip({ day, index, count }: { day: WheelDay; index: number; count: number }) {
  const position = (index + 0.5) / count;
  const align = position < 0.33 ? "start" : position > 0.67 ? "end" : "center";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute -top-2 z-10 w-max max-w-[15rem] -translate-y-full rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-[0_8px_24px_-12px_rgb(3_38_95/0.35)]",
        align === "center" && "-translate-x-1/2",
        align === "end" && "-translate-x-full",
      )}
      style={{ left: `${position * 100}%` }}
    >
      <p className="font-medium text-text">{longDayFormat.format(asDate(day.day))}</p>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-text-muted">
        <dt>Çevirme</dt>
        <dd className="text-end tabular-nums text-text">{formatNumber(day.spins)}</dd>
        <dt>Hediye alındı</dt>
        <dd className="text-end tabular-nums text-text">{formatNumber(day.claims)}</dd>
        <dt>Sipariş</dt>
        <dd className="text-end tabular-nums text-text">{formatNumber(day.orders)}</dd>
        <dt>Ciro</dt>
        <dd className="text-end tabular-nums text-text">{formatPrice(day.revenue, "tr")}</dd>
      </dl>
    </div>
  );
}
