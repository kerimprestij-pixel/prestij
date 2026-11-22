// Business account application (/hesap/kurumsal): the form's validation and the shape of the data a
// company row keeps about the application. Pure (zod only): the storefront form, the Server Action,
// the panel and the DB tests share it. Every error message is a field error CODE; the storefront shows
// it with messages.b2b.account.errors[code], the panel with BUSINESS_FIELD_ERRORS_TR.
import { z } from "zod";
import type { AddressData, BusinessSector, CompanyStatus } from "@/db/schema/commerce";
import { LOCALES, type Locale } from "@/i18n/locales";
import { findProvince, isValidTckn, isValidVkn } from "@/lib/validation/tr";

/** Every sector a company can have, in form order (mirrors BusinessSector in src/db/schema/commerce.ts). */
export const BUSINESS_SECTORS = ["hotel", "spa", "office", "restaurant", "hospital", "school", "retail", "other"] as const satisfies readonly BusinessSector[];
export const BUSINESS_SECTORS_COMPLETE: BusinessSector extends (typeof BUSINESS_SECTORS)[number] ? true : never = true;

export function isBusinessSector(value: unknown): value is BusinessSector {
  return typeof value === "string" && (BUSINESS_SECTORS as readonly string[]).includes(value);
}

/** Expected monthly need in litres (a choice, not a free number: easier to answer, easier to sort). */
export const MONTHLY_VOLUMES = ["lt50", "l50_200", "l200_1000", "gt1000"] as const;
export type MonthlyVolume = (typeof MONTHLY_VOLUMES)[number];

export function isMonthlyVolume(value: unknown): value is MonthlyVolume {
  return typeof value === "string" && (MONTHLY_VOLUMES as readonly string[]).includes(value);
}

/** Turkish labels for the panel (the storefront uses messages.b2b.account.sectors / volumes). */
export const SECTOR_LABELS_TR: Record<BusinessSector, string> = {
  hotel: "Otel",
  spa: "Spa & wellness",
  office: "Ofis",
  restaurant: "Restoran & kafe",
  hospital: "Hastane & klinik",
  school: "Okul & eğitim",
  retail: "Mağaza & perakende",
  other: "Diğer",
};

export const VOLUME_LABELS_TR: Record<MonthlyVolume, string> = {
  lt50: "50 litreden az",
  l50_200: "50–200 litre",
  l200_1000: "200–1.000 litre",
  gt1000: "1.000 litreden fazla",
};

export const COMPANY_STATUSES = ["pending", "approved", "rejected"] as const satisfies readonly CompanyStatus[];

/**
 * What the applicant told us besides the company data. There is no column for it (the day-4 schema is
 * fixed), so it lives in the existing `companies.address` jsonb under `application`; read it with
 * readApplicationDetails(). See the B2B report: a dedicated column is a day-5 candidate.
 */
export type ApplicationDetails = {
  monthlyVolume: MonthlyVolume | null;
  note: string | null;
  /** Storefront language the application was sent from (the customer mails use the account locale). */
  locale: Locale;
};

/** companies.address as B2B writes it: a regular AddressData plus the application details. */
export type CompanyAddress = AddressData & { application?: ApplicationDetails };

export function readApplicationDetails(address: unknown): ApplicationDetails | null {
  if (!address || typeof address !== "object") return null;
  const raw = (address as { application?: unknown }).application;
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return {
    monthlyVolume: isMonthlyVolume(a.monthlyVolume) ? a.monthlyVolume : null,
    note: typeof a.note === "string" && a.note.trim() ? a.note : null,
    locale: typeof a.locale === "string" && (LOCALES as readonly string[]).includes(a.locale) ? (a.locale as Locale) : "tr",
  };
}

/** The address part only (without the application details), or null when it is not a usable address. */
export function readCompanyAddress(address: unknown): AddressData | null {
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (!str(a.city) && !str(a.line1)) return null;
  return {
    fullName: str(a.fullName),
    phone: str(a.phone),
    city: str(a.city),
    district: str(a.district),
    ...(str(a.neighbourhood) ? { neighbourhood: str(a.neighbourhood) } : {}),
    line1: str(a.line1),
    ...(str(a.postalCode) ? { postalCode: str(a.postalCode) } : {}),
    country: str(a.country) || "TR",
  };
}

