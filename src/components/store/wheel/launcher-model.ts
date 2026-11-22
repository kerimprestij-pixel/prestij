// What the floating wheel control shows (pure: unit-tested; WheelLauncher renders it).
//   "teaser"    the pill "Hediye çarkını çevir" (or the guest's held prize)
//   "collapsed" the small gift icon (after closing the dialog or minimizing the teaser)
//   "chip"      "Hediyeniz bekliyor · 2g 03:14" for a signed-in visitor with a live, unused prize
//   "none"      nothing
import { heldPrize, isChipHidden, isPrizeLive, isTeaserHidden, type WheelDialogData, type WheelStore } from "./wheel-storage";

export type LauncherMode = "none" | "teaser" | "collapsed" | "chip";

export type LauncherInput = {
  signedIn: boolean;
  /** The loaded wheel (signed-in visitors load it first; guests when they open the dialog). */
  data: WheelDialogData | null;
  store: WheelStore;
  /** Epoch ms of the last tick; 0 until the teaser delay has passed (nothing shows before that). */
  now: number;
  /** The current page may show the wheel (route rules and the page check). */
  routeOk: boolean;
  /** The campaign is inside its schedule on the client clock. */
  inSchedule: boolean;
};

export function launcherMode(input: LauncherInput): LauncherMode {
  const { signedIn, data, store, now, routeOk, inSchedule } = input;
  if (!routeOk || now <= 0) return "none";
  const state = data?.state ?? null;
  if (signedIn) {
    // The server is asked first: staff, business, already claimed, ordered before… all come back here.
    if (!state) return "none";
    if (isPrizeLive(state.activePrize, now)) return isChipHidden(store, now) ? "none" : "chip";
    if (!state.eligible && !state.spin) return "none";
  } else if (state && !state.eligible && !state.spin) {
    return "none"; // learned when the guest opened the dialog (limit reached, campaign closed…)
  }
  if (!inSchedule) return "none";
  if (isTeaserHidden(store, now)) return "none";
  return store.collapsed ? "collapsed" : "teaser";
}

/** The prize the teaser shows instead of its call to action: a won, unclaimed spin (server state first, then the device hint). */
export function teaserPrizeLabel(input: Pick<LauncherInput, "signedIn" | "data" | "store" | "now">): string | null {
  const spin = input.data?.state?.spin;
  if (spin) return spin.prize.label;
  if (input.signedIn) return null;
  return heldPrize(input.store, input.now)?.label ?? null;
}
