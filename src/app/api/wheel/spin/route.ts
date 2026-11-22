// POST /api/wheel/spin: spins the gift wheel for the visitor. JSON body WheelSpinRequest, answer
// WheelSpinResponse (src/lib/wheel/types.ts). A Route Handler (not a Server Action) because it sets the
// httpOnly spin cookie `prestij_wheel`, and a cookie write in a Server Action would re-render the page.
//   1. same-origin only (our island), small JSON body, valid locale; honeypot filled → refused;
//   2. configuration read uncached; every rule of contract §1.1 (off, schedule, staff, business,
//      audience, one prize per account per round, one spin per visitor);
//   3. a visitor who already holds a spin gets the SAME result again (repeated: true), never a re-spin;
//   4. otherwise the durable per-IP spin limit (wheel:ip:<address>, 3 per 24 h, IPv6 by /64: D13; counted
//      on the spin's own transaction: SEC-1), then the server alone picks the slice (crypto.randomInt, weighted) and stores
//      the spin (a signed-in account's is bound at once). Steps 2-4: spinWheel (src/lib/wheel/service.ts);
//   5. the cookie points at the spin until the end of its hold.
// Status: 200 ok · 400 invalid body · 403 cross-origin, honeypot or refused (reason in `error`) · 429 spin limit ·
// 503 unavailable (server problem).
// /api/ is outside the proxy matcher (no locale redirect, no body buffering).
import { db } from "@/db";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { LOCALES } from "@/i18n/locales";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { safeErrorInfo } from "@/lib/db-errors";
import { getSession } from "@/lib/session";
import { readWheelSpinId, writeWheelSpinCookie } from "@/lib/wheel/cookie";
import { requestIp } from "@/lib/wheel/hooks";
import { prizeView } from "@/lib/wheel/prize";
import { canonicalWheelPath, isSameOriginRequest } from "@/lib/wheel/request";
import { holdUntilOf, isSpinPendingVerification, readWheelConfig, spinWheel } from "@/lib/wheel/service";
import { WHEEL_HONEYPOT_FIELD, wheelSpinRequestSchema, type WheelErrorCode, type WheelSpinResponse } from "@/lib/wheel/types";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
/** The body is a locale, a path and an empty honeypot: anything bigger is not our island. */
const MAX_BODY_BYTES = 4096;

const STATUS: Partial<Record<WheelErrorCode, number>> = { invalid_request: 400, spin_limit: 429, rate_limited: 429, unavailable: 503 };

async function refuse(locale: Locale, error: WheelErrorCode, options: { retryAfterSeconds?: number; status?: number } = {}): Promise<Response> {
  const { retryAfterSeconds } = options;
  const messages = await getMessages(locale);
  const body: WheelSpinResponse = { ok: false, error, message: messages.wheel.errors[error], ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
  return Response.json(body, {
    status: options.status ?? STATUS[error] ?? 403,
    headers: retryAfterSeconds ? { ...HEADERS, "Retry-After": String(retryAfterSeconds) } : HEADERS,
  });
}

/** The locale of a body that failed validation, for the error message (Turkish otherwise). */
function looseLocale(body: unknown): Locale {
  const value = (body as { locale?: unknown } | null)?.locale;
  return (LOCALES as readonly string[]).includes(value as string) ? (value as Locale) : "tr";
}

/** The JSON body, read at most MAX_BODY_BYTES (a bigger or chunked oversize body is dropped unread). */
async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) return refuse("tr", "invalid_request", { status: 403 });
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return refuse("tr", "invalid_request");
  }
  const parsed = wheelSpinRequestSchema.safeParse(body);
  if (!parsed.success) return refuse(looseLocale(body), "invalid_request");
  const { locale } = parsed.data;
  // A bot filled the hidden field: answered like a closed wheel, nothing stored or counted.
  if ((parsed.data[WHEEL_HONEYPOT_FIELD] ?? "").trim() !== "") return refuse(locale, "unavailable", { status: 403 });

  try {
    const now = new Date();
    const [config, session, cookieSpinId, ip] = await Promise.all([readWheelConfig(db), getSession(), readWheelSpinId(), requestIp()]);
    const userId = session?.user?.id ?? null;
    const commerce = userId ? await loadCommerceSettings() : undefined;

    const decision = await db.transaction((tx) =>
      spinWheel(tx, { config, userId, cookieSpinId, ip, locale, pagePath: canonicalWheelPath(parsed.data.path), now, commerce }),
    );

    if (decision.kind === "refused") return refuse(locale, decision.error, { retryAfterSeconds: decision.retryAfterSeconds });
    const { spin } = decision;
    const holdUntil = holdUntilOf(spin, config.wheel);
    await writeWheelSpinCookie(spin.id, holdUntil, now);
    const m = (await getMessages(locale)).wheel;
    const response: WheelSpinResponse = {
      ok: true,
      sliceIndex: decision.sliceIndex,
      prize: prizeView(spin.prize, { validityHours: config.wheel.validityHours, heavySurcharge: config.heavySurcharge }, locale, m),
      holdUntil: holdUntil.toISOString(),
      claim: decision.signedIn ? "claim" : "register",
      ...(isSpinPendingVerification(spin, decision.signedIn) ? { pending: true } : {}),
      repeated: decision.repeated,
    };
    return Response.json(response, { status: 200, headers: HEADERS });
  } catch (error) {
    console.error("[wheel] spin failed", safeErrorInfo(error));
    return refuse(locale, "unavailable");
  }
}
