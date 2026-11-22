"use server";
// Storefront newsletter actions: the sign-up form (footer, newsletter section), the confirm button of
// /bulten/onay and the unsubscribe button of /bulten/ayril. Double opt-in lives in
// @/lib/newsletter/service; these wrappers add zod, the honeypot and durable rate limits.

import { z } from "zod";
import { db } from "@/db";
import { LOCALES } from "@/db/schema/common";
import { safeErrorInfo } from "@/lib/db-errors";
import { confirmNewsletter, recentPendingSignups, subscribeNewsletter, unsubscribeNewsletter } from "@/lib/newsletter/service";
import type { LimitEntry } from "@/lib/rate-limit";
import { consumeLimits } from "@/lib/rate-limit-store";
import { clientIp } from "@/lib/request-ip";

export type NewsletterError = "invalid_email" | "consent_required" | "disabled" | "rate_limited" | "generic";

/** useActionState state. Start with `{ status: "idle" }`. `email`/`consent` echo the input after an error. */
export type NewsletterState = {
  status: "idle" | "success" | "error";
  error?: NewsletterError;
  /** rate_limited: minutes to wait. */
  minutes?: number;
  email?: string;
  consent?: boolean;
};

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const localeSchema = z.enum(LOCALES).catch("tr");
const sourceSchema = z.enum(["footer", "section", "popup"]).catch("footer");
const consentSchema = z.enum(["on", "true", "1", "yes"]);

/** Site-wide cap on new pending sign-ups per 10 minutes (bounds confirmation mails from scripted floods). */
const SIGNUP_LIMIT = 40;

/** Sign-ups (confirmation mails) per client IP and per address. */
const SUBSCRIBE_RULES = {
  ip: { limit: 10, windowMs: 60 * 60_000 },
  email: { limit: 3, windowMs: 24 * 60 * 60_000 },
} as const;

/** Confirm / unsubscribe button presses per client IP (tokens are unguessable; this bounds abuse). */
const LINK_RULE = { limit: 30, windowMs: 60 * 60_000 } as const;

/**
 * Newsletter sign-up (form fields: email, consent, locale, optional source; `company` is a honeypot).
 * Requires explicit commercial e-message consent (İYS/KVKK) and starts the double opt-in: the row is
 * `pending` until the confirmation link is used. The answer is the same for new, pending, active and
 * unsubscribed addresses (no enumeration).
 */
export async function subscribeNewsletterAction(_prev: NewsletterState, formData: FormData): Promise<NewsletterState> {
  const rawEmail = String(formData.get("email") ?? "");
  const consentGiven = consentSchema.safeParse(formData.get("consent")).success;

  const ip = await clientIp();
  // Bots fill every field; humans never see this one. Counted, then answered like a success.
  if (String(formData.get("company") ?? "").trim() !== "") {
    await consumeLimits([[`newsletter:ip:${ip}`, SUBSCRIBE_RULES.ip]]).catch(() => undefined);
    return { status: "success" };
  }

  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) return { status: "error", error: "invalid_email", email: rawEmail.slice(0, 254), consent: consentGiven };
  if (!consentGiven) return { status: "error", error: "consent_required", email: email.data, consent: false };

  const locale = localeSchema.parse(formData.get("locale"));
  const source = sourceSchema.parse(formData.get("source"));

  try {
    const limits: LimitEntry[] = [
      [`newsletter:ip:${ip}`, SUBSCRIBE_RULES.ip],
      [`newsletter:email:${email.data}`, SUBSCRIBE_RULES.email],
    ];
    const decision = await consumeLimits(limits);
    if (!decision.allowed) return { status: "error", error: "rate_limited", minutes: decision.retryAfterMinutes, email: email.data, consent: true };

    const result = await db.transaction(async (tx) => {
      if ((await recentPendingSignups(tx)) >= SIGNUP_LIMIT) return "capped" as const;
      return subscribeNewsletter(tx, { email: email.data, locale, source, ip });
    });
    if (result === "capped") {
      console.warn("[newsletter] sign-up cap reached; rejecting");
      return { status: "error", error: "generic", email: email.data, consent: true };
    }
    if (!result.ok) return { status: "error", error: result.reason === "disabled" ? "disabled" : "invalid_email", email: email.data, consent: true };
    return { status: "success" };
  } catch (error) {
    console.error("[newsletter] subscribe failed", safeErrorInfo(error)); // never the message: it carries the e-mail
    return { status: "error", error: "generic", email: email.data, consent: true };
  }
}

export type NewsletterLinkState = { status: "idle" | "done" | "invalid" | "error" };

const tokenSchema = z.string().trim().min(1).max(2048);

async function linkAllowed(): Promise<boolean> {
  const ip = await clientIp();
  const decision = await consumeLimits([[`newsletter-link:ip:${ip}`, LINK_RULE]]);
  return decision.allowed;
}

/** The confirm button of /bulten/onay (a click on purpose: mail scanners open links by themselves). */
export async function confirmNewsletterAction(_prev: NewsletterLinkState, formData: FormData): Promise<NewsletterLinkState> {
  const token = tokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { status: "invalid" };
  try {
    if (!(await linkAllowed())) return { status: "error" };
    const result = await db.transaction((tx) => confirmNewsletter(tx, token.data));
    return { status: result.ok ? "done" : "invalid" };
  } catch (error) {
    console.error("[newsletter] confirm failed", safeErrorInfo(error));
    return { status: "error" };
  }
}

/** The button of /bulten/ayril (the visible footer link of every campaign). */
export async function unsubscribeNewsletterAction(_prev: NewsletterLinkState, formData: FormData): Promise<NewsletterLinkState> {
  const token = tokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { status: "invalid" };
  try {
    if (!(await linkAllowed())) return { status: "error" };
    const result = await db.transaction((tx) => unsubscribeNewsletter(tx, token.data));
    return { status: result.ok ? "done" : "invalid" };
  } catch (error) {
    console.error("[newsletter] unsubscribe failed", safeErrorInfo(error));
    return { status: "error" };
  }
}
