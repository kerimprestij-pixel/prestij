// The wheel's UI strings, picked from the (panel-overridable) dictionary. Pure: safe on both sides.
//   wheelTeaserLabels → the few strings the layout passes to the island (serialized into every page:
//                       keep them minimal)
//   wheelDialogLabels → everything the dialog and the reminder chip need; arrives with the lazy
//                       loadWheelDialog answer, so static pages ship none of it
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

export type WheelTeaserLabels = {
  /** The teaser button text (the panel's teaser text when set, else the dictionary's). */
  label: string;
  /** Accessible name of the minimized gift icon ("Hediye çarkını aç"). */
  open: string;
  /** The teaser's minimize button. */
  hide: string;
  /** Group name of the minimized icon and its close button. */
  collapsed: string;
  neverShow: string;
};

export function wheelTeaserLabels(messages: Messages, teaserText: string | null): WheelTeaserLabels {
  const t = messages.wheel.teaser;
  return { label: teaserText || t.label, open: t.open, hide: t.hide, collapsed: t.collapsed, neverShow: t.neverShow };
}

type W = Messages["wheel"];

export type WheelDialogLabels = {
  dialog: W["dialog"];
  result: W["result"];
  claim: W["claim"];
  chip: W["chip"];
  countdown: W["countdown"];
  errors: W["errors"];
  /** "(yeni sekmede açılır)" for the terms and privacy links. */
  opensInNewTab: string;
};

export function wheelDialogLabels(messages: Messages): WheelDialogLabels {
  const w = messages.wheel;
  return {
    dialog: w.dialog,
    result: w.result,
    claim: w.claim,
    chip: w.chip,
    countdown: w.countdown,
    errors: w.errors,
    opensInNewTab: messages.common.opensInNewTab,
  };
}

/**
 * Used only when the wheel could not be loaded at all (offline): the dictionary texts come with the
 * loaded wheel. A unit test keeps these equal to the dictionary defaults (wheel.dialog.close,
 * wheel.errors.network).
 */
export const WHEEL_DIALOG_FALLBACK: Record<Locale, { close: string; network: string }> = {
  tr: { close: "Kapat", network: "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin." },
  en: { close: "Close", network: "Could not connect. Please check your internet connection and try again." },
  ar: { close: "إغلاق", network: "تعذّر الاتصال. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى." },
};
