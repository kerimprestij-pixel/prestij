"use server";
// /hesap/kurumsal: the business account application. Signed-in customers only (re-checked here: the
// proxy gate is optimistic). zod on the server, a honeypot, durable limits (5 accepted applications
// per account per day, 10 per IP per hour; only accepted ones count). The service creates a `pending`
// company for the caller's own account; nothing here can approve it or pick a group or terms.

import { redirect } from "next/navigation";
import { db } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { href, signInHref } from "@/i18n/paths";
import { businessFormDataToInput, validateBusinessApplication } from "@/lib/b2b/application";
import { submitBusinessApplication, type ApplicationFailure } from "@/lib/b2b/service";
import { safeErrorInfo } from "@/lib/db-errors";
import type { LimitEntry } from "@/lib/rate-limit";
import { checkLimits, consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";
import { getSession } from "@/lib/session";
import type { BusinessFormState } from "./state";

const RULES = {
  user: { limit: 5, windowMs: 24 * 60 * 60_000 },
  ip: { limit: 10, windowMs: 60 * 60_000 },
} as const;

function limitKeys(userId: string, ip: string): LimitEntry[] {
  return [
    [`business:user:${userId}`, RULES.user],
    [`business:ip:${ip}`, RULES.ip],
  ];
}

const FAILURE_KEY: Record<ApplicationFailure, "closed" | "alreadyPending" | "alreadyApproved" | "staff" | "server"> = {
  closed: "closed",
  already_pending: "alreadyPending",
  already_approved: "alreadyApproved",
  staff: "staff",
  not_found: "server",
  not_verified: "server",
};

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && key !== "fax" && key.length <= 40) out[key] = value.slice(0, 2000);
  }
  return out;
}

export async function submitBusinessApplicationAction(prev: BusinessFormState, formData: FormData): Promise<BusinessFormState> {
  const rawLocale = formData.get("locale");
  const locale: Locale = typeof rawLocale === "string" && isLocale(rawLocale) ? rawLocale : "tr";
  const page = href(locale, "accountBusiness");
  const attempt = (prev?.attempt ?? 0) + 1;

  const session = await getSession();
  if (!session?.user?.id || session.user.banned) redirect(signInHref(locale, page));
  const userId = session.user.id;

  const m = (await getMessages(locale)).b2b.account.errors;
  const values = echo(formData);

  // Honeypot: people never see the field; a bot that fills it gets the same "received" page and no row.
  const trap = formData.get("fax");
  if (typeof trap === "string" && trap.trim() !== "") redirect(`${page}?gonderildi=1`);

  const ip = await clientIp();
  const blocked = await checkLimits(limitKeys(userId, ip));
  if (!blocked.allowed) {
    return { status: "error", attempt, formError: format(m.tooMany, { minutes: Math.max(1, blocked.retryAfterMinutes) }, locale), values };
  }

  const parsed = validateBusinessApplication(businessFormDataToInput(formData));
  if (!parsed.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const [path, code] of Object.entries(parsed.fieldErrors)) fieldErrors[path] = m[code] ?? m.invalid;
    return { status: "error", attempt, formError: m.summary, fieldErrors, values };
  }

  let result: Awaited<ReturnType<typeof submitBusinessApplication>>;
  try {
    result = await db.transaction((tx) => submitBusinessApplication(tx, { ...parsed.data, locale }, { userId }));
  } catch (error) {
    console.error("[b2b] application failed", safeErrorInfo(error));
    return { status: "error", attempt, formError: m.server, values };
  }
  if (!result.ok) return { status: "error", attempt, formError: m[FAILURE_KEY[result.code]], values };

  await consumeLimits(limitKeys(userId, ip)).catch((error: unknown) => console.error("[b2b] limit count failed", safeErrorInfo(error)));
  redirect(`${page}?gonderildi=1`);
}
