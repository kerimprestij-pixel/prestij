// Payment attempts remembered in payments.raw.attempts[] (pure). Each initiate() of a real provider adds
// one entry: the provider's reference (iyzico token / PayTR merchant_oid), the environment and, for PayTR,
// the iframe URL. Callbacks use them to recognise their attempt and its test mode.

export type StoredAttempt = {
  /** 1-based attempt number for the order and provider. */
  n: number;
  ref: string;
  testMode: boolean;
  /** ISO time the attempt was started. */
  at: string;
  conversationId?: string;
  iframeUrl?: string;
  /** Kuruş requested from PayTR (payment_amount). */
  paymentAmount?: number;
};

/** At most this many attempts are kept per payments row. */
export const MAX_STORED_ATTEMPTS = 10;

export function attemptsOf(raw: unknown): StoredAttempt[] {
  const list = raw && typeof raw === "object" ? (raw as { attempts?: unknown }).attempts : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (a): a is StoredAttempt =>
      !!a && typeof a === "object" && typeof (a as StoredAttempt).ref === "string" && typeof (a as StoredAttempt).n === "number" && typeof (a as StoredAttempt).at === "string",
  );
}

/** payments.raw with one more attempt (oldest dropped beyond MAX_STORED_ATTEMPTS). */
export function withAttempt(raw: unknown, attempt: StoredAttempt): Record<string, unknown> {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { ...base, attempts: [...attemptsOf(raw), attempt].slice(-MAX_STORED_ATTEMPTS) };
}

/** The attempt with `ref` among several payments rows' raw values, newest first. */
export function findAttempt(raws: readonly unknown[], ref: string): StoredAttempt | null {
  for (const raw of raws) {
    const hit = attemptsOf(raw).find((a) => a.ref === ref);
    if (hit) return hit;
  }
  return null;
}

/**
 * A failed row recorded for an older attempt after the buyer had started a newer one (a second tab, a
 * provider time-out): kept for the record, but it says nothing about the open attempt, so "latest
 * payment" lookups skip it.
 */
export function isSupersededPayment(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as { superseded?: unknown }).superseded === true;
}

/**
 * Go-live CF-11: a payment that moved no money: the local simulator, or a provider result taken in test mode
 * (payments.raw.testMode from the panel's mode at the time, or the provider's own test flag, e.g. PayTR's
 * test_mode while its merchant panel is not live yet). The panel order page and the admin new-order e-mail
 * flag such orders with a red "TEST ÖDEMESİ – para çekilmedi".
 */
export function isTestPayment(provider: string, raw: unknown): boolean {
  if (provider === "simulator") return true;
  if (!raw || typeof raw !== "object") return false;
  const r = raw as { testMode?: unknown; providerTestMode?: unknown; simulator?: unknown };
  return r.testMode === true || r.providerTestMode === true || r.simulator === true;
}

/** payments.raw.lastError.message: the provider's refusal reason of the last start attempt (go-live CF-12), or null. */
export function lastErrorOf(raw: unknown): string | null {
  const last = raw && typeof raw === "object" ? (raw as { lastError?: unknown }).lastError : undefined;
  const message = last && typeof last === "object" ? (last as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message : null;
}

/** True when a paid (or later refunded) payment row of the order was a test payment. */
export function hasTestPayment(rows: readonly { provider: string; status: string; raw: unknown }[]): boolean {
  return rows.some((row) => (row.status === "succeeded" || row.status === "refunded") && isTestPayment(row.provider, row.raw));
}
