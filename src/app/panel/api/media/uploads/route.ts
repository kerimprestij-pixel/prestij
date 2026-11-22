// POST /panel/api/media/uploads — step 1 of a direct upload (one file per request, docs/DAY6-WHEEL-VIDEO.md
// §1.2). Body (JSON): { name, size, type, kind: "image" | "video", folder }. Validates the declared file
// (type, kind, size limits, folder) and answers 200 { ticket, upload: { url, method: "PUT", headers },
// expiresAt }: the browser PUTs the raw file to upload.url with exactly those headers, then calls
// /panel/api/media/uploads/complete with the ticket. Errors: 400/401/403/415/500 { error } (Turkish).
import { z } from "zod";
import { MEDIA_KINDS } from "@/lib/media/types";
import { startDirectUpload } from "@/lib/panel/media/direct-upload";
import { MEDIA_UPLOAD } from "@/lib/panel/media/types";
import { folderInput } from "@/lib/panel/schemas";
import { errorReply, readJsonBody, reply, requireUploader } from "../route-helpers";

const ticketInput = z.object({
  name: z.string({ error: "Dosya adı eksik." }).trim().min(1, "Dosya adı eksik.").max(400, "Dosya adı çok uzun."),
  size: z.number({ error: "Dosya boyutu eksik." }).int("Dosya boyutu geçersiz.").positive("Dosya boş."),
  type: z.string().max(100).optional().default(""),
  kind: z.enum(MEDIA_KINDS, { error: "Yükleme türü geçersiz." }),
  folder: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : MEDIA_UPLOAD.defaultFolder))
    .pipe(folderInput),
});

export async function POST(request: Request): Promise<Response> {
  const guard = await requireUploader(request);
  if ("response" in guard) return guard.response;

  const body = await readJsonBody(request);
  if (body === null) return reply({ error: "Geçersiz yükleme isteği." }, 415);
  const parsed = ticketInput.safeParse(body);
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? "Geçersiz yükleme isteği." }, 400);

  try {
    const result = await startDirectUpload(parsed.data, { actorId: guard.actor.user.id });
    return reply(result);
  } catch (error) {
    return errorReply(error, "media upload ticket failed", "Yükleme başlatılamadı. Lütfen tekrar deneyin.");
  }
}
