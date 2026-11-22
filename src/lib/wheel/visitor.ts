// The visitor's held spin for the banner on the register and sign-in pages (WHEEL-UI renders it:
// "Çark hediyeniz: %10 indirim — üyeliğinizi tamamlayınca hesabınıza tanımlanır"). Reads the spin cookie, so
// call it only inside <Suspense> after `await connection()` (or in a Server Action / Route Handler).
import "server-only";
import { db } from "@/db";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { readWheelSpinId } from "./cookie";
import { isSpinHeld } from "./eligibility";
import { prizeLabel } from "./prize";
import { findSpin, holdUntilOf, readWheelConfig } from "./service";

export type VisitorWheelBanner = {
  /** Localized prize name, e.g. "%10 indirim" (the banner's {prize}). */
  prize: string;
  /** "spun": show wheel.banner.register / .signIn; "bound": waiting for e-mail verification (wheel.banner.verify). */
  status: "spun" | "bound";
  /** ISO end of the unclaimed hold. */
  holdUntil: string;
};

/** The banner data when the visitor holds an unclaimed spin (wheel switched on), else null. */
export async function getVisitorWheelBanner(locale: Locale): Promise<VisitorWheelBanner | null> {
  try {
    const spinId = await readWheelSpinId();
    if (!spinId) return null;
    const [config, spin] = await Promise.all([readWheelConfig(db), findSpin(db, spinId)]);
    const now = new Date();
    if (!config.wheel.enabled || !spin || !isSpinHeld(spin, config.wheel.holdDays, now)) return null;
    const m = (await getMessages(locale)).wheel;
    return { prize: prizeLabel(spin.prize, locale, m), status: spin.status === "bound" ? "bound" : "spun", holdUntil: holdUntilOf(spin, config.wheel).toISOString() };
  } catch {
    return null;
  }
}
