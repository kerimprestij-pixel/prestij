// Checkout form validation (zod 4). Pure: the checkout UI may import it for client-side hints, but
// placeOrder always re-validates on the server. Every error message is a field error CODE; show it
// with messages.checkout.errors[code].
import { z } from "zod";
import { LOCALES } from "@/i18n/locales";
import { PAYMENT_METHODS } from "@/lib/cart/types";
import { findProvince, isValidTckn, isValidVkn, normalizeTrPhone } from "@/lib/validation/tr";

export type CheckoutFieldErrorCode =
  | "required"
  | "invalid"
  | "too_short"
  | "too_long"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_province"
  | "invalid_postal_code"
  | "invalid_tckn"
  | "invalid_tax_number"
  | "consent_required";

const FIELD_CODES = new Set<string>([
  "required",
  "invalid",
  "too_short",
  "too_long",
  "invalid_email",
  "invalid_phone",
  "invalid_province",
  "invalid_postal_code",
  "invalid_tckn",
  "invalid_tax_number",
  "consent_required",
]);

/**
 * C0 control characters other than tab/newline/carriage return, and DEL. PostgreSQL refuses NUL in
 * text and jsonb, and none of them belongs in a name, an address or a note.
 */
export const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noControlChars = (v: string | undefined) => v === undefined || !CONTROL_CHARS.test(v);

/** Required trimmed text with min/max length. */
const text = (min: number, max: number) =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .min(min, { error: "too_short" })
    .max(max, { error: "too_long" })
    .refine(noControlChars, { error: "invalid" });

/** Optional trimmed text; "" becomes undefined. */
const optionalText = (max: number) =>
  z
    .string({ error: "invalid" })
    .trim()
    .max(max, { error: "too_long" })
    .refine(noControlChars, { error: "invalid" })
    .optional()
    .transform((v) => (v ? v : undefined));

const phone = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .transform((value, ctx) => {
    const normalized = normalizeTrPhone(value);
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
  .max(254, { error: "too_long" })
  .pipe(z.email({ error: "invalid_email" }));

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
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^\d{5}$/.test(v), { error: "invalid_postal_code" });

/** An optional non-negative integer amount (kuruş) from a hidden input. */
const expectedAmount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
  z.number({ error: "invalid" }).int({ error: "invalid" }).min(0, { error: "invalid" }).optional(),
);

/** true for true/"on"/"true"/"1"/"yes"; everything else false. */
const boolish = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1" || v === "yes", z.boolean());

export const addressSchema = z.object(
  {
    fullName: text(3, 100),
    city: province,
    district: text(2, 60),
    neighbourhood: optionalText(80),
    line1: text(5, 250),
    postalCode,
  },
  { error: "required" },
);

const digitsOnly = (v: unknown) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v);

const individualInvoice = z.object({
  type: z.literal("individual"),
  /** Defaults to the delivery name. */
  fullName: optionalText(100),
  /** Optional TCKN; when given it must pass the checksum. Empty = e-Arşiv default 11111111111. */
  nationalId: z.preprocess(
    digitsOnly,
    z
      .string({ error: "invalid_tckn" })
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || isValidTckn(v), { error: "invalid_tckn" }),
  ),
  sameAsShipping: boolish.default(true),
  address: addressSchema.optional(),
});

const corporateInvoice = z.object({
  type: z.literal("corporate"),
  companyName: text(2, 200),
  taxOffice: text(2, 100),
  /** VKN (10 digits) or, for sole proprietors, TCKN (11 digits). */
  taxNumber: z.preprocess(
    digitsOnly,
    z
      .string({ error: "required" })
      .min(1, { error: "required" })
      .refine((v) => isValidVkn(v) || isValidTckn(v), { error: "invalid_tax_number" }),
  ),
  eInvoice: boolish.default(false),
  sameAsShipping: boolish.default(true),
  address: addressSchema.optional(),
});

