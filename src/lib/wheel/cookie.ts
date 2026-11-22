// The visitor's spin cookie: httpOnly `prestij_wheel` = signToken("wheel-spin", { id }, ttl), where the ttl
// is what is left of the spin's hold (at most holdDays days). Signed (never trust an id from the client)
// and short-lived like the hold itself. Read/written only in Route Handlers and Server Actions (setting a
// cookie in a Server Action re-renders the current page, so the actions avoid writing it: only the spin
// route sets it, a sign-in that claimed the spin clears it).
import "server-only";
import { cookies } from "next/headers";
import { signToken, verifyToken } from "@/lib/signed-token";
import { WHEEL_COOKIE, WHEEL_SPIN_TOKEN_PURPOSE } from "./types";

/** Seconds from `now` to the end of the hold (at least a minute, so a just-made cookie is never born dead). */
export function wheelCookieTtlSeconds(holdUntil: Date, now: Date): number {
  return Math.max(60, Math.ceil((holdUntil.getTime() - now.getTime()) / 1000));
}

/** The cookie value for a spin, valid for `ttlSeconds`. */
export function wheelSpinToken(spinId: number, ttlSeconds: number): string {
  return signToken(WHEEL_SPIN_TOKEN_PURPOSE, { id: spinId }, ttlSeconds);
}

/** The spin id of a valid, unexpired token, or null (forged, malformed, expired). */
export function parseWheelSpinToken(token: unknown): number | null {
  const result = verifyToken<{ id?: unknown }>(WHEEL_SPIN_TOKEN_PURPOSE, token);
  if (!result.ok) return null;
  const id = result.payload.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The visitor's spin id from the cookie, or null. */
export async function readWheelSpinId(): Promise<number | null> {
  try {
    return parseWheelSpinToken((await cookies()).get(WHEEL_COOKIE)?.value);
  } catch {
    return null; // no request scope (scripts) or no secret: no spin
  }
}

/** Points the cookie at `spinId` until the end of its hold. Route Handlers (and Server Actions) only. */
export async function writeWheelSpinCookie(spinId: number, holdUntil: Date, now: Date): Promise<void> {
  const ttl = wheelCookieTtlSeconds(holdUntil, now);
  (await cookies()).set(WHEEL_COOKIE, wheelSpinToken(spinId, ttl), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl,
  });
}

export async function clearWheelSpinCookie(): Promise<void> {
  (await cookies()).delete({ name: WHEEL_COOKIE, path: "/" });
}
