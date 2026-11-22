// Optimistic locking for panel editors. Every editor sends back the `updatedAt` it loaded; the service
// re-reads the row inside its transaction (SELECT … FOR UPDATE) and calls assertFresh before writing.
// Pure: no DB access.
import { PanelError } from "./errors";

export const CONFLICT_MESSAGE = "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyin.";

type Stamp = Date | string | number | null | undefined;

/** Milliseconds since the epoch, or null for a missing/invalid value. */
function toMillis(value: Stamp): number | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** True when both stamps denote the same instant (millisecond precision, like JS Dates). */
export function sameInstant(a: Stamp, b: Stamp): boolean {
  const ma = toMillis(a);
  const mb = toMillis(b);
  return ma !== null && mb !== null && ma === mb;
}

/**
 * Throws PanelError("conflict") unless the row still has the `updatedAt` the editor loaded. A missing
 * expected value is a conflict too (the client must always send it).
 */
export function assertFresh(rowUpdatedAt: Stamp, expectedUpdatedAt: Stamp): void {
  if (!sameInstant(rowUpdatedAt, expectedUpdatedAt)) throw new PanelError("conflict", CONFLICT_MESSAGE);
}

/** Same guard for values that are not timestamps (e.g. the stock the user saw in a quick edit). */
export function assertUnchanged<T>(current: T, expected: T, message = CONFLICT_MESSAGE): void {
  if (current !== expected) throw new PanelError("conflict", message);
}
