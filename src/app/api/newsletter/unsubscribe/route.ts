// RFC 8058 one-click unsubscribe: the List-Unsubscribe header of every campaign points here
// (POST /api/newsletter/unsubscribe?t=<signed token>, body "List-Unsubscribe=One-Click"). Mail
// providers call it server to server, so there is no login, no CSRF token and no redirect; the
// signed token is the credential. GET (a person opening the URL) is sent to the confirmation page
// instead, because link scanners must never unsubscribe anyone. Rate-limited per client IP.
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isLocale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";
import { safeErrorInfo } from "@/lib/db-errors";
import { readNewsletterUnsubscribeToken } from "@/lib/email";
import { unsubscribeNewsletter } from "@/lib/newsletter/service";
import { consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8" };
const LINK_RULE = { limit: 30, windowMs: 60 * 60_000 } as const;

async function tokenFrom(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("t");
  if (fromQuery) return fromQuery.slice(0, 2048);
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const t = form.get("t");
      return typeof t === "string" ? t.slice(0, 2048) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const ip = await clientIp();
  const decision = await consumeLimits([[`newsletter-link:ip:${ip}`, LINK_RULE]]);
  if (!decision.allowed) {
    return new Response("Too many requests", { status: 429, headers: { ...HEADERS, "Retry-After": String(decision.retryAfterMinutes * 60) } });
  }
  const token = await tokenFrom(request);
  try {
    const result = await db.transaction((tx) => unsubscribeNewsletter(tx, token));
    if (!result.ok) return new Response("Invalid link", { status: 400, headers: HEADERS });
    return new Response("Unsubscribed", { status: 200, headers: HEADERS });
  } catch (error) {
    console.error("[newsletter] one-click unsubscribe failed", safeErrorInfo(error));
    return new Response("Error", { status: 500, headers: HEADERS });
  }
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t")?.slice(0, 2048) ?? "";
  let locale: "tr" | "en" | "ar" = "tr";
  const id = readNewsletterUnsubscribeToken(token);
  if (id != null) {
    try {
      const [row] = await db
        .select({ locale: schema.newsletterSubscribers.locale })
        .from(schema.newsletterSubscribers)
        .where(eq(schema.newsletterSubscribers.id, id))
        .limit(1);
      if (row && isLocale(row.locale)) locale = row.locale;
    } catch (error) {
      console.error("[newsletter] unsubscribe locale lookup failed", safeErrorInfo(error));
    }
  }
  // The public site origin (request.url may carry the internal host behind a proxy).
  const target = absoluteUrl(`${href(locale, "newsletterUnsubscribe")}${token ? `?t=${encodeURIComponent(token)}` : ""}`);
  return Response.redirect(target, 303);
}
