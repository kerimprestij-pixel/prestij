// When a PayTR attempt may still turn out paid (pure: unit-tested in tests/unit/paytr-fix-a1.test.ts).
//
// PayTR's payment form accepts a payment for PAYTR_TIMEOUT_MINUTES (timeout_limit) after get-token, and the
// result reaches us only through the server-to-server notification, which PayTR repeats "after a minute" when
// it gets no "OK" (dev.paytr.com iFrame API steps 1 and 2). merchant_ok_url confirms nothing. So until
// PAYTR_VERIFY_WINDOW_MINUTES have passed since the latest attempt started, an attempt without a recorded result
// may still be paid: the order pages say "Ödemeniz doğrulanıyor" instead of offering a retry (a new attempt could
// charge the card twice), retryCardPayment refuses, and the expiry job does not cancel the order (it also asks
// PayTR's Durum Sorgu first; see reconcile.ts and expireStalePendingOrders).
import { attemptsOf, type StoredAttempt } from "./attempts";
import { PAYTR_TIMEOUT_MINUTES } from "./paytr-crypto";

/** timeout_limit (30) plus margin for a late or repeated notification. */
export const PAYTR_VERIFY_WINDOW_MINUTES = PAYTR_TIMEOUT_MINUTES + 15;
export const PAYTR_VERIFY_WINDOW_MS = PAYTR_VERIFY_WINDOW_MINUTES * 60_000;
/** Our card page offers the attempt's form until shortly before PayTR closes it. */
export const PAYTR_FORM_USABLE_MS = (PAYTR_TIMEOUT_MINUTES - 2) * 60_000;
/** A PayTR order whose result stays unknown this long (counted from its latest attempt) becomes a dashboard to-do. */
export const PAYTR_UNVERIFIED_ALERT_HOURS = 24;
/** order_events.type of that to-do (written once per order by the expiry job). */
export const PAYMENT_UNVERIFIED_EVENT = "payment_unverified";

/** The payments columns this module reads (any provider; only "paytr" rows count). */
export type PaymentRowLike = {
  provider: string;
  status: string;
  providerRef: string | null;
  raw: unknown;
  updatedAt?: Date | string | null;
};

export type PaytrAttempt = StoredAttempt & { /** ms epoch the attempt started (attempt.at, else its row's updatedAt). */ startedAt: number | null };

export type PaytrAttemptState = {
  /** Every PayTR attempt of the order (one per merchant_oid), newest first. */
  attempts: PaytrAttempt[];
  /** Attempts without a recorded result (no succeeded / failed / refunded row with that merchant_oid), newest first. */
  unsettled: PaytrAttempt[];
  latest: PaytrAttempt | null;
  /** The recorded result of the latest attempt, or null while it has none. */
  latestResult: "succeeded" | "failed" | "refunded" | null;
  /** The latest attempt has no result and started less than PAYTR_VERIFY_WINDOW_MINUTES ago (or its start is unknown). */
  verifying: boolean;
  /** ms epoch when that window ends (verifying only). */
  verifyUntil: number | null;
  /** verifying, and the latest attempt's form is still usable on our card page (same merchant_oid: no second charge). */
  formOpen: boolean;
};

const timeOf = (value: Date | string | null | undefined): number | null => {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

/** The PayTR attempts of an order and where the latest one stands at `now` (ms epoch). */
export function paytrAttemptState(rows: readonly PaymentRowLike[], now: number): PaytrAttemptState {
  const paytr = rows.filter((r) => r.provider === "paytr");
  const results = new Map<string, "succeeded" | "failed" | "refunded">();
  for (const r of paytr) {
    if (r.providerRef && (r.status === "succeeded" || r.status === "failed" || r.status === "refunded") && !results.has(r.providerRef)) {
      results.set(r.providerRef, r.status);
    }
  }
  const byRef = new Map<string, PaytrAttempt>();
  for (const r of paytr) {
    for (const a of attemptsOf(r.raw)) {
      if (byRef.has(a.ref)) continue;
      byRef.set(a.ref, { ...a, startedAt: timeOf(a.at) ?? timeOf(r.updatedAt) });
    }
  }
  const attempts = [...byRef.values()].sort((a, b) => b.n - a.n || (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const unsettled = attempts.filter((a) => !results.has(a.ref));
  const latest = attempts[0] ?? null;
  const latestResult = latest ? (results.get(latest.ref) ?? null) : null;
  const open = latest !== null && latestResult === null;
  // An unknown start time counts as "just started": better a wait than a second charge.
  const verifyUntil = open ? (latest.startedAt ?? now) + PAYTR_VERIFY_WINDOW_MS : null;
  const verifying = verifyUntil !== null && now < verifyUntil;
  const formOpen = verifying && !!latest?.iframeUrl && latest.startedAt !== null && now - latest.startedAt < PAYTR_FORM_USABLE_MS;
  return { attempts, unsettled, latest, latestResult, verifying, verifyUntil: verifying ? verifyUntil : null, formOpen };
}

/** The expiry job may ask PayTR (and then cancel) only once the latest attempt is out of the window. */
export function paytrWindowPassed(state: Pick<PaytrAttemptState, "latest">, now: number): boolean {
  const started = state.latest?.startedAt;
  return state.latest === null || (started != null && now - started >= PAYTR_VERIFY_WINDOW_MS);
}

/** An order whose PayTR result is still unknown this long after its latest attempt gets the dashboard to-do. */
export function paytrUnverifiedAlertDue(state: Pick<PaytrAttemptState, "latest">, now: number): boolean {
  const started = state.latest?.startedAt;
  return started != null && now - started >= PAYTR_UNVERIFIED_ALERT_HOURS * 3_600_000;
}
