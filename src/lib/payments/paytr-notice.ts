// When the storefront shows PayTR's contract notice (PayTR-fix IMPL-B, S7). Pure: no environment, no DB.
//
// PayTR's Çerçeve Sözleşme (https://www.paytr.com/on-bilgilendirme) asks the merchant, once card payments run
// through PayTR, to show PayTR's logo where the card logos are on the payment page (Art. 10.2) and to announce
// "… ödeme hizmetleri PAYTR Ödeme ve Elektronik Para Kuruluşu A.Ş. tarafından sağlanmaktadır." with a link to
// https://www.paytr.com (Art. 10.3). The texts are the UI strings footer.paytr.* (owner-editable).
//
// Two places, two rules:
// - The card page (/odeme/kart) shows the notice whenever it shows PayTR's payment form: that page exists only for
//   PayTR, so the statement is true there by construction (in test mode only panel staff reach it, CF-11).
// - The footer is part of every page's static shell (cached reads only), so it uses a rule computable from the
//   cached payments settings plus the deployment's environment: card payments are really offered to customers
//   through PayTR when card is on, the provider is PayTR, the panel's test mode is off (with it on, a live site
//   hides card from customers: cardTestModeHidden, CF-11), PayTR's keys are configured (otherwise the card option
//   shows as unavailable) and the local payment simulator is not standing in for PayTR. The settings part is
//   refreshed by the panel's save (updateTag(TAGS.settings) through getSettings); the environment part changes only
//   with a redeploy, which rebuilds every page.
import type { Settings } from "@/lib/settings/types";

/** PayTR's website, linked from the notice (Art. 10.3 names https://www.PAYTR.com). */
export const PAYTR_WEBSITE_URL = "https://www.paytr.com";

export type PaytrNoticeInput = {
  card: Pick<Settings<"payments">["card"], "enabled" | "provider" | "testMode">;
  /** paytrEnv() !== null: merchant id, key and salt are set (and PAYTR_BASE_URL, if set, is usable). */
  paytrConfigured: boolean;
  /** isSimulatorEnabled(): the local payment simulator takes every card payment instead of a provider. */
  simulator: boolean;
};

/** The footer rule: true while customers can actually pay by card through PayTR. */
export function paytrNoticeInFooter(input: PaytrNoticeInput): boolean {
  const { card } = input;
  return card.enabled && card.provider === "paytr" && !card.testMode && input.paytrConfigured && !input.simulator;
}
