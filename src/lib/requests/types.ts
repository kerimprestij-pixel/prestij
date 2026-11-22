// Quote and sample request forms (sections `quote_form` and `sample_request_form`) and their panel
// workflows: shared types, limits, status rules and reference numbers. Pure: safe in client components.
import type { BusinessSector, RequestStatus } from "@/db/schema/commerce";

/** Every sector a business can choose on the forms (= BusinessSector, in display order). */
export const BUSINESS_SECTORS = ["hotel", "spa", "office", "restaurant", "hospital", "school", "retail", "other"] as const satisfies readonly BusinessSector[];

export function isBusinessSector(value: unknown): value is BusinessSector {
  return typeof value === "string" && (BUSINESS_SECTORS as readonly string[]).includes(value);
}

export const REQUEST_LIMITS = {
  companyMin: 2,
  company: 160,
  nameMin: 2,
  name: 120,
  email: 254,
  phone: 30,
  message: 3000,
  lineLabelMin: 2,
  lineLabel: 160,
  maxLines: 20,
  quantityMax: 100_000,
  districtMin: 2,
  district: 80,
  line1Min: 5,
  line1: 250,
  litersMax: 1_000_000,
  maxSampleProducts: 8,
} as const;

/** Field error codes; the forms show them in the visitor's language (messages.requests.errors). */
export type RequestFieldError =
  | "required"
  | "invalid_name"
  | "invalid_company"
  | "invalid_email"
  | "invalid_phone"
  | "too_short"
  | "too_long"
  | "invalid_quantity"
  | "invalid_product"
  | "no_lines"
  | "too_many_lines"
  | "consent"
  | "invalid_city"
  | "no_products"
  | "too_many_products"
  | "invalid_number";

export type QuoteField = "companyName" | "contactName" | "email" | "phone" | "sector" | "lines" | "message" | "consent";
export type SampleField =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "sector"
  | "city"
  | "district"
  | "line1"
  | "productIds"
  | "estimatedMonthlyLiters"
  | "message"
  | "consent";

/** One row of the quote form as the browser sends it (JSON in the hidden `lines` field). */
export type QuoteLineDraft = { variantId: number | null; label: string; quantity: string };

/** useActionState state of both forms. Start with INITIAL_REQUEST_STATE. */
export type RequestFormState = {
  status: "idle" | "success" | "error";
  /** invalid: see fieldErrors · too_many: rate limit (retryMinutes) · server: storing failed · closed: form switched off. */
  error?: "invalid" | "too_many" | "server" | "closed";
  /** Paths like "email", "lines", "lines.2.quantity", "productIds". */
  fieldErrors?: Record<string, RequestFieldError>;
  retryMinutes?: number;
  /** The submitted raw values, echoed after an error so the form can be refilled (never after success). */
  values?: Record<string, string | string[]>;
  /** Reference shown after success, e.g. "TKL-00012". Null for a dropped honeypot submission. */
  reference?: string | null;
  /** Increases with every submission (lets the client remount the fields with the echoed values). */
  attempt: number;
};

export const INITIAL_REQUEST_STATE: RequestFormState = { status: "idle", attempt: 0 };

/** Prefill for signed-in customers (loadRequestPrefill). Empty strings when unknown. */
export type RequestPrefill = {
  contactName: string;
  email: string;
  phone: string;
  companyName: string;
  sector: BusinessSector | "";
};

// ---------------------------------------------------------------------------------------------
// Reference numbers (shown to the requester and in the panel)

export const quoteRef = (id: number) => `TKL-${String(id).padStart(5, "0")}`;
export const sampleRef = (id: number) => `NMN-${String(id).padStart(5, "0")}`;

/** "TKL-00012", "tkl12", "#12" or "12" → 12 (panel search); null otherwise. */
export function parseRequestRef(value: string, prefix: "TKL" | "NMN"): number | null {
  const match = new RegExp(`^(?:#|${prefix}-?)?0*(\\d{1,9})$`, "i").exec(value.trim());
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------------------------
// Status workflows (enforced by the panel services)

export type QuoteStatus = Extract<RequestStatus, "new" | "in_review" | "quoted" | "won" | "rejected">;
export type SampleStatus = Extract<RequestStatus, "new" | "in_review" | "approved" | "shipped" | "won" | "rejected">;

export const QUOTE_STATUSES = ["new", "in_review", "quoted", "won", "rejected"] as const satisfies readonly QuoteStatus[];
export const SAMPLE_STATUSES = ["new", "in_review", "approved", "shipped", "won", "rejected"] as const satisfies readonly SampleStatus[];

/**
 * Plain status changes per current status. "quoted" is reached only by sending an offer
 * (QUOTE_OFFER_FROM); a rejected request can be reopened for review.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  new: ["in_review", "rejected"],
  in_review: ["rejected"],
  quoted: ["won", "rejected"],
  won: [],
  rejected: ["in_review"],
};
/** Statuses from which "Teklifi gönder" may send (again: a revised offer replaces the previous one). */
export const QUOTE_OFFER_FROM: readonly QuoteStatus[] = ["new", "in_review", "quoted"];

/**
 * Plain status changes per current status. "shipped" is reached only through the shipping form
 * (carrier + tracking number, SAMPLE_SHIP_FROM). Rejecting before shipping e-mails the requester
 * (sample_rejected); after shipping it only closes the lead ("did not become a customer").
 */
export const SAMPLE_TRANSITIONS: Record<SampleStatus, readonly SampleStatus[]> = {
  new: ["in_review", "approved", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["rejected"],
  shipped: ["won", "rejected"],
  won: [],
  rejected: ["in_review"],
};
export const SAMPLE_SHIP_FROM: readonly SampleStatus[] = ["approved"];

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === "string" && (QUOTE_STATUSES as readonly string[]).includes(value);
}
export function isSampleStatus(value: unknown): value is SampleStatus {
  return typeof value === "string" && (SAMPLE_STATUSES as readonly string[]).includes(value);
}
