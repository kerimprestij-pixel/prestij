// The HTTP side of the provider callbacks (standard Request → Response, no Next APIs), shared by the
// route handlers in src/app/api/payments/** and the DB tests.
import "server-only";
import { clientIpFrom } from "@/lib/rate-limit";
import { consumeLimits } from "@/lib/rate-limit-store";
import { handleIyzicoCallback, handlePaytrNotify, type PaytrNotifyOptions } from "./callbacks";

/** Provider callbacks are small forms; anything bigger is not from them. */
const MAX_BODY_BYTES = 16 * 1024;
/** iyzico callbacks come from the buyer's browser, and each one makes us call iyzico: cap them per IP. */
const IYZICO_CALLBACK_RULE = { limit: 30, windowMs: 10 * 60_000 } as const;

const tooLarge = (request: Request) => Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES;

/**
 * The posted fields. `untypedAsForm` (PayTR's notification, PayTR-fix C13b): a body without any Content-Type is
 * read as application/x-www-form-urlencoded (PayTR's samples read $_POST, i.e. a form), at most MAX_BODY_BYTES.
 */
async function formFields(request: Request, { untypedAsForm = false }: { untypedAsForm?: boolean } = {}): Promise<Record<string, string> | null> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (!type.trim() && untypedAsForm) {
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY_BYTES) return null;
      const fields: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(new TextDecoder().decode(body))) if (key.length <= 64) fields[key] = value.slice(0, 2000);
      return fields;
    }
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      for (const [key, value] of form.entries()) if (typeof value === "string" && key.length <= 64) fields[key] = value.slice(0, 2000);
      return fields;
    }
    if (type.includes("application/json")) {
      const data = (await request.json()) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) if ((typeof value === "string" || typeof value === "number") && key.length <= 64) fields[key] = String(value).slice(0, 2000);
      return fields;
    }
  } catch {
    return null;
  }
  return null;
}

const noStore = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/payments/iyzico/callback?o=<order number> (form field `token`, from the buyer's browser):
 * always a 303 to a storefront page (relative Location, so it works behind any host name).
 */
export async function iyzicoCallbackResponse(request: Request, options: { effects?: boolean } = {}): Promise<Response> {
  if (tooLarge(request)) return new Response("Payload too large", { status: 413, headers: noStore });
  const ip = clientIpFrom(request.headers);
  const decision = await consumeLimits([[`paycb:ip:${ip}`, IYZICO_CALLBACK_RULE]]);
  if (!decision.allowed) {
    return new Response("Too many requests", { status: 429, headers: { ...noStore, "Retry-After": String(Math.max(1, decision.retryAfterMinutes) * 60) } });
  }
  const fields = (await formFields(request)) ?? {};
  const orderNumber = new URL(request.url).searchParams.get("o");
  const result = await handleIyzicoCallback({ token: fields.token, orderNumber }, options);
  return new Response(null, { status: 303, headers: { ...noStore, Location: result.redirectTo, "Referrer-Policy": "no-referrer" } });
}

/**
 * POST /api/payments/paytr/notify (PayTR server-to-server): plain-text "OK" when handled. A body we cannot read is
 * logged only (PayTR-fix R5): it names no merchant_oid, so it cannot be told apart from a stranger's POST, and PayTR
 * posts a form, which is read with or without a Content-Type. The panel warning counts refusals that name one of our
 * stored attempts (callbacks.ts notePaytrNotifyRefusal).
 */
export async function paytrNotifyResponse(request: Request, options: PaytrNotifyOptions = {}): Promise<Response> {
  const text = (body: string, status: number) => new Response(body, { status, headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });
  if (tooLarge(request)) return text("PAYTR notification failed: too large", 413);
  const fields = await formFields(request, { untypedAsForm: true });
  if (!fields) {
    console.warn(`[payments] paytr notify refused: unreadable body (content-type ${(request.headers.get("content-type") ?? "none").slice(0, 60)})`);
    return text("PAYTR notification failed: bad request", 400);
  }
  const result = await handlePaytrNotify(fields, options);
  return text(result.body, result.status);
}
