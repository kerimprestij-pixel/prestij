"use client";
// "Kurumsal: …" under the retail price on product cards (client island). All cards of a page share one
// Server Action call (personal-prices.ts); nothing renders for signed-out or retail visitors.
import type { Locale } from "@/i18n/locales";
import { usePersonalPrices } from "./personal-prices";

export default function BusinessCardPrice({ productId, locale, fromLabel }: { productId: number; locale: Locale; fromLabel: string }) {
  const prices = usePersonalPrices("product", [productId], locale);
  const view = prices.get(productId);
  if (!view) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium text-gold-text">
      {view.hasRange && <span className="text-[0.6875rem] uppercase tracking-[0.12em]">{fromLabel}</span>}
      <span className="tabular-nums">{view.text}</span>
      {view.vatNote && <span className="text-[0.6875rem] font-normal uppercase tracking-[0.1em] text-text-muted">{view.vatNote}</span>}
    </p>
  );
}
