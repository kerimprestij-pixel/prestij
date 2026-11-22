// Validation of the public quote and sample request forms (pure: no DB, no Next). Errors are codes
// (RequestFieldError) keyed by field path; the forms show them in the visitor's language. Product and
// variant ids are only shape-checked here: the service re-reads them from the database.
import type { BusinessSector } from "@/db/schema/commerce";
import { LOCALES, type Locale } from "@/i18n/locales";
import { findProvince, normalizeTrPhone } from "@/lib/validation/tr";
import { isBusinessSector, REQUEST_LIMITS as L, type QuoteLineDraft, type RequestFieldError } from "./types";

/** Control characters except tab and newline, plus bidi overrides and zero-width characters. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const clean = (value: string) => value.replace(CONTROL, "");
const oneLine = (value: string) => clean(value).replace(/\s+/g, " ").trim();
const multiLine = (value: string) => clean(value).replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Source = FormData | Record<string, unknown>;

function read(source: Source, name: string, max: number): string {
  const value = source instanceof FormData ? source.get(name) : source[name];
  return typeof value === "string" ? value.slice(0, max) : typeof value === "number" ? String(value).slice(0, max) : "";
}

function readAll(source: Source, name: string, maxItems: number): string[] {
  const values = source instanceof FormData ? source.getAll(name) : ([] as unknown[]).concat(source[name] ?? []);
  return values.filter((v): v is string => typeof v === "string" || typeof v === "number").map(String).slice(0, maxItems * 4);
}

export type FieldErrors = Record<string, RequestFieldError>;
type Checked<T> = { ok: true; value: T } | { ok: false; error: RequestFieldError };
const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const fail = (error: RequestFieldError): Checked<never> => ({ ok: false, error });

function personName(raw: string): Checked<string> {
  const v = oneLine(raw);
  if (!v) return fail("required");
  if (v.length > L.name) return fail("too_long");
  // At least two letters in any script (blocks "12", "--", "@@").
  if (v.length < L.nameMin || (v.match(/\p{L}/gu) ?? []).length < 2) return fail("invalid_name");
  return ok(v);
}

function companyName(raw: string): Checked<string> {
  const v = oneLine(raw);
  if (!v) return fail("required");
  if (v.length > L.company) return fail("too_long");
  if (v.length < L.companyMin || (v.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) return fail("invalid_company");
  return ok(v);
}

function emailAddress(raw: string): Checked<string> {
  const v = oneLine(raw).toLowerCase();
  if (!v) return fail("required");
  if (v.length > L.email || !EMAIL.test(v)) return fail("invalid_email");
  return ok(v);
}

/** Any national or international number with 7–15 digits; Turkish mobiles are stored as +905…. */
function phoneNumber(raw: string, required: boolean): Checked<string | null> {
  const v = oneLine(raw);
  if (!v) return required ? fail("required") : ok(null);
  if (v.length > L.phone || !/^\+?[\d\s().\-/]+$/.test(v) || !/^\d{7,15}$/.test(v.replace(/\D/g, ""))) return fail("invalid_phone");
  return ok(normalizeTrPhone(v) ?? v);
}

function sectorOf(raw: string): Checked<BusinessSector> {
  const v = raw.trim();
  if (!v) return fail("required");
  return isBusinessSector(v) ? ok(v) : fail("required");
}

function optionalText(raw: string, max: number): Checked<string | null> {
  const v = multiLine(raw);
  if (!v) return ok(null);
  return v.length > max ? fail("too_long") : ok(v);
}

/** "12", "1.000", "1 000" → integer; null when it is not a whole number. */
export function parseQuantity(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const compact = /^\d{1,3}(?:[.\s ]\d{3})+$/.test(v) ? v.replace(/[.\s ]/g, "") : v;
  if (!/^\d{1,9}$/.test(compact)) return null;
  return Number(compact);
}

