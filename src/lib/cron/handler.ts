// The /api/cron/[group] logic without Next APIs, so DB tests call it directly.
// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; scripts/cron-local.mjs does the same.
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isJobGroup, type JobGroup } from "./registry";
import { runJobGroup, type JobGroupOutcome } from "./run";

/** Shorter secrets are treated as not configured (every request is refused). */
export const MIN_CRON_SECRET_LENGTH = 16;

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Timing-safe comparison of the Authorization header with `Bearer <secret>` (hashes have equal length). */
export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH || !authorization) return false;
  return timingSafeEqual(sha256(authorization), sha256(`Bearer ${secret}`));
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

let warnedMissingSecret = false;

export async function handleCronRequest(
  request: Request,
  group: string,
  deps: { runGroup?: (group: JobGroup) => Promise<JobGroupOutcome>; secret?: string } = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(`[cron] CRON_SECRET is not set (or shorter than ${MIN_CRON_SECRET_LENGTH} characters): /api/cron/* refuses every request.`);
    }
  }
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!isJobGroup(group)) return json({ error: "not_found" }, 404);

  const outcome = await (deps.runGroup ?? runJobGroup)(group);
  // Counts and statuses only: no error messages, no personal data.
  return json(
    {
      group: outcome.group,
      ok: outcome.ok,
      jobs: Object.fromEntries(
        outcome.jobs.map((j) => [j.key, { status: j.status, durationMs: j.durationMs, ...(j.result ? { result: j.result } : {}) }]),
      ),
    },
    outcome.ok ? 200 : 500,
  );
}
