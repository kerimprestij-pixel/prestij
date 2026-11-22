// Product reviews: shared constants and serializable types (pure; safe in client components).
//
// Flow: a customer writes a review (signed in, or through the signed link of the review request
// e-mail) → it waits as `pending` → an editor approves, rejects, replies or deletes it in
// /panel/yorumlar → approved reviews appear on the product page (cached, tag `reviews:<productId>`)
// and products.rating_average / rating_count follow every change (product cards show the stars).

/** Purpose label of the signed review link (src/lib/signed-token.ts). Payload: { orderId, productId }. */
export const REVIEW_TOKEN_PURPOSE = "review";
/** How long a review link from the e-mail stays valid. */
export const REVIEW_LINK_TTL_DAYS = 90;
export const REVIEW_LINK_TTL_SECONDS = REVIEW_LINK_TTL_DAYS * 24 * 60 * 60;
/** Query parameter of the review link on the product page: /urunler/<slug>?degerlendir=<token>. */
export const REVIEW_TOKEN_PARAM = "degerlendir";
/** Id of the reviews section on the product page (links jump here). */
export const REVIEWS_ANCHOR = "degerlendirmeler";

/** Reviews per page on the product page ("Daha fazla göster" loads the next page). */
export const REVIEW_PAGE_SIZE = 6;
/** Deepest page "Daha fazla göster" can load (bounds the cache entries per product). */
export const REVIEW_MAX_OFFSET = 600;

export const REVIEW_LIMITS = {
  title: 120,
  body: 2000,
  displayName: 40,
  reply: 1500,
} as const;

/** Orders delivered longer ago than this (plus the settings delay) never get a review request. */
export const REVIEW_REQUEST_MAX_AGE_DAYS = 30;
/** Orders per job run; the next run continues. */
export const REVIEW_REQUEST_BATCH = 200;

/** Durable limits of the review form (keys review:ip:<ip>, review:user:<id>; every valid attempt counts). */
export const REVIEW_RATE_RULES = {
  ip: { limit: 10, windowMs: 60 * 60_000 },
  user: { limit: 20, windowMs: 24 * 60 * 60_000 },
} as const;

export type ReviewStatus = "pending" | "approved" | "rejected";

/** One approved review as the storefront shows it (no user, order or e-mail data). */
export type PublicReview = {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  /** Language the review was written in (lang attribute). */
  locale: string;
  verified: boolean;
  /** ISO timestamp the review was written. */
  createdAt: string;
  /** The shop's public answer. */
  reply: string | null;
};

/** A public review with its date already formatted for the page's locale (avoids hydration drift). */
export type ReviewView = PublicReview & { dateLabel: string };

export type ReviewSummary = {
  count: number;
  /** Average × 100 (470 = 4.70), like products.rating_average. 0 when there are no reviews. */
  average: number;
  /** Number of approved reviews per star: index 0 = 1 star … index 4 = 5 stars. */
  distribution: [number, number, number, number, number];
};

export type ProductReviewsData = {
  productId: number;
  summary: ReviewSummary;
  /** The newest approved reviews (first page). */
  reviews: PublicReview[];
  hasMore: boolean;
};

export type ReviewPage = { reviews: PublicReview[]; hasMore: boolean };

export const EMPTY_SUMMARY: ReviewSummary = { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] };

// ---------------------------------------------------------------------------------------------
// The review form island

/** What the visitor's own review looks like when they may still edit it (pending). */
export type OwnReviewDraft = { rating: number; title: string; body: string; displayName: string };

export type ReviewFormState =
  /** Reviews are switched off in the panel. */
  | { status: "disabled" }
  /** Not signed in and no (valid) review link: offer sign-in. */
  | { status: "signed_out" }
  /** A review link that cannot be used. */
  | { status: "link_error"; reason: "invalid" | "expired" | "used" | "not_eligible" }
  /** The visitor already reviewed this product and can no longer change it. */
  | { status: "reviewed"; reviewStatus: "approved" | "rejected" }
  /** The form may be shown. `existing` = their pending review (editing it). */
  | {
      status: "ready";
      via: "account" | "link";
      defaultName: string;
      verified: boolean;
      existing: OwnReviewDraft | null;
    };

export type ReviewField = "rating" | "title" | "body" | "displayName";
export type ReviewFieldError = "required" | "too_short" | "too_long" | "invalid";

export type ReviewSubmitError =
  | "invalid"
  | "rate_limited"
  | "signed_out"
  | "link_invalid"
  | "link_expired"
  | "already_reviewed"
  | "not_eligible"
  | "disabled"
  | "server";

export type ReviewSubmitResult =
  | { ok: true; updated: boolean }
  | {
      ok: false;
      error: ReviewSubmitError;
      fieldErrors?: Partial<Record<ReviewField, ReviewFieldError>>;
      retryAfterMinutes?: number;
    };

/** Input of the storefront submit action (validated again on the server). */
export type ReviewSubmitInput = {
  productId: number;
  locale: string;
  rating: number;
  title: string;
  body: string;
  displayName: string;
  /** The signed link token (guest reviews), if the page was opened from the e-mail. */
  token?: string | null;
  /** Honeypot: must stay empty. */
  website?: string;
};
