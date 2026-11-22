"use server";
// The fake 3-D Secure page's buttons. Everything is checked by core simulateCardPayment (simulator
// flag, order token, pending status, amount); it then redirects to the order page.

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import { simulateCardPayment } from "@/lib/payments";

const str = (value: FormDataEntryValue | null, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

export async function simulatePaymentAction(formData: FormData): Promise<void> {
  const rawLocale = formData.get("locale");
  const locale = isLocale(rawLocale) ? rawLocale : "tr";
  const orderNumber = str(formData.get("order"), 32);
  const token = str(formData.get("t"), 64);
  const outcome = formData.get("outcome") === "success" ? "success" : "failure";

  const result = await simulateCardPayment({ orderNumber, token, outcome, locale });
  // No order page to go to (simulator off, unknown order): back to the simulator, which explains why.
  const fallback = `${href(locale, "paymentSimulator")}?${new URLSearchParams({ order: orderNumber, t: token }).toString()}`;
  // Clears this browser's router cache: Back must not restore the pre-payment simulator or the
  // "payment failed" order page for an order that is now paid.
  refresh();
  redirect(result.redirectTo ?? fallback);
}
