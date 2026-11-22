// The session-free half of panelAction: parse the JSON payload, validate it, run the service in one
// transaction with its audit rows, and map errors to an ActionResult. No Next request APIs here, so DB
// tests can call executePanelAction with a fake actor; panelAction (action.ts) adds the session check
// and the cache invalidation after commit.
import "server-only";
import type { z } from "zod";
import { db } from "@/db";
import { pgErrorCode, safeErrorInfo } from "@/lib/db-errors";
import type { StaffSession } from "@/lib/session";
import type { ActionResult } from "./action-types";
import { isNoopAudit, writeAudit, type AuditEntry } from "./audit";
import { PANEL_ERROR_MESSAGES, PanelError } from "./errors";
import { PAYLOAD_FIELD } from "./action-types";
import type { Tx } from "./tx";

export type { ActionResult, AuditEntry, Tx };

export type PanelActionContext = { actor: StaffSession; tx: Tx };

export type PanelRunResult<T> = {
  data?: T;
  /** Turkish success message for the toast. */
  message?: string;
  /** Cache tags to expire after commit (updateTag), deduplicated. */
  tags?: string[];
  /** Written in the same transaction; actorId defaults to the session user. */
  audit?: AuditEntry | AuditEntry[];
  /** Runs after a successful commit (e.g. deleting files from storage). Errors are logged, not returned. */
  afterCommit?: () => void | Promise<void>;
};

export type PanelActionOptions<S extends z.ZodType, T> = {
  minRole: StaffSession["staffRole"];
  schema: S;
  run: (input: z.output<S>, ctx: PanelActionContext) => Promise<PanelRunResult<T>>;
};

export type PanelActionOutcome<T> = { result: ActionResult<T>; tags: string[] };

/**
 * Next.js control-flow throws (redirect(), notFound(), forbidden(), dynamic bailouts) carry these
 * digests; they must propagate instead of becoming an error result. Same checks as unstable_rethrow,
 * which cannot be imported outside the Next runtime (next/navigation resolves to the client build in
 * plain Node, so DB tests would not load).
 */
const NEXT_CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_PRERENDER_INTERRUPTED|HANGING_PROMISE_REJECTION)/;

export function isNextControlFlowError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string" && NEXT_CONTROL_FLOW.test(digest)) return true;
  return isNextControlFlowError((error as { cause?: unknown }).cause, depth + 1);
}

/** Largest accepted payload (characters). Server Actions already cap the body at 1 MB. */
const MAX_PAYLOAD = 1_000_000;

const UNREADABLE = "Gönderilen bilgiler okunamadı. Sayfayı yenileyip tekrar deneyin.";

/** Zod issues → { "variants.2.price": "message" } (first message per path) and a general message. */
export function zodFieldErrors(issues: readonly z.core.$ZodIssue[]): { fieldErrors: Record<string, string>; formError: string | null } {
  const fieldErrors: Record<string, string> = {};
  let formError: string | null = null;
  for (const issue of issues) {
    const path = issue.path.map((p) => String(p)).join(".");
    if (!path) {
      formError ??= issue.message;
      continue;
    }
    fieldErrors[path] ??= issue.message;
  }
  return { fieldErrors, formError };
}

/** Reads and JSON-parses the `payload` field. A plain object/array (no FormData) is accepted as-is (tests). */
export function readPayload(input: FormData | unknown): { ok: true; value: unknown } | { ok: false } {
  if (!(input instanceof FormData)) return { ok: true, value: input };
  const raw = input.get(PAYLOAD_FIELD);
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PAYLOAD) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

function fail<T>(code: PanelError["code"], error: string, fieldErrors?: Record<string, string>): ActionResult<T> {
  return fieldErrors && Object.keys(fieldErrors).length > 0 ? { ok: false, code, error, fieldErrors } : { ok: false, code, error };
}

/** Maps a thrown error to a failure result; unknown errors are logged without their message (PII). */
export function errorToResult<T>(error: unknown, label = "action"): ActionResult<T> {
  if (error instanceof PanelError) return fail(error.code, error.message, error.fieldErrors);
  const code = pgErrorCode(error);
  if (code === "23505") return fail("invalid", "Bu değer başka bir kayıtta zaten kullanılıyor. Lütfen farklı bir değer girin.");
  if (code === "23503") return fail("in_use", PANEL_ERROR_MESSAGES.in_use);
  if (code === "40001" || code === "40P01" || code === "55P03") {
    return fail("conflict", "Aynı anda başka bir değişiklik yapıldı. Lütfen tekrar deneyin.");
  }
  if (code === "22001" || code === "22003") return fail("invalid", "Girilen değerlerden biri çok uzun veya çok büyük.");
  console.error(`[panel] ${label} failed`, safeErrorInfo(error));
  return fail("server", PANEL_ERROR_MESSAGES.server);
}

function uniqueTags(tags: readonly unknown[] | undefined): string[] {
  const out = new Set<string>();
  for (const tag of tags ?? []) if (typeof tag === "string" && tag.length > 0 && tag.length <= 256) out.add(tag);
  return [...out];
}

/**
 * Validates `input` (FormData with `payload`, or a plain value) and runs `opts.run` in one transaction
 * together with its audit rows. Does not check the session (the caller passes a verified actor) and
 * does not touch the Next cache: it returns the tags to expire after commit.
 */
export async function executePanelAction<S extends z.ZodType, T>(
  opts: Pick<PanelActionOptions<S, T>, "schema" | "run">,
  actor: StaffSession,
  input: FormData | unknown,
  { label = "action" }: { label?: string } = {},
): Promise<PanelActionOutcome<T>> {
  const payload = readPayload(input);
  if (!payload.ok) return { result: fail("invalid", UNREADABLE), tags: [] };

  const parsed = await opts.schema.safeParseAsync(payload.value);
  if (!parsed.success) {
    const { fieldErrors, formError } = zodFieldErrors(parsed.error.issues);
    return { result: fail("invalid", formError ?? PANEL_ERROR_MESSAGES.invalid, fieldErrors), tags: [] };
  }

  let out: PanelRunResult<T>;
  try {
    out = await db.transaction(async (tx) => {
      const result = await opts.run(parsed.data as z.output<S>, { actor, tx });
      const entries = result.audit === undefined ? [] : Array.isArray(result.audit) ? result.audit : [result.audit];
      for (const entry of entries) {
        if (isNoopAudit(entry)) continue; // a save without changes leaves no misleading "update" row
        await writeAudit(tx, { ...entry, actorId: entry.actorId === undefined ? actor.user.id : entry.actorId });
      }
      return result;
    });
  } catch (error) {
    if (isNextControlFlowError(error)) throw error; // redirect()/notFound() thrown by a service must reach Next
    return { result: errorToResult<T>(error, label), tags: [] };
  }

  if (out.afterCommit) {
    try {
      await out.afterCommit();
    } catch (error) {
      console.error(`[panel] ${label} afterCommit failed`, safeErrorInfo(error));
    }
  }

  const result: ActionResult<T> = { ok: true };
  if (out.data !== undefined) result.data = out.data;
  if (out.message) result.message = out.message;
  return { result, tags: uniqueTags(out.tags) };
}
