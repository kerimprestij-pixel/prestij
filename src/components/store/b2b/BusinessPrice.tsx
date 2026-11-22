"use client";
// "Kurumsal fiyatınız: …" on the static product page (client island). Follows the selected variant;
// renders nothing for signed-out visitors, retail buyers and before the viewer has loaded, so the
// static page never shifts for them. The price is the cart's own unit price for this buyer.
import { BadgeCheck } from "lucide-react";
import { useVariantSelection } from "@/components/store/VariantContext";
import type { Locale } from "@/i18n/locales";
import { usePersonalPrices } from "./personal-prices";

export default function BusinessPrice({ variantIds, locale, regularPriceLabel }: { variantIds: number[]; locale: Locale; regularPriceLabel: string }) {
  const { selectedId } = useVariantSelection();
  const prices = usePersonalPrices("variant", variantIds, locale);
  const view = prices.get(selectedId ?? variantIds[0] ?? -1);
  if (!view) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-gold/45 bg-gold/[0.07] px-5 py-4 dark:bg-gold/[0.09]"
    >
      <p className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-gold-text">
        <BadgeCheck aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
        {view.label}
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-heading text-3xl tabular-nums text-text md:text-[2.1rem]">{view.price}</span>
        {view.vatNote && <span className="text-xs uppercase tracking-[0.12em] text-text-muted">{view.vatNote}</span>}
        <s className="text-sm tabular-nums text-text-muted">
          <span className="sr-only">{regularPriceLabel}: </span>
          {view.retailPrice}
        </s>
      </p>
      {view.grossNote && <p className="mt-1 text-xs tabular-nums text-text-muted">{view.grossNote}</p>}
    </div>
  );
}
