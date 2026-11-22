// Stores a message from the public contact form. No Next APIs here (the Server Action in
// src/app/[locale]/iletisim/actions.ts passes the trusted client IP), so DB tests call it directly.
// Never logs personal data: only the message id, subject and error codes.
import "server-only";
import { count, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeErrorInfo } from "@/lib/db-errors";
import { notifyContactMessage } from "@/lib/notifications";
import type { Tx } from "@/lib/panel/tx";
import { parseContactForm, readContactForm, type RawContactForm } from "./schema";
import { CONTACT_SITE_RULE, contactBlockedFor, recordContactHit } from "./throttle";
import type { ContactFormState, ContactFormValues } from "./types";

const echo = (raw: RawContactForm): ContactFormValues => ({
  name: raw.name,
  email: raw.email,
  phone: raw.phone,
  subject: raw.subject,
  message: raw.message,
});

export type ContactSubmitResult = { state: ContactFormState; messageId: number | null };

/**
 * Handles one submission: honeypot (pretends success, stores nothing) → validation → rate limits →
 * insert into contact_messages and the admin notification e-mail (one transaction). Returns the next form state.
 */
export async function submitContactForm(
  source: FormData | Record<string, unknown>,
  ctx: { ip: string; prev?: ContactFormState | null; now?: number; executor?: Tx; /** Tests only. */ siteLimit?: number },
): Promise<ContactSubmitResult> {
  const attempt = (ctx.prev?.attempt ?? 0) + 1;
  const now = ctx.now ?? Date.now();
  const raw = readContactForm(source);

  if (raw.website.trim() !== "") {
    await recordContactHit({ ip: ctx.ip, email: null }, now);
    return { state: { status: "success", attempt }, messageId: null };
  }

  const parsed = parseContactForm(raw);
  if (!parsed.success) {
    return { state: { status: "error", error: "invalid", fieldErrors: parsed.fieldErrors, values: echo(raw), attempt }, messageId: null };
  }

  const input = parsed.data;
  const waitMinutes = await contactBlockedFor({ ip: ctx.ip, email: input.email }, now);
  if (waitMinutes > 0) {
    return { state: { status: "error", error: "too_many", retryMinutes: waitMinutes, values: echo(raw), attempt }, messageId: null };
  }

  try {
    const executor = ctx.executor ?? db;
    const cm = schema.contactMessages;
    const [recent] = await executor
      .select({ n: count() })
      .from(cm)
      .where(gt(cm.createdAt, sql`now() - make_interval(mins => ${CONTACT_SITE_RULE.windowMinutes})`));
    if ((recent?.n ?? 0) >= (ctx.siteLimit ?? CONTACT_SITE_RULE.limit)) {
      console.warn("[contact] site-wide message limit reached; new messages are refused for a few minutes");
      return {
        state: { status: "error", error: "too_many", retryMinutes: CONTACT_SITE_RULE.windowMinutes, values: echo(raw), attempt },
        messageId: null,
      };
    }
    // The message and its admin notification e-mail (REQUESTS, day 4) commit together.
    const row = await executor.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.contactMessages)
        .values({
          name: input.name,
          email: input.email,
          phone: input.phone,
          subject: input.subject,
          message: input.message,
          locale: input.locale,
        })
        .returning({ id: schema.contactMessages.id });
      await notifyContactMessage(tx, { id: inserted.id, ...input });
      return inserted;
    });
    await recordContactHit({ ip: ctx.ip, email: input.email }, now);
    return { state: { status: "success", attempt }, messageId: row.id };
  } catch (error) {
    console.error("[contact] storing the message failed", safeErrorInfo(error));
    return { state: { status: "error", error: "server", values: echo(raw), attempt }, messageId: null };
  }
}