// ---------------------------------------------------------------------------------------------------
// Validation

export type BusinessFieldErrorCode =
  | "required"
  | "invalid"
  | "too_short"
  | "too_long"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_tax_number"
  | "invalid_province"
  | "invalid_postal_code"
  | "invalid_website";

const FIELD_CODES = new Set<string>([
  "required",
  "invalid",
  "too_short",
  "too_long",
  "invalid_email",
  "invalid_phone",
  "invalid_tax_number",
  "invalid_province",
  "invalid_postal_code",
  "invalid_website",
]);

/** Turkish texts of the codes (panel company editor). */
export const BUSINESS_FIELD_ERRORS_TR: Record<BusinessFieldErrorCode, string> = {
  required: "Bu alan zorunlu.",
  invalid: "Geçersiz değer.",
  too_short: "Çok kısa.",
  too_long: "Çok uzun.",
  invalid_email: "Geçerli bir e-posta adresi girin.",
  invalid_phone: "Geçerli bir telefon numarası girin (ör. 0352 123 45 67).",
  invalid_tax_number: "Geçerli bir vergi kimlik numarası (10 hane) veya T.C. kimlik numarası (11 hane) girin.",
  invalid_province: "Listeden bir il seçin.",
  invalid_postal_code: "Posta kodu 5 haneli olmalı.",
  invalid_website: "Geçerli bir web adresi girin (ör. www.firmaniz.com).",
};

export const BUSINESS_LIMITS = {
  companyName: 160,
  taxOffice: 80,
  email: 254,
  website: 200,
  district: 80,
  line1: 250,
  note: 1000,
  rejectionReason: 1000,
  adminNote: 2000,
} as const;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noControl = (v: string | undefined) => v === undefined || !CONTROL_CHARS.test(v);

const text = (min: number, max: number) =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .min(min, { error: "too_short" })
    .max(max, { error: "too_long" })
    .refine(noControl, { error: "invalid" });

const optionalText = (max: number) =>
  z
    .string({ error: "invalid" })
    .trim()
    .max(max, { error: "too_long" })
    .refine(noControl, { error: "invalid" })
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/**
 * A Turkish business phone: landline or mobile, any common spelling (0352 123 45 67, +90 532 …,
 * 0 (352) 123-45-67) → "+903521234567". Area codes start with 2–4, mobiles with 5.
 */
export function normalizeBusinessPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]{10,22}$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[2-5]\d{9}$/.test(digits) ? `+90${digits}` : null;
}

