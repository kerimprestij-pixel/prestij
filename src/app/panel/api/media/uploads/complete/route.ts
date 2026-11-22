// POST /panel/api/media/uploads/complete — step 3 of a direct upload. Body (JSON): { ticket, meta?: { width,
// height, durationMs } (videos: what the browser measured), posterId? (the video's cover image), alt?,
// purpose?: "poster" }. Re-checks the stored size and the real type (head bytes), then processes an image
// (variants encoded one after another) or moves a video to its final key, and creates the media row.
// 200 { item: PanelMedia, warnings: string[] } | 4xx/5xx { error } (Turkish; a refused file is deleted).
import { z } from "zod";
import { completeDirectUpload } from "@/lib/panel/media/direct-upload";
import { mediaIdInput, optionalLocalizedTextOf } from "@/lib/panel/schemas";
import { errorReply, readJsonBody, reply, requireUploader } from "../../route-helpers";

/** Image processing of a 15 MB original takes seconds; stay within every Vercel plan's limit. */
export const maxDuration = 60;

const measured = z.number().int().positive().max(1_000_000_000).optional().catch(undefined);

const completeInput = z.object({
  ticket: z.string({ error: "Yükleme bileti eksik." }).min(1, "Yükleme bileti eksik.").max(2048, "Yükleme bileti geçersiz."),
  meta: z.object({ width: measured, height: measured, durationMs: measured }).nullish().catch(undefined),
  posterId: mediaIdInput,
  alt: optionalLocalizedTextOf({ max: 250 }),
  purpose: z.literal("poster").optional().catch(undefined),
});

export async function POST(request: Request): Promise<Response> {
  const guard = await requireUploader(request);
  if ("response" in guard) return guard.response;

  const body = await readJsonBody(request);
  if (body === null) return reply({ error: "Geçersiz yükleme isteği." }, 415);
  const parsed = completeInput.safeParse(body);
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? "Geçersiz yükleme isteği." }, 400);

  try {
    const result = await completeDirectUpload(parsed.data, { actorId: guard.actor.user.id });
    return reply(result);
  } catch (error) {
    return errorReply(error, "media upload completion failed");
  }
}
