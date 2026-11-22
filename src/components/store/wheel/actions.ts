"use server";
// The island's one lazy request: the visitor's wheel state (WHEEL-SERVER's loadWheel) plus the dialog
// and reminder texts from the panel-overridable dictionary, in a single round trip. Static pages ship
// none of these strings; they arrive only when the wheel is about to show. Public POST endpoint: the
// locale is validated here, loadWheel reads the session itself.
import { z } from "zod";
import { LOCALES } from "@/i18n/locales";
import { getMessages } from "@/i18n/get-messages";
import { safeErrorInfo } from "@/lib/db-errors";
import { loadWheel } from "@/lib/wheel/actions";
import { wheelDialogLabels } from "./labels";
import type { WheelDialogData } from "./wheel-storage";

const input = z.object({ locale: z.enum(LOCALES).catch("tr") }).catch({ locale: "tr" });

/** State + texts for `locale`. A failing state read comes back as `state: null` (the dialog says "try again later"). */
export async function loadWheelDialog(raw: { locale: string }): Promise<WheelDialogData> {
  const { locale } = input.parse(raw);
  const [messages, state] = await Promise.all([
    getMessages(locale),
    loadWheel({ locale }).catch((error: unknown) => {
      console.error("[wheel] loadWheel failed", safeErrorInfo(error));
      return null;
    }),
  ]);
  return { state, labels: wheelDialogLabels(messages) };
}