/** The billing address is ignored when "same as shipping" is ticked (hidden inputs may still post it). */
const invoiceSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const v = value as Record<string, unknown>;
    const same = v.sameAsShipping === undefined ? true : v.sameAsShipping === true || v.sameAsShipping === "on" || v.sameAsShipping === "true" || v.sameAsShipping === "1";
    if (!same) return v;
    const copy = { ...v };
    delete copy.address;
    return copy;
  },
  z.discriminatedUnion("type", [individualInvoice, corporateInvoice], { error: "required" }),
);

export const checkoutSchema = z
  .object({
    locale: z.enum(LOCALES).catch("tr"),
    contact: z.object({ email, phone }, { error: "required" }),
    shippingAddress: addressSchema,
    invoice: invoiceSchema,
    paymentMethod: z.enum(PAYMENT_METHODS, { error: "required" }),
    consents: z.object(
      {
        preInformation: z.preprocess((v) => v === true || v === "on" || v === "true", z.literal(true, { error: "consent_required" })),
        distanceSales: z.preprocess((v) => v === true || v === "on" || v === "true", z.literal(true, { error: "consent_required" })),
      },
      { error: "consent_required" },
    ),
    customerNote: optionalText(500),
    /** The grand total the buyer saw for the chosen method; a mismatch returns "price_changed". */
    expectedTotal: expectedAmount,
    /**
     * The grand total shown for each method (hidden inputs expectedTotals.<method>), so a form posted
     * without JavaScript is checked against the method actually chosen. Wins over expectedTotal.
     */
    expectedTotals: z
      .object(Object.fromEntries(PAYMENT_METHODS.map((m) => [m, expectedAmount])) as Record<(typeof PAYMENT_METHODS)[number], typeof expectedAmount>)
      .partial()
      .optional()
      .catch(undefined),
    /** CartView.revision the buyer saw (lines + quantities + coupon); a mismatch returns "cart_changed". */
    expectedCart: z.string().max(4000).optional().catch(undefined),
  })
  .superRefine((data, ctx) => {
    if (!data.invoice.sameAsShipping && !data.invoice.address) {
      for (const field of ["fullName", "city", "district", "line1"]) {
        ctx.addIssue({ code: "custom", message: "required", path: ["invoice", "address", field] });
      }
    }
  });

/** What the form/client sends (strings allowed). */
export type CheckoutInput = z.input<typeof checkoutSchema>;
/** Validated, normalized checkout data (phone +905…, province canonical name, trimmed strings). */
export type CheckoutData = z.output<typeof checkoutSchema>;
export type CheckoutAddress = z.output<typeof addressSchema>;

/** Field path ("shippingAddress.city", "invoice.taxNumber", "consents.preInformation", …) → error code. */
export type CheckoutFieldErrors = Record<string, CheckoutFieldErrorCode>;

/** Runs the schema and maps zod issues to { "path.to.field": code } (first error per field wins). */
export function validateCheckout(input: unknown): { ok: true; data: CheckoutData } | { ok: false; fieldErrors: CheckoutFieldErrors } {
  const result = checkoutSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: CheckoutFieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join(".") || "form";
    if (fieldErrors[path]) continue;
    fieldErrors[path] = (FIELD_CODES.has(issue.message) ? issue.message : issue.code === "invalid_type" ? "required" : "invalid") as CheckoutFieldErrorCode;
  }
  return { ok: false, fieldErrors };
}

/** Checkbox fields: present in FormData → true, absent → false. */
export const CHECKOUT_CHECKBOX_FIELDS = ["invoice.sameAsShipping", "invoice.eInvoice", "consents.preInformation", "consents.distanceSales"] as const;

/**
 * Turns flat FormData (input names are the field paths, e.g. name="shippingAddress.city") into the
 * nested object checkoutSchema expects. Checkboxes listed in CHECKOUT_CHECKBOX_FIELDS become booleans.
 * Unknown/odd keys are ignored (no prototype keys).
 */
export function checkoutFormDataToInput(formData: FormData): Record<string, unknown> {
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
    set(key, value);
  }
  for (const field of CHECKOUT_CHECKBOX_FIELDS) {
    const v = formData.get(field);
    set(field, v === "on" || v === "true" || v === "1");
  }
  return out;
}
