// Revenue tiles: today, last 7 days, last 30 days, each with order count, average order value and the
// change against the previous period of the same length. Server component.
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { SalesSummary, SalesWindow } from "@/app/panel/_lib/dashboard";
import { formatNumber } from "@/components/panel/labels";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

export default function SalesTiles({ summary }: { summary: SalesSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SalesTile label="Bugün" current={summary.today} previous={summary.yesterday} previousLabel="düne göre" />
      <SalesTile label="Son 7 gün" current={summary.last7} previous={summary.previous7} previousLabel="önceki 7 güne göre" />
      <SalesTile label="Son 30 gün" current={summary.last30} previous={summary.previous30} previousLabel="önceki 30 güne göre" />
    </div>
  );
}

function SalesTile({
  label,
  current,
  previous,
  previousLabel,
}: {
  label: string;
  current: SalesWindow;
  previous: SalesWindow;
  previousLabel: string;
}) {
  return (
    <section aria-label={`${label} satış`} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm text-text-muted">
        {label} <span className="sr-only">ciro</span>
      </h3>
      <p className="mt-3 truncate font-heading text-3xl font-medium tabular-nums leading-none text-text sm:text-4xl md:text-3xl xl:text-4xl">
        {formatPrice(current.revenue, "tr")}
      </p>
      <p className="mt-3 text-xs text-text-muted">
        <span className="tabular-nums">{formatNumber(current.orders)}</span> sipariş
        {current.orders > 0 ? (
          <>
            {" · "}ortalama <span className="tabular-nums">{formatPrice(current.average, "tr")}</span>
          </>
        ) : null}
      </p>
      <Delta current={current.revenue} previous={previous.revenue} label={previousLabel} />
    </section>
  );
}

function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  if (current === 0 && previous === 0) {
    return <p className="mt-3 border-t border-border pt-3 text-xs text-text-muted">Bu dönemde henüz satış yok</p>;
  }
  if (previous === 0) {
    return (
      <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-text-muted">
        <ArrowUpRight aria-hidden className="size-3.5 text-[#2F8F5B]" />
        Önceki dönemde satış yoktu
      </p>
    );
  }
  const change = (current - previous) / previous;
  const pct = Math.round(Math.abs(change) * 100);
  const Icon = pct === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const text = pct === 0 ? "Değişim yok" : `%${formatNumber(pct)} ${change > 0 ? "artış" : "düşüş"}`;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 border-t border-border pt-3 text-xs text-text-muted">
      <Icon aria-hidden className={cn("size-3.5", pct === 0 ? "text-text-muted" : change > 0 ? "text-[#2F8F5B]" : "text-[#C2413A]")} />
      <span className="font-medium text-text">{text}</span>
      <span>
        {label} ({formatPrice(previous, "tr")})
      </span>
    </p>
  );
}
