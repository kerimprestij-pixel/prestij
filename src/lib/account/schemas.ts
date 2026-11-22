// Customer account forms (sign-in, register, password, profile, addresses, deletion): zod 4 schemas
// whose error messages are CODES, never texts. Pure: the client forms may import it for hints, but
// every Server Action validates again. Address and invoice codes are the checkout's codes
// (messages.checkout.errors.<code>); the auth codes map to messages.auth.errors (see AUTH_ERROR_KEYS).
import { z } from "zod";
import { LOCALES } from "@/i18n/locales";
import { CONTROL_CHARS, addressSchema, type CheckoutFieldErrorCode } from "@/lib/orders/checkout-schema";
import { isValidTckn, isValidVkn, normalizeTrPhone } from "@/lib/validation/tr";

/** Better Auth's limits (src/lib/auth.ts minPasswordLength, the library's default maximum). */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const ADDRESS_TITLE_MAX = 40;

/** Field error codes of the auth / profile forms. */
export type AccountFieldCode =
  | CheckoutFieldErrorCode
  | "password_too_short"
  | "password_too_long"
  | "password_mismatch"
  | "password_same"
  | "terms_required"
  | "confirm_required";

const noControlChars = (v: string) => !CONTROL_CHARS.test(v);
const boolish = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1" || v === "yes", z.boolean());

export const emailInput = z
  .string({ error: "required" })
  .trim()
  .toLowerCase()
  .min(1, { error: "required" })
  .max(254, { error: "too_long" })
  .pipe(z.email({ error: "invalid_email" }));

export const nameInput = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .min(2, { error: "too_short" })
  .max(NAME_MAX, { error: "too_long" })
  .refine(noControlChars, { error: "invalid" });

/** Optional mobile number: "" → null, otherwise normalized to +905xxxxxxxxx. */
export const optionalPhoneInput = z
  .string({ error: "invalid_phone" })
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    const phone = normalizeTrPhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return phone;
  });

const requiredPhoneInput = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .transform((value, ctx) => {
    const phone = normalizeTrPhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return phone;
  });

/** A new password (length only: Better Auth decides the rest). Never trimmed. */
export const newPasswordInput = z
  .string({ error: "required" })
  .min(1, { error: "required" })
  .min(PASSWORD_MIN, { error: "password_too_short" })
  .max(PASSWORD_MAX, { error: "password_too_long" });

/** A password the user types to prove who they are (sign-in, current password, deletion). */
export const currentPasswordInput = z
  .string({ error: "required" })
  .min(1, { error: "required" })
  .max(PASSWORD_MAX, { error: "password_too_long" });

export const localeInput = z.enum(LOCALES).catch("tr");

export const signInSchema = z.object({
  locale: localeInput,
  email: emailInput,
  password: currentPasswordInput,
});

export const registerSchema = z.object({
  locale: localeInput,
  name: nameInput,
  email: emailInput,
  phone: optionalPhoneInput,
  password: newPasswordInput,
  terms: z.preprocess((v) => v === true || v === "on" || v === "true", z.literal(true, { error: "terms_required" })),
  marketing: boolish.default(false),
});

export const forgotPasswordSchema = z.object({ locale: localeInput, email: emailInput });

export const resetPasswordSchema = z
  .object({
    locale: localeInput,
    token: z.string().trim().min(1, { error: "invalid" }).max(4096, { error: "invalid" }),
    password: newPasswordInput,
    confirm: z.string({ error: "required" }).min(1, { error: "required" }),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirm) ctx.addIssue({ code: "custom", message: "password_mismatch", path: ["confirm"] });
  });

export const profileSchema = z.object({
  locale: localeInput,
  name: nameInput,
  phone: optionalPhoneInput,
  preferredLocale: z.enum(LOCALES, { error: "invalid" }),
});

export const changePasswordSchema = z
  .object({
    locale: localeInput,
    currentPassword: currentPasswordInput,
    newPassword: newPasswordInput,
    confirm: z.string({ error: "required" }).min(1, { error: "required" }),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirm) ctx.addIssue({ code: "custom", message: "password_mismatch", path: ["confirm"] });
    else if (data.newPassword === data.currentPassword) ctx.addIssue({ code: "custom", message: "password_same", path: ["newPassword"] });
  });

export const deleteAccountSchema = z.object({
  locale: localeInput,
  password: currentPasswordInput,
  // Not "confirm": the password form on the same page has a field with that name (and its id).
  confirmDeletion: z.preprocess((v) => v === true || v === "on" || v === "true", z.literal(true, { error: "confirm_required" })),
});

