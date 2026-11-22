// Free-shipping progress (message + hairline bar) and the heavy-parcel note. The message and the
// 0..1 progress come from the CartView; the bar itself is decorative (the text says it all).
import { PackageCheck, Truck, Weight } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { CartView } from "@/lib/cart/view";
import { cn } from "@/lib/utils";

type Props = {
  view: CartView;
  locale: Locale;
  heavyNote: string;
  /** Dim while totals are being recomputed. */
  pending?: boolean;
  className?: string;
};

export default function FreeShippingProgress({ view, locale, heavyNote, pending = false, className }: Props) {
  const { shipping, totals } = view;
  const heavy = totals.shippingHeavy.amount > 0;
  if (!shipping.message && !heavy) return null;
  const progress = shipping.free ? 1 : (shipping.progress ?? 0);
  const Icon = shipping.free ? PackageCheck : Truck;

  return (
    <div className={cn("flex flex-col gap-3 transition-opacity duration-300", pending && "opacity-60", className)}>
      {shipping.message ? (
        <div>
          <p className="flex items-center gap-2.5 text-sm text-text">
            <Icon aria-hidden className={cn("size-4 shrink-0", shipping.free ? "text-gold-text dark:text-gold" : "text-text-muted")} strokeWidth={1.5} />
            <span>{shipping.message}</span>
          </p>
          {shipping.progress != null ? (
            <div aria-hidden className="mt-3 h-[3px] overflow-hidden rounded-full bg-border">
              <div
                className="h-full origin-left rounded-full bg-gold transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none rtl:origin-right"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {heavy ? (
        <p className="flex items-start gap-2.5 text-xs leading-relaxed text-text-muted">
          <Weight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.5} />
          <span>{format(heavyNote, { kg: shipping.heavyKg, amount: totals.shippingHeavy.label }, locale)}</span>
        </p>
      ) : null}
    </div>
  );
}
