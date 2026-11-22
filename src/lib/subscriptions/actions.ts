"use server";
// Customer self-service on /hesap/abonelikler. Every action re-reads the session, validates with zod,
// is rate limited per account and changes only the caller's own subscription (anything else answers
// "not found"). The page re-renders through refresh() after a change.
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import type { AddressData } from "@/db/schema/commerce";
import { LOCALES } from "@/db/schema/common";
import { getMessages } from "@/i18n/get-messages";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { safeErrorInfo } from "@/lib/db-errors";
import { CONTROL_CHARS } from "@/lib/orders/checkout-schema";
import { consumeLimits } from "@/lib/rate-limit-store";
import { getSession } from "@/lib/session";
import { findProvince, normalizeTrPhone } from "@/lib/validation/tr";
import { changeSubscription, readSubscriptionSkipToken, type SubscriptionChange } from "./service";

export type SubscriptionActionResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string>; signIn?: boolean };

/** Field error codes are checkout.errors keys (required, too_short, invalid_phone …). */
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, "required")
    .min(min, "too_short")
    .max(max, "too_long")
    .refine((v) => !CONTROL_CHARS.test(v), "invalid");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .refine((v) => !CONTROL_CHARS.test(v), "invalid")
    .optional()
    .transform((v) => v || undefined);

const addressInput = z.object({
  fullName: text(3, 100),
  phone: z.string().trim().transform((v, ctx) => {
    const phone = normalizeTrPhone(v);
    if (!phone) ctx.addIssue({ code: "custom", message: v ? "invalid_phone" : "required" });
    return phone ?? "";
  }),
  city: z.string().trim().transform((v, ctx) => {
    const province = findProvince(v);
    if (!province) ctx.addIssue({ code: "custom", message: v ? "invalid_province" : "required" });
    return province?.name ?? "";
  }),
  district: text(2, 80),
  neighbourhood: optionalText(120),
  line1: text(5, 250),
  postalCode: optionalText(5).refine((v) => v === undefined || /^\d{5}$/.test(v), "invalid_postal_code"),
});

const id = z.coerce.number().int().positive().max(2_147_483_647);
const change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("skip"), token: z.string().max(2048).optional() }),
  z.object({ kind: z.literal("unskip") }),
  z.object({ kind: z.literal("plan"), planId: id }),
  z.object({ kind: z.literal("address"), address: addressInput }),
  z.object({ kind: z.literal("cancel") }),
]);
const inputSchema = z.object({ locale: z.enum(LOCALES), subscriptionId: id, change });

/** 30 changes per hour per account (each change sends an e-mail). */
const CHANGE_RULE = { limit: 30, windowMs: 60 * 60_000 };

async function messagesFor(locale: string): Promise<Messages> {
  const l = (LOCALES as readonly string[]).includes(locale) ? (locale as (typeof LOCALES)[number]) : "tr";
  try {
    return await getMessages(l);
  } catch {
    return defaultMessages[l];
  }
}

const NOTICE: Record<SubscriptionChange["kind"], keyof Messages["subscriptions"]["account"]["notices"]> = {
  pause: "paused",
  resume: "resumed",
  skip: "skipped",
  unskip: "unskipped",
  plan: "plan",
  address: "address",
  cancel: "cancelled",
};

/** Pause, resume, skip / unskip the next delivery, change the plan or address, cancel. */
export async function changeMySubscription(input: unknown): Promise<SubscriptionActionResult> {
  const locale = typeof (input as { locale?: unknown })?.locale === "string" ? (input as { locale: string }).locale : "tr";
  const messages = await messagesFor(locale);
  const m = messages.subscriptions.account;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    const e = messages.checkout.errors as Record<string, string>;
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (path.startsWith("change.address.") && !fieldErrors[path.slice("change.address.".length)]) {
        fieldErrors[path.slice("change.address.".length)] = e[issue.message] ?? e.invalid;
      }
    }
    return { ok: false, error: Object.keys(fieldErrors).length ? messages.checkout.errors.invalid_input : m.errors.generic, fieldErrors };
  }

  const session = await getSession();
  if (!session?.user?.id) return { ok: false, error: m.errors.signIn, signIn: true };
  const userId = session.user.id;

  const decision = await consumeLimits([[`subscription:user:${userId}`, CHANGE_RULE]]);
  if (!decision.allowed) return { ok: false, error: m.errors.rateLimited };

  const c = parsed.data.change;
  let serviceChange: SubscriptionChange;
  if (c.kind === "skip") {
    // A skip link from the reminder e-mail names one renewal; a moved renewal makes it stale.
    if (c.token !== undefined) {
      const token = readSubscriptionSkipToken(c.token);
      if (!token || token.subscriptionId !== parsed.data.subscriptionId) return { ok: false, error: m.skipLink.invalid };
      serviceChange = { kind: "skip", runAt: token.runAt };
    } else serviceChange = { kind: "skip" };
  } else if (c.kind === "address") {
    const a = c.address;
    const address: AddressData = {
      fullName: a.fullName,
      phone: a.phone,
      city: a.city,
      district: a.district,
      ...(a.neighbourhood ? { neighbourhood: a.neighbourhood } : {}),
      line1: a.line1,
      ...(a.postalCode ? { postalCode: a.postalCode } : {}),
      country: "TR",
    };
    serviceChange = { kind: "address", address };
  } else serviceChange = c;

  try {
    const result = await db.transaction((tx) =>
      changeSubscription(tx, { subscriptionId: parsed.data.subscriptionId, change: serviceChange }, { type: "customer", userId }),
    );
    if (!result.ok) {
      const error = result.code === "not_found" || result.code === "forbidden" ? m.errors.notFound : result.code === "plan_unavailable" ? m.errors.planUnavailable : m.errors.state;
      return { ok: false, error };
    }
  } catch (error) {
    console.error("[subscriptions] change failed", safeErrorInfo(error));
    return { ok: false, error: m.errors.generic };
  }
  refresh();
  return { ok: true, message: m.notices[NOTICE[c.kind]] };
}
