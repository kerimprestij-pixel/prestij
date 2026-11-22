"use client";

// "Tek seferlik / Abone ol" on the product page (static page, client island). Prices come from the
// static page's variant prices through the cart's own rule (subscriptionDisplayPrice →
// resolveUnitPrice), so the amount shown here is what the cart charges a retail buyer for one unit.
// A signed-in buyer with group prices (business) gets the cart engine's own figures instead, through
// the same batched personal-price call as the business price island (one Server Action per page).
import { BellRing, CalendarSync, Info, Repeat } from "lucide-react";
import { useId, type ReactNode } from "react";
import { usePersonalPrices } from "@/components/store/b2b/personal-prices";
import { useVariantSelection } from "@/components/store/VariantContext";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { campaignDisplayPrice } from "@/lib/campaigns/pick";
import { formatPrice } from "@/lib/pricing/money";
import { subscriptionDisplayPrice } from "@/lib/subscriptions/types";
import { cn } from "@/lib/utils";
import { SubscriptionChoiceProvider, useSubscriptionChoice } from "./SubscriptionChoiceContext";

export type SubscriptionChoiceLabels = {
  legend: string;
  oneTime: string;
  subscribe: string;
  /** "Abone ol, %{percent} kazan" */
  subscribeSaving: string;
  frequency: string;
  /** "%{percent} indirim" */
  planSaving: string;
  priceLabel: string;
  campaignBetter: string;
  perks: string;
  /** "Her siparişten {days} gün önce …" */
  reminder: string;
  accountNote: string;
  regularPrice: string;
};

export type SubscriptionChoicePlan = { id: number; name: string; percent: number };

export type SubscriptionOffer = Omit<Parameters<typeof SubscriptionChoice>[0], "locale">;

/**
 * Wraps the add-to-cart button: with an offer it adds the choice above it and shares the chosen plan
 * with the button; without one it renders the button alone (no subscription field is sent).
 */
export function SubscriptionArea({ offer, locale, children }: { offer: SubscriptionOffer | null; locale: Locale; children: ReactNode }) {
  if (!offer) return children;
  return (
    <SubscriptionChoiceProvider>
      <SubscriptionChoice locale={locale} {...offer} />
      {children}
    </SubscriptionChoiceProvider>
  );
}

