"use client";
// Live "affected prices" panel of the campaign editor: asks the server (debounced) which variants the
// unsaved campaign would change and shows regular → campaign price, rounded exactly like the cart.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Info, LoaderCircle, PackageSearch, TriangleAlert } from "lucide-react";
import { previewCampaignAction, type CampaignPreviewResult } from "@/app/panel/(dashboard)/kampanyalar/actions";
import Badge from "@/components/panel/ui/Badge";
import { formatNumber } from "@/components/panel/labels";
import { formatPercentOff } from "@/lib/campaigns/display";
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import type { CampaignPreview as Preview } from "@/lib/panel/marketing/campaigns";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

export type CampaignPreviewRequest = {
  id: number | null;
  discountPercent: number | null;
  productIds: number[];
  categoryIds: number[];
  customerGroupIds: number[];
  schedule: { startsAt: string | null; endsAt: string | null };
  priority: number | null;
};

type View = { status: "idle" | "loading" } | { status: "ready"; preview: Preview } | { status: "error"; message: string };

const volume = (ml: number | null) => (!ml ? null : ml >= 1000 ? `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(ml / 1000)} L` : `${ml} ml`);

export default function CampaignPreview({ request, badgeText }: { request: CampaignPreviewRequest; badgeText: string }) {
  const [view, setView] = useState<View>({ status: "idle" });
  const [last, setLast] = useState<Preview | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(request);
  const percentValid = request.discountPercent != null && request.discountPercent >= 1 && request.discountPercent <= 90;

  useEffect(() => {
    if (!percentValid) return;
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      setView({ status: "loading" });
      previewCampaignAction(JSON.parse(key))
        .then((result: CampaignPreviewResult) => {
          if (mine !== seq.current) return;
          if (result.ok) {
            setLast(result.preview);
            setView({ status: "ready", preview: result.preview });
          } else {
            setView({ status: "error", message: result.error });
          }
        })
        .catch(() => {
          if (mine === seq.current) setView({ status: "error", message: "Önizleme alınamadı. Bağlantınızı kontrol edin." });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [key, percentValid]);

  const preview = view.status === "ready" ? view.preview : last;
  const loading = view.status === "loading" || (view.status === "idle" && percentValid);
  const grouped = request.customerGroupIds.length > 0;

  return (
    <section aria-labelledby="campaign-preview-title" className="min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="campaign-preview-title" className="text-sm font-semibold text-text">
            Etkilenen fiyatlar
          </h2>
          <p className="mt-0.5 text-xs text-text-muted" aria-live="polite">
            {!percentValid
              ? "İndirim oranını girin."
              : preview
                ? `${preview.everything ? "Tüm ürünler · " : ""}${formatNumber(preview.productCount)} ürün, ${formatNumber(preview.variantCount)} varyant`
                : "Hesaplanıyor…"}
          </p>
        </div>
        {loading && percentValid ? <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" /> : null}
      </header>

      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-text-muted">Vitrinde rozet</p>
          {grouped ? (
            <p className="mt-2 flex items-start gap-2 text-xs text-text-muted">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Müşteri grubu seçili: vitrinde rozet ve indirimli fiyat gösterilmez; indirim yalnızca bu gruptaki müşterilerin sepetinde uygulanır.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="inline-flex max-w-full items-center rounded-full bg-gold px-3 py-1 text-[0.6875rem] font-medium uppercase leading-tight tracking-[0.12em] text-gold-contrast">
                <span className="truncate">{badgeText}</span>
              </span>
              {percentValid ? (
                <span className="text-xs text-text-muted">
                  Örnek: <s className="tabular-nums">{formatPrice(14990, "tr")}</s>{" "}
                  <span className="font-medium tabular-nums text-text">{formatPrice(campaignDisplayPrice({ price: 14990 }, request.discountPercent).unitPrice, "tr")}</span>
                </span>
              ) : null}
            </div>
          )}
        </div>

        {view.status === "error" ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-xs text-text">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[#B5730C]" />
            {view.message}
          </p>
        ) : null}

        {preview && preview.overriddenProductCount > 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-xs text-text">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[#B5730C]" />
            {formatNumber(preview.overriddenProductCount)} üründe aynı dönemde daha öncelikli bir kampanya var; o ürünlerde diğer kampanya uygulanır.
          </p>
        ) : null}

        {preview && preview.rows.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <PackageSearch aria-hidden className="size-6 text-text-muted" strokeWidth={1.5} />
            <p className="mt-2 text-sm text-text">Satışta olan eşleşen ürün yok.</p>
            <p className="mt-1 max-w-xs text-xs text-text-muted">Seçili ürünler taslak veya arşivde olabilir; yalnızca yayındaki ürünlerin fiyatı değişir.</p>
          </div>
        ) : null}

        {preview && preview.rows.length > 0 ? (
          <div className={cn("transition-opacity", loading && "opacity-60")}>
            <ul className="-mx-5 max-h-[28rem] divide-y divide-border overflow-y-auto border-y border-border" aria-label="Etkilenen varyantlar">
              {preview.rows.map((row) => (
                <li key={row.variantId} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text">
                      {row.productName}
                      {volume(row.volumeMl) ? <span className="text-text-muted"> · {volume(row.volumeMl)}</span> : null}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                      <span className="font-mono">{row.sku}</span>
                      {row.businessOnly ? <Badge size="sm">Kurumsal</Badge> : null}
                      {row.overriddenBy ? (
                        <Badge size="sm" tone="warning" title={`Öncelikli kampanya: ${row.overriddenBy.name}`}>
                          {row.overriddenBy.name} ({formatPercentOff(row.overriddenBy.percent, "tr")}) geçerli
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <p className={cn("flex shrink-0 items-center gap-1.5 text-sm tabular-nums", row.overriddenBy && "opacity-60")}>
                    <s className="text-xs text-text-muted">{formatPrice(row.oldPrice, "tr")}</s>
                    <ArrowRight aria-hidden className="size-3 text-text-muted" />
                    <span className="sr-only">yeni fiyat</span>
                    <span className="font-medium text-text">{formatPrice(row.newPrice, "tr")}</span>
                  </p>
                </li>
              ))}
            </ul>
            {preview.truncated ? (
              <p className="pt-3 text-xs text-text-muted">İlk {formatNumber(preview.rows.length)} varyant gösteriliyor; kampanya {formatNumber(preview.variantCount)} varyantın tamamına uygulanır.</p>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-text-muted">
          Fiyatlar perakende fiyatıdır ve sepetle aynı şekilde kuruşa yuvarlanır. Kurumsal grup ve adet indirimleri sepette kampanyayla birlikte uygulanır.
        </p>
      </div>
    </section>
  );
}
