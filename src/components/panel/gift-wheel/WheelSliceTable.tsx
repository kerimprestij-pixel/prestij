// Per-slice results of the Hediye Çarkı overview: spins, prizes claimed, orders and revenue for the
// period, and how often each slice actually came up compared with the share its weight gives. Server-safe.
import { WHEEL_TONE_COLORS } from "@/components/store/wheel/WheelGraphic";
import { formatNumber } from "@/components/panel/labels";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { formatShare } from "@/lib/panel/gift-wheel/labels";
import type { WheelSliceStat } from "@/lib/panel/gift-wheel/queries";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

export default function WheelSliceTable({ rows }: { rows: WheelSliceStat[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className={cn(tableClass, "min-w-[48rem]")}>
        <caption className="sr-only">Dilimlere göre sonuçlar</caption>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              Dilim
            </th>
            <th scope="col" className={cn(thClass, "text-end")}>
              Çevirme
            </th>
            <th scope="col" className={cn(thClass, "text-end")}>
              Hediye alındı
            </th>
            <th scope="col" className={cn(thClass, "text-end")}>
              Sipariş
            </th>
            <th scope="col" className={cn(thClass, "text-end")}>
              Ciro
            </th>
            <th scope="col" className={thClass}>
              Gerçek pay / ayarlanan
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = row.tone ? WHEEL_TONE_COLORS[row.tone] : null;
            return (
              <tr key={row.key} className={trClass}>
                <th scope="row" className={cn(tdClass, "text-start font-normal")}>
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn("size-3 shrink-0 rounded-full border border-border", !tone && "bg-surface-2")}
                      style={tone ? { backgroundColor: tone.fill } : undefined}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text">{row.label}</span>
                      {!row.current ? <span className="block text-xs text-text-muted">Artık çarkta yok</span> : null}
                    </span>
                  </span>
                </th>
                <td className={cn(tdClass, "text-end tabular-nums")}>{formatNumber(row.spins)}</td>
                <td className={cn(tdClass, "text-end tabular-nums")}>{formatNumber(row.claims)}</td>
                <td className={cn(tdClass, "text-end tabular-nums")}>{formatNumber(row.orders)}</td>
                <td className={cn(tdClass, "whitespace-nowrap text-end tabular-nums")}>{formatPrice(row.revenue, "tr")}</td>
                <td className={cn(tdClass, "w-56")}>
                  <span className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium tabular-nums text-text">{formatShare(row.actualShare)}</span>
                    <span className="tabular-nums text-text-muted">
                      {row.configuredShare === null ? "–" : `ayar ${formatShare(row.configuredShare)}`}
                    </span>
                  </span>
                  <span aria-hidden className="relative mt-1.5 block h-1.5 rounded-full bg-surface-2">
                    <span className="absolute inset-y-0 start-0 rounded-full bg-gold" style={{ width: `${Math.min(100, row.actualShare)}%` }} />
                    {row.configuredShare !== null ? (
                      <span
                        className="absolute -inset-y-0.5 w-0.5 rounded-full bg-text"
                        style={{ insetInlineStart: `calc(${Math.min(100, row.configuredShare)}% - 1px)` }}
                      />
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