/** "+903521234567" → "0352 123 45 67" (anything else unchanged). */
export function formatBusinessPhone(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(value);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]}` : value;
}

/**
 * A company website: "firma.com", "www.firma.com.tr/iletisim", "https://firma.com" → an absolute
 * https URL ("http://" is upgraded). Refuses anything without a dotted host, credentials or odd schemes.
 */
export function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/\//, "")}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) || url.hostname.length > 120) return null;
  url.protocol = "https:";
  const full = url.toString();
  // "https://firma.com/" → "https://firma.com" (a bare host reads better); real paths stay as typed.
  const out = url.pathname === "/" && !url.search && !url.hash ? full.replace(/\/$/, "") : full;
  return out.length <= BUSINESS_LIMITS.website ? out : null;
}

const phone = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .transform((value, ctx) => {
    const normalized = normalizeBusinessPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return normalized;
  });

const email = z
  .string({ error: "required" })
  .trim()
  .toLowerCase()
  .min(1, { error: "required" })
  .max(BUSINESS_LIMITS.email, { error: "too_long" })
  .pipe(z.email({ error: "invalid_email" }));

/** VKN (10 digits, GİB check digit) or, for sole proprietors, a T.C. kimlik no (11 digits). */
const taxNumber = z
  .string({ error: "required" })
  .transform((v) => v.replace(/[\s.-]/g, ""))
  .pipe(
    z
      .string()
      .min(1, { error: "required" })
      .refine((v) => isValidVkn(v) || isValidTckn(v), { error: "invalid_tax_number" }),
  );

const province = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .transform((value, ctx) => {
    const found = findProvince(value);
    if (!found) {
      ctx.addIssue({ code: "custom", message: "invalid_province" });
      return z.NEVER;
    }
    return found.name;
  });

const postalCode = z
  .string({ error: "invalid_postal_code" })
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{5}$/.test(v), { error: "invalid_postal_code" });

const website = z
  .string({ error: "invalid_website" })
  .trim()
  .optional()
  .nullable()
  .transform((value, ctx) => {
    if (!value) return null;
    const normalized = normalizeWebsite(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "invalid_website" });
      return z.NEVER;
    }
    return normalized;
  });

/** The company fields shared by the storefront application and the panel's company editor. */
export const companyFieldsSchema = z.object({
  companyName: text(2, BUSINESS_LIMITS.companyName),
  sector: z.enum(BUSINESS_SECTORS, { error: "required" }),
  taxOffice: text(2, BUSINESS_LIMITS.taxOffice),
  taxNumber,
  phone,
  email,
  website,
  address: z.object({
    city: province,
    district: text(2, BUSINESS_LIMITS.district),
    line1: text(5, BUSINESS_LIMITS.line1),
    postalCode,
  }),
});

export type CompanyFields = z.output<typeof companyFieldsSchema>;

/** The /hesap/kurumsal form (input names are the field paths: "address.city", "monthlyVolume", …). */
export const businessApplicationSchema = companyFieldsSchema.extend({
  monthlyVolume: z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(MONTHLY_VOLUMES, { error: "invalid" }).nullable()),
  note: optionalText(BUSINESS_LIMITS.note),
  locale: z.enum(LOCALES).catch("tr"),
});

export type BusinessApplicationInput = z.input<typeof businessApplicationSchema>;
export type BusinessApplicationData = z.output<typeof businessApplicationSchema>;
export type BusinessFieldErrors = Record<string, BusinessFieldErrorCode>;

/** Maps zod issues to { "path.to.field": code } (first error per field wins). */
export function toBusinessFieldErrors(issues: readonly z.core.$ZodIssue[]): BusinessFieldErrors {
  const out: BusinessFieldErrors = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".") || "form";
    if (out[path]) continue;
    out[path] = (FIELD_CODES.has(issue.message) ? issue.message : issue.code === "invalid_type" ? "required" : "invalid") as BusinessFieldErrorCode;
  }
  return out;
}

export function validateBusinessApplication(input: unknown): { ok: true; data: BusinessApplicationData } | { ok: false; fieldErrors: BusinessFieldErrors } {
  const result = businessApplicationSchema.safeParse(input);
  return result.success ? { ok: true, data: result.data } : { ok: false, fieldErrors: toBusinessFieldErrors(result.error.issues) };
}

/** The input names of the form, in order (focus the first invalid one). */
export const BUSINESS_FORM_FIELDS = [
  "companyName",
  "sector",
  "taxOffice",
  "taxNumber",
  "phone",
  "email",
  "website",
  "address.city",
  "address.district",
  "address.line1",
  "address.postalCode",
  "monthlyVolume",
  "note",
] as const;

/** Flat FormData (names = field paths) → the nested object businessApplicationSchema expects. */
export function businessFormDataToInput(formData: FormData): Record<string, unknown> {
  const get = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : undefined;
  };
  return {
    companyName: get("companyName"),
    sector: get("sector"),
    taxOffice: get("taxOffice"),
    taxNumber: get("taxNumber"),
    phone: get("phone"),
    email: get("email"),
    website: get("website"),
    address: {
      city: get("address.city"),
      district: get("address.district"),
      line1: get("address.line1"),
      postalCode: get("address.postalCode"),
    },
    monthlyVolume: get("monthlyVolume"),
    note: get("note"),
    locale: get("locale"),
  };
}

// ---------------------------------------------------------------------------------------------------
// Payment terms

/** Deferred ("vadeli") payment days the panel accepts. */
export const DEFERRED_DAYS = { min: 1, max: 180, default: 30 } as const;

export type PaymentTerms = { allowDeferred?: boolean; days?: number };

/** Stored terms → what checkout and the status page may rely on (null = no deferred payment). */
export function deferredDaysOf(terms: PaymentTerms | null | undefined): number | null {
  if (!terms?.allowDeferred) return null;
  const days = terms.days;
  return typeof days === "number" && Number.isInteger(days) && days >= DEFERRED_DAYS.min && days <= DEFERRED_DAYS.max ? days : null;
}
