// The JSON answer of POST /api/wheel/spin, checked before the dialog trusts it (pure: unit-tested). A proxy
// error page or a half-deployed route must never crash the dialog: anything malformed becomes a refusal.
import type { WheelErrorCode, WheelSpinResponse } from "@/lib/wheel/types";

export const spinFailure = (error: WheelErrorCode): WheelSpinResponse => ({ ok: false, error, message: "" });

/** Narrows an unknown JSON body to a WheelSpinResponse (a proxy error page or a half-deployed route must not crash the dialog). */
export function readSpinResponse(value: unknown, status: number): WheelSpinResponse {
  if (!value || typeof value !== "object") return spinFailure(status >= 500 ? "unavailable" : "invalid_request");
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    const prize = v.prize as Record<string, unknown> | undefined;
    if (
      typeof v.sliceIndex === "number" &&
      Number.isInteger(v.sliceIndex) &&
      prize &&
      typeof prize.label === "string" &&
      typeof prize.summary === "string" &&
      typeof v.holdUntil === "string" &&
      (v.claim === "claim" || v.claim === "register")
    ) {
      return {
        ok: true,
        sliceIndex: v.sliceIndex,
        prize: { label: prize.label, summary: prize.summary },
        holdUntil: v.holdUntil,
        claim: v.claim,
        repeated: v.repeated === true,
      };
    }
    return spinFailure("unavailable");
  }
  const error = typeof v.error === "string" ? (v.error as WheelErrorCode) : status >= 500 ? "unavailable" : "invalid_request";
  return {
    ok: false,
    error,
    message: typeof v.message === "string" ? v.message : "",
    ...(typeof v.retryAfterSeconds === "number" ? { retryAfterSeconds: v.retryAfterSeconds } : {}),
  };
}
