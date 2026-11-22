// The product page's subscription offer (pure): built on the server from cached reads and handed to
// the client island, so the page stays static.
import type { SubscriptionOffer } from "@/components/store/subscription/SubscriptionChoice";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import type { Messages } from "@/i18n/messages";
import type { Settings } from "@/lib/settings/types";
import type { StorefrontPlan } from "./types";

type OfferProduct = {
  type: string;
  allowSubscription: boolean;
  campaign: { percent: number } | null;
  variants: { id: number; price: number; compareAtPrice: number | null }[];
};

/** The offer for a product, or null when the product, the shop or the plans do not offer one. */
export function subscriptionOffer(
  product: OfferProduct,
  plans: readonly StorefrontPlan[],
  settings: Pick<Settings<"subscriptions">, "enabled" | "reminderDaysBefore">,
  messages: Messages,
  locale: Locale,
): SubscriptionOffer | null {
  if (!settings.enabled || !product.allowSubscription || product.type === "sample" || plans.length === 0 || product.variants.length === 0) return null;
  const m = messages.subscriptions.choice;
  return {
    plans: plans.map((p) => ({ id: p.id, name: localize(p.name, locale), percent: p.percent })),
    variants: product.variants.map((v) => ({ id: v.id, price: v.price, compareAtPrice: v.compareAtPrice })),
    campaignPercent: product.campaign?.percent ?? null,
    reminderDays: settings.reminderDaysBefore,
    labels: { ...m, regularPrice: messages.campaign.regularPrice },
  };
}