export default function SubscriptionChoice({
  locale,
  plans,
  variants,
  campaignPercent,
  reminderDays,
  labels,
}: {
  locale: Locale;
  plans: SubscriptionChoicePlan[];
  /** Regular prices of the product's variants (kuruş). */
  variants: { id: number; price: number; compareAtPrice: number | null }[];
  /** The retail campaign running for the product (the cart's choice for a retail buyer), or null. */
  campaignPercent: number | null;
  reminderDays: number;
  labels: SubscriptionChoiceLabels;
}) {
  const { selectedId } = useVariantSelection();
  const { planId, setPlanId } = useSubscriptionChoice();
  const viewer = useViewer();
  const name = useId();
  const personal = usePersonalPrices("variant", variants.map((v) => v.id), locale);
  const variant = variants.find((v) => v.id === selectedId) ?? variants[0];
  if (!variant || plans.length === 0) return null;

  // The default plan when the shopper switches to "subscribe": the best saving, then panel order.
  const best = plans.reduce((a, b) => (b.percent > a.percent ? b : a), plans[0]);
  const chosen = plans.find((p) => p.id === planId) ?? null;
  const subscribing = chosen != null;
  const shownPlan = chosen ?? best;

  const retailOnce = campaignDisplayPrice(variant, campaignPercent);
  const retailSub = subscriptionDisplayPrice(variant, campaignPercent, shownPlan.percent);
  // Group buyers: the cart engine's unit prices (the plan discount applies to their resolved price).
  const mine = personal.get(variant.id);
  const mineSub = mine?.subscriptionUnitPrices?.[shownPlan.id];
  const once = { unitPrice: mine ? mine.unitPrice : retailOnce.unitPrice };
  const sub = mine
    ? { unitPrice: mineSub ?? mine.unitPrice, discount: mineSub != null && mineSub >= mine.unitPrice && shownPlan.percent > 0 ? ("campaign" as const) : ("subscription" as const) }
    : retailSub;
  // The saving claim names the plan whose price is shown, and only when that price really is lower.
  const subscribeTitle =
    shownPlan.percent > 0 && sub.unitPrice < once.unitPrice ? format(labels.subscribeSaving, { percent: shownPlan.percent }, locale) : labels.subscribe;

  const option = (checked: boolean) =>
    cn(
      "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 transition-[border-color,background-color] duration-300",
      "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
      checked ? "border-product bg-product-soft/70" : "border-border hover:border-text/40",
    );
  const dot = (checked: boolean) =>
    cn(
      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
      checked ? "border-product-strong" : "border-text/40",
    );

  return (
    <fieldset className="flex flex-col gap-3" data-subscription-choice>
      <legend className="mb-3 text-xs uppercase tracking-[0.14em] text-text-muted">{labels.legend}</legend>

      <label className={option(!subscribing)}>
        <input type="radio" name={name} className="sr-only" checked={!subscribing} onChange={() => setPlanId(null)} />
        <span aria-hidden className={dot(!subscribing)}>
          {!subscribing ? <span className="size-2 rounded-full bg-product-strong" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm text-text">{labels.oneTime}</span>
          <span className="text-sm tabular-nums text-text">{formatPrice(once.unitPrice, locale)}</span>
        </span>
      </label>

      <div className={cn(option(subscribing), "flex-col items-stretch gap-0")}>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="radio" name={name} className="sr-only" checked={subscribing} onChange={() => setPlanId(best.id)} />
          <span aria-hidden className={dot(subscribing)}>
            {subscribing ? <span className="size-2 rounded-full bg-product-strong" /> : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-sm font-medium text-text">
              <Repeat aria-hidden className="size-3.5 shrink-0 text-product-strong" strokeWidth={1.75} />
              {subscribeTitle}
            </span>
            <span className="flex items-baseline gap-2 tabular-nums">
              {sub.unitPrice < once.unitPrice ? (
                <s className="text-xs text-text-muted">
                  <span className="sr-only">{labels.regularPrice}: </span>
                  {formatPrice(once.unitPrice, locale)}
                </s>
              ) : null}
              <span className="text-sm font-medium text-text">
                <span className="sr-only">{labels.priceLabel}: </span>
                {formatPrice(sub.unitPrice, locale)}
              </span>
            </span>
          </span>
        </label>

        {subscribing ? (
          <div className="mt-4 flex flex-col gap-3 ps-7">
            {plans.length > 1 ? (
              <label className="flex flex-col gap-1.5 text-xs text-text-muted">
                <span className="uppercase tracking-[0.14em]">{labels.frequency}</span>
                <select
                  value={shownPlan.id}
                  onChange={(e) => setPlanId(Number(e.target.value))}
                  className="min-h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.percent > 0 ? `${p.name} · ${format(labels.planSaving, { percent: p.percent }, locale)}` : p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-xs text-text-muted">
                <span className="uppercase tracking-[0.14em]">{labels.frequency}</span> · <span className="text-text">{shownPlan.name}</span>
              </p>
            )}
            <ul className="flex flex-col gap-2 text-xs leading-relaxed text-text-muted">
              <li className="flex items-start gap-2">
                <CalendarSync aria-hidden className="mt-0.5 size-3.5 shrink-0 text-product-strong" strokeWidth={1.5} />
                {labels.perks}
              </li>
              <li className="flex items-start gap-2">
                <BellRing aria-hidden className="mt-0.5 size-3.5 shrink-0 text-product-strong" strokeWidth={1.5} />
                {format(labels.reminder, { days: reminderDays }, locale)}
              </li>
              {sub.discount === "campaign" ? (
                <li className="flex items-start gap-2 text-text">
                  <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-product-strong" strokeWidth={1.5} />
                  {labels.campaignBetter}
                </li>
              ) : null}
              {viewer.ready && !viewer.signedIn ? (
                <li className="flex items-start gap-2 text-text">
                  <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-product-strong" strokeWidth={1.5} />
                  {labels.accountNote}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
