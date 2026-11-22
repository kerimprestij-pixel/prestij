// GET|POST /api/cron/<group> — runs the scheduled jobs of a group ("frequent" | "daily").
// Authorization: Bearer <CRON_SECRET> (Vercel Cron sends it), 401 without it, 404 for unknown groups,
// JSON with statuses and counts only. Logic and tests: src/lib/cron/handler.ts.
import { handleCronRequest } from "@/lib/cron/handler";

/** Seconds; jobs work in bounded batches and continue on the next run. */
export const maxDuration = 60;

type Context = { params: Promise<{ group: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleCronRequest(request, (await params).group);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleCronRequest(request, (await params).group);
}