const consentGiven = (raw: string) => raw === "on" || raw === "true" || raw === "1";
const localeOf = (raw: string): Locale => ((LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : "tr");

function setError<T>(errors: FieldErrors, path: string, checked: Checked<T>): T | undefined {
  if (checked.ok) return checked.value;
  errors[path] ??= checked.error;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Quote form

export type RawQuoteForm = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  sector: string;
  /** JSON array of QuoteLineDraft. */
  lines: string;
  message: string;
  consent: string;
  locale: string;
  /** Honeypot: hidden from people, filled in by bots. */
  website: string;
};

export function readQuoteForm(source: Source): RawQuoteForm {
  return {
    companyName: read(source, "companyName", L.company * 2),
    contactName: read(source, "contactName", L.name * 2),
    email: read(source, "email", L.email * 2),
    phone: read(source, "phone", L.phone * 2),
    sector: read(source, "sector", 40),
    lines: read(source, "lines", 20_000),
    message: read(source, "message", L.message * 2),
    consent: read(source, "consent", 10),
    locale: read(source, "locale", 10),
    website: read(source, "website", 200),
  };
}

/** `row` = the row index in the form (field errors point at `lines.<row>.*`). */
export type QuoteLineInput = { variantId: number | null; label: string; quantity: number; row: number };

export type QuoteInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  sector: BusinessSector;
  /** Product lines (variantId set, label filled in by the service) and free-text lines (variantId null). */
  lines: QuoteLineInput[];
  message: string | null;
  locale: Locale;
};

/** The rows the browser sent; anything unreadable becomes an empty list. */
export function readQuoteLines(raw: string): QuoteLineDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, L.maxLines * 2).map((item) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = typeof row.variantId === "number" ? row.variantId : typeof row.variantId === "string" ? Number(row.variantId) : NaN;
    return {
      variantId: Number.isSafeInteger(id) && id > 0 ? id : null,
      label: typeof row.label === "string" ? row.label.slice(0, L.lineLabel * 2) : "",
      quantity: typeof row.quantity === "string" || typeof row.quantity === "number" ? String(row.quantity).slice(0, 20) : "",
    };
  });
}

export function parseQuoteLines(raw: string, errors: FieldErrors): QuoteLineInput[] {
  const drafts = readQuoteLines(raw);
  const lines: QuoteLineInput[] = [];
  drafts.forEach((draft, index) => {
    const label = oneLine(draft.label);
    const blank = draft.variantId === null && !label && !draft.quantity.trim();
    if (blank) return; // an added row left empty is ignored
    const path = `lines.${index}`;
    const quantity = parseQuantity(draft.quantity);
    if (!draft.quantity.trim()) errors[`${path}.quantity`] ??= "required";
    else if (quantity === null || quantity < 1 || quantity > L.quantityMax) errors[`${path}.quantity`] ??= "invalid_quantity";
    if (draft.variantId === null) {
      if (!label) errors[`${path}.label`] ??= "required";
      else if (label.length > L.lineLabel) errors[`${path}.label`] ??= "too_long";
      else if (label.length < L.lineLabelMin) errors[`${path}.label`] ??= "too_short";
    }
    if (quantity !== null && quantity >= 1 && quantity <= L.quantityMax) {
      lines.push({ variantId: draft.variantId, label: draft.variantId === null ? label : "", quantity, row: index });
    }
  });
  if (lines.length === 0 && !Object.keys(errors).some((k) => k.startsWith("lines."))) errors.lines ??= "no_lines";
  if (lines.length > L.maxLines) errors.lines ??= "too_many_lines";
  return lines;
}

export type QuoteParseResult = { success: true; data: QuoteInput } | { success: false; fieldErrors: FieldErrors };

export function parseQuoteForm(raw: RawQuoteForm): QuoteParseResult {
  const errors: FieldErrors = {};
  const company = setError(errors, "companyName", companyName(raw.companyName));
  const contact = setError(errors, "contactName", personName(raw.contactName));
  const email = setError(errors, "email", emailAddress(raw.email));
  const phone = setError(errors, "phone", phoneNumber(raw.phone, false));
  const sector = setError(errors, "sector", sectorOf(raw.sector));
  const lines = parseQuoteLines(raw.lines, errors);
  const message = setError(errors, "message", optionalText(raw.message, L.message));
  if (!consentGiven(raw.consent)) errors.consent = "consent";
  if (Object.keys(errors).length > 0) return { success: false, fieldErrors: errors };
  return {
    success: true,
    data: {
      companyName: company!,
      contactName: contact!,
      email: email!,
      phone: phone ?? null,
      sector: sector!,
      lines: mergeProductLines(lines),
      message: message ?? null,
      locale: localeOf(raw.locale),
    },
  };
}

