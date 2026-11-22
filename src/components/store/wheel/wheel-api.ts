// The three server calls of the wheel UI behind one small interface (the launcher and the dialog use
// `useWheelApi()`; the default is the real thing, a provider can swap it in tests or a local preview):
//   load  → loadWheelDialog Server Action (state + texts, one round trip)
//   spin  → POST /api/wheel/spin (Route Handler: sets the httpOnly spin cookie without re-rendering the page)
//   claim → claimWheel Server Action (signed-in visitors)
// Imported only by the lazy chunks, never by the first-load island.
import { createContext, useContext } from "react";
import type { Locale } from "@/i18n/config";
import { claimWheel } from "@/lib/wheel/actions";
import type { WheelClaimResult, WheelSpinRequest, WheelSpinResponse } from "@/lib/wheel/types";
import { loadWheelDialog } from "./actions";
import { readSpinResponse, spinFailure } from "./spin-response";
import type { WheelDialogData } from "./wheel-storage";

export type WheelApi = {
  load(locale: Locale): Promise<WheelDialogData>;
  spin(body: WheelSpinRequest): Promise<WheelSpinResponse>;
  claim(locale: Locale): Promise<WheelClaimResult>;
};

async function postSpin(body: WheelSpinRequest): Promise<WheelSpinResponse> {
  let response: Response;
  try {
    response = await fetch("/api/wheel/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return spinFailure("network");
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Not JSON (an error page): decided by the status below.
  }
  return readSpinResponse(json, response.status);
}

export const realWheelApi: WheelApi = {
  load: (locale) => loadWheelDialog({ locale }),
  spin: postSpin,
  claim: (locale) => claimWheel({ locale }),
};

export const WheelApiContext = createContext<WheelApi>(realWheelApi);

export function useWheelApi(): WheelApi {
  return useContext(WheelApiContext);
}