// -------------------------------------------------------------------------------------------------
// Addresses (same rules and codes as the checkout's delivery address, plus the phone and invoice data)

const optionalText = (max: number) =>
  z
    .string({ error: "invalid" })
    .trim()
    .max(max, { error: "too_long" })
    .refine(noControlChars, { error: "invalid" })
    .optional()
    .transform((v) => (v ? v : undefined));

const digitsOnly = (v: unknown) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v);

const individualInvoiceInput = z.object({
  type: z.literal("individual"),
  nationalId: z.preprocess(
    digitsOnly,
    z
      .string({ error: "invalid_tckn" })
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || isValidTckn(v), { error: "invalid_tckn" }),
  ),
});

const textRequired = (min: number, max: number) =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .min(min, { error: "too_short" })
    .max(max, { error: "too_long" })
    .refine(noControlChars, { error: "invalid" });

const corporateInvoiceInput = z.object({
  type: z.literal("corporate"),
  companyName: textRequired(2, 200),
  taxOffice: textRequired(2, 100),
  taxNumber: z.preprocess(
    digitsOnly,
    z
      .string({ error: "required" })
      .min(1, { error: "required" })
      .refine((v) => isValidVkn(v) || isValidTckn(v), { error: "invalid_tax_number" }),
  ),
  eInvoice: boolish.default(false),
});

export const addressInputSchema = z.object({
  /** Present when editing; ownership is checked on the server. */
  id: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().int().positive().optional()),
  locale: localeInput,
  title: optionalText(ADDRESS_TITLE_MAX),
  address: addressSchema.extend({ phone: requiredPhoneInput }),
  invoice: z.discriminatedUnion("type", [individualInvoiceInput, corporateInvoiceInput], { error: "required" }),
  isDefaultShipping: boolish.default(false),
  isDefaultBilling: boolish.default(false),
});

export type AddressInput = z.output<typeof addressInputSchema>;

export const addressIdSchema = z.object({ locale: localeInput, id: z.coerce.number().int().positive() });

export const defaultAddressSchema = addressIdSchema.extend({ kind: z.enum(["shipping", "billing"]) });

export const favoriteSchema = z.object({ productId: z.coerce.number().int().positive(), favorite: z.boolean() });

// -------------------------------------------------------------------------------------------------
// Helpers

/** Zod issues → { "dotted.path": code } (first code per path). Unknown messages become "invalid". */
export function fieldCodes(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".") || "form";
    if (out[path]) continue;
    out[path] = typeof issue.message === "string" && /^[a-z_]+$/.test(issue.message) ? issue.message : issue.code === "invalid_type" ? "required" : "invalid";
  }
  return out;
}

/** Flat FormData (dotted names) → nested object; checkboxes listed in `checkboxes` become booleans. */
export function formDataToObject(formData: FormData, checkboxes: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (path: string, value: unknown) => {
    const parts = path.split(".");
    if (parts.some((p) => !p || p === "__proto__" || p === "constructor" || p === "prototype")) return;
    let node = out;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (!next || typeof next !== "object") node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  };
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || key.startsWith("$") || key.length > 64) continue;
    set(key, value.length > 5000 ? value.slice(0, 5000) : value);
  }
  for (const field of checkboxes) {
    const v = formData.get(field);
    set(field, v === "on" || v === "true" || v === "1");
  }
  return out;
}

/** The submitted text fields (no passwords), so a no-JS re-render can refill a form. */
export function echoValues(formData: FormData, omit: readonly string[] = []): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || key.startsWith("$") || key.length > 64 || omit.includes(key) || /password|confirm|token/i.test(key)) continue;
    values[key] = value.slice(0, 600);
  }
  return values;
}

/** A rough strength score 0–4 for the hint under new-password fields (never a server rule). */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN) score++;
  if (password.length >= 14) score++;
  const classes = [/[a-zçğıöşü]/, /[A-ZÇĞİÖŞÜ]/, /\d/, /[^\p{L}\d]/u].filter((r) => r.test(password)).length;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  if (password.length < PASSWORD_MIN) score = Math.min(score, 1);
  if (/^(.)\1+$/.test(password) || /^(?:0123456789|1234567890|qwertyuiop|password|sifre|şifre)/i.test(password)) score = Math.min(score, 1);
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
