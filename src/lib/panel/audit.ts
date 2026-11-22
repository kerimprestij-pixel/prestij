// Audit log writes for panel mutations. Rows go into the caller's transaction, so a rolled-back change
// leaves no audit row. Secrets never reach the table: keys that look like credentials are dropped and
// long strings are shortened. Keep before/after to the changed record (auditChanges helps).
// Imports only the table definition (not the db client), so the pure helpers are unit-testable.
import { auditLog } from "@/db/schema";
import type { Tx } from "./tx";

/** What a panelAction `run` may return under `audit`; the actor is filled in from the session. */
export type AuditEntry = {
  /** create | update | delete | publish | archive | duplicate | upload | move | … */
  action: string;
  /** Table-ish name: product, category, page, media, settings, legal_document, … */
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  /** Defaults to the acting user. */
  actorId?: string | null;
};

export type AuditRecord = AuditEntry & { actorId: string | null };

/** Keys that never go into the audit log (any nesting level, case-insensitive). */
const SECRET_KEY = /pass(word)?|secret|token|hash|api[-_]?key|service[-_]?key|private[-_]?key|cookie|session|credential|^otp$|^cvv$|^cvc$|card[-_]?number/i;
const MAX_STRING = 4000;
const MAX_ARRAY = 200;
const MAX_DEPTH = 8;

/** Copy of `value` that is safe to store: no secret-looking keys, bounded size, Dates as ISO strings. */
export function scrubAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null; // functions, symbols
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => scrubAudit(v, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY}]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    if (v === undefined) continue;
    out[key] = scrubAudit(v, depth + 1);
  }
  return out;
}

/** JSON with object keys sorted at every level: jsonb returns keys in its own order (ar, en, tr). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

const same = (a: unknown, b: unknown) => stableStringify(scrubAudit(a)) === stableStringify(scrubAudit(b));

const isEmptyRecord = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && Object.keys(value).length === 0;

/** An "update" entry whose before and after are both empty objects (auditChanges found no change) is not written. */
export function isNoopAudit(entry: AuditEntry): boolean {
  return entry.action === "update" && isEmptyRecord(entry.before) && isEmptyRecord(entry.after);
}

/**
 * Only the top-level fields that differ, e.g. for an update: `audit: { action: "update", entity:
 * "product", entityId: id, ...auditChanges(before, after) }`. Returns empty objects when nothing changed.
 * Fields listed in `ignore` (default: updatedAt, createdAt) are left out.
 */
export function auditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  { ignore = ["updatedAt", "createdAt"] }: { ignore?: string[] } = {},
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const outBefore: Record<string, unknown> = {};
  const outAfter: Record<string, unknown> = {};
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    if (same(b[key], a[key])) continue;
    if (key in b) outBefore[key] = b[key];
    if (key in a) outAfter[key] = a[key];
  }
  return { before: outBefore, after: outAfter };
}

/** Inserts one audit row in the given transaction (or db). */
export async function writeAudit(tx: Tx, entry: AuditRecord): Promise<void> {
  await tx.insert(auditLog).values({
    userId: entry.actorId ?? null,
    action: entry.action.slice(0, 64),
    entity: entry.entity.slice(0, 64),
    entityId: entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId).slice(0, 200),
    before: entry.before === undefined ? null : scrubAudit(entry.before),
    after: entry.after === undefined ? null : scrubAudit(entry.after),
  });
}