/** Two rows for the same variant become one row with the summed quantity (capped). */
export function mergeProductLines(lines: QuoteLineInput[]): QuoteLineInput[] {
  const out: QuoteLineInput[] = [];
  for (const line of lines) {
    const same = line.variantId !== null ? out.find((l) => l.variantId === line.variantId) : undefined;
    if (same) same.quantity = Math.min(L.quantityMax, same.quantity + line.quantity);
    else out.push({ ...line });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sample form

export type RawSampleForm = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  sector: string;
  city: string;
  district: string;
  line1: string;
  productIds: string[];
  estimatedMonthlyLiters: string;
  message: string;
  consent: string;
  locale: string;
  website: string;
};

export function readSampleForm(source: Source): RawSampleForm {
  return {
    companyName: read(source, "companyName", L.company * 2),
    contactName: read(source, "contactName", L.name * 2),
    email: read(source, "email", L.email * 2),
    phone: read(source, "phone", L.phone * 2),
    sector: read(source, "sector", 40),
    city: read(source, "city", 60),
    district: read(source, "district", L.district * 2),
    line1: read(source, "line1", L.line1 * 2),
    productIds: readAll(source, "productIds", L.maxSampleProducts),
    estimatedMonthlyLiters: read(source, "estimatedMonthlyLiters", 20),
    message: read(source, "message", L.message * 2),
    consent: read(source, "consent", 10),
    locale: read(source, "locale", 10),
    website: read(source, "website", 200),
  };
}

export type SampleInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  sector: BusinessSector;
  address: { city: string; district: string; line1: string };
  productIds: number[];
  estimatedMonthlyLiters: number | null;
  message: string | null;
  locale: Locale;
};

export type SampleParseResult = { success: true; data: SampleInput } | { success: false; fieldErrors: FieldErrors };

export function parseSampleForm(raw: RawSampleForm): SampleParseResult {
  const errors: FieldErrors = {};
  const company = setError(errors, "companyName", companyName(raw.companyName));
  const contact = setError(errors, "contactName", personName(raw.contactName));
  const email = setError(errors, "email", emailAddress(raw.email));
  const phone = setError(errors, "phone", phoneNumber(raw.phone, true));
  const sector = setError(errors, "sector", sectorOf(raw.sector));

  const province = raw.city.trim() ? findProvince(raw.city) : null;
  if (!raw.city.trim()) errors.city = "required";
  else if (!province) errors.city = "invalid_city";

  const district = oneLine(raw.district);
  if (!district) errors.district = "required";
  else if (district.length > L.district) errors.district = "too_long";
  else if (district.length < L.districtMin) errors.district = "too_short";

  const line1 = oneLine(raw.line1);
  if (!line1) errors.line1 = "required";
  else if (line1.length > L.line1) errors.line1 = "too_long";
  else if (line1.length < L.line1Min) errors.line1 = "too_short";

  const ids = [...new Set(raw.productIds.map((v) => Number(v)).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (ids.length === 0) errors.productIds = "no_products";
  else if (ids.length > L.maxSampleProducts) errors.productIds = "too_many_products";

  let liters: number | null = null;
  if (raw.estimatedMonthlyLiters.trim()) {
    liters = parseQuantity(raw.estimatedMonthlyLiters);
    if (liters === null || liters > L.litersMax) errors.estimatedMonthlyLiters = "invalid_number";
  }

  const message = setError(errors, "message", optionalText(raw.message, L.message));
  if (!consentGiven(raw.consent)) errors.consent = "consent";
  if (Object.keys(errors).length > 0) return { success: false, fieldErrors: errors };
  return {
    success: true,
    data: {
      companyName: company!,
      contactName: contact!,
      email: email!,
      phone: phone!,
      sector: sector!,
      address: { city: province!.name, district, line1 },
      productIds: ids,
      estimatedMonthlyLiters: liters,
      message: message ?? null,
      locale: localeOf(raw.locale),
    },
  };
}
