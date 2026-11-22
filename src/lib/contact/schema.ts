// Validation of the public contact form (pure: zod only). Error messages are codes
// (ContactFieldError); the form shows them in the visitor's language.
import { z } from "zod";
import { LOCALES } from "@/i18n/locales";
import { normalizeTrPhone } from "@/lib/validation/tr";
import { CONTACT_SUBJECTS } from "./subjects";
import { CONTACT_LIMITS as L, type ContactField, type ContactFieldError, type ContactFormValues, type ContactInput } from "./types";

/** Control characters except tab and newline (pasted text keeps its line breaks). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const clean = (value: string) => value.replace(CONTROL, "");
const oneLine = (value: string) => clean(value).replace(/\s+/g, " ").trim();

const code = (c: ContactFieldError) => ({ error: c });

const nameSchema = z
  .string()
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, code("required"))
      .min(L.nameMin, code("invalid_name"))
      .max(L.name, code("too_long"))
      // At least two letters in any script (blocks "12", "--", "@@").
      .refine((v) => (v.match(/\p{L}/gu) ?? []).length >= 2, code("invalid_name")),
  );

const emailSchema = z
  .string()
  .transform((v) => oneLine(v).toLowerCase())
  .pipe(z.string().min(1, code("required")).max(L.email, code("invalid_email")).pipe(z.email(code("invalid_email"))));

/** Optional; any national or international number with 7–15 digits. Turkish mobiles are stored as +905…. */
const phoneSchema = z
  .string()
  .transform(oneLine)
  .pipe(
    z
      .string()
      .max(L.phone, code("invalid_phone"))
      .refine((v) => v === "" || (/^\+?[\d\s().\-/]+$/.test(v) && /^\d{7,15}$/.test(v.replace(/\D/g, ""))), code("invalid_phone")),
  )
  .transform((v) => (v === "" ? null : (normalizeTrPhone(v) ?? v)));

const messageSchema = z
  .string()
  .transform((v) => clean(v).replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim())
  .pipe(z.string().min(1, code("required")).min(L.messageMin, code("too_short")).max(L.message, code("too_long")));

/** Unknown or missing subjects fall back to "general" (the select is not a place to fail the visitor). */
const subjectSchema = z.enum(CONTACT_SUBJECTS).catch("general");
const localeSchema = z.enum(LOCALES).catch("tr");

export const contactFormSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  subject: subjectSchema,
  message: messageSchema,
  locale: localeSchema,
});

/** Raw form fields (strings only, cut to sane lengths before validation). */
export type RawContactForm = ContactFormValues & { locale: string; website: string };

const read = (source: FormData | Record<string, unknown>, name: string, max: number): string => {
  const value = source instanceof FormData ? source.get(name) : source[name];
  return typeof value === "string" ? value.slice(0, max) : "";
};

export function readContactForm(source: FormData | Record<string, unknown>): RawContactForm {
  return {
    name: read(source, "name", L.name * 2),
    email: read(source, "email", L.email * 2),
    phone: read(source, "phone", L.phone * 2),
    subject: read(source, "subject", 40),
    message: read(source, "message", L.message * 2),
    locale: read(source, "locale", 10),
    // Honeypot: hidden from people, filled in by bots.
    website: read(source, "website", 200),
  };
}

export type ContactParseResult =
  | { success: true; data: ContactInput }
  | { success: false; fieldErrors: Partial<Record<ContactField, ContactFieldError>> };

export function parseContactForm(raw: RawContactForm): ContactParseResult {
  const result = contactFormSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const fieldErrors: Partial<Record<ContactField, ContactFieldError>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ContactField;
    if (fieldErrors[field]) continue;
    const message = issue.message as ContactFieldError;
    fieldErrors[field] = (["required", "invalid_name", "invalid_email", "invalid_phone", "too_short", "too_long"] as const).includes(message)
      ? message
      : "required";
  }
  return { success: false, fieldErrors };
}
