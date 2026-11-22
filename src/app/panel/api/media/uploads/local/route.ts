// PUT /panel/api/media/uploads/local?ticket=… — step 2 of a direct upload on the LOCAL storage driver only
// (with Supabase the browser PUTs to Supabase's signed URL and this route answers 404). The raw request
// body is streamed to the ticket's staging key on disk (never buffered whole), capped at the declared
// size. /panel/api/ is outside the proxy matcher, so nothing buffers or truncates the body on its way
// here. 200 { ok: true, bytes } | 4xx/5xx { error } (Turkish).
import { getUploadStorage } from "@/lib/media/storage";
import { receiveLocalUpload } from "@/lib/panel/media/direct-upload";
import { errorReply, reply, requireUploader } from "../../route-helpers";

export async function PUT(request: Request): Promise<Response> {
  let driver: string;
  try {
    driver = getUploadStorage().driver;
  } catch (error) {
    return errorReply(error, "media storage misconfigured", "Depolama ayarlı değil. Yöneticinize başvurun.");
  }
  if (driver !== "local") return reply({ error: "Bulunamadı." }, 404);

  const guard = await requireUploader(request);
  if ("response" in guard) return guard.response;

  const ticket = new URL(request.url).searchParams.get("ticket");
  const lengthHeader = request.headers.get("content-length");
  const length = lengthHeader === null ? null : Number(lengthHeader);
  if (length !== null && (!Number.isSafeInteger(length) || length < 0)) return reply({ error: "Geçersiz yükleme isteği." }, 400);

  try {
    const { bytes } = await receiveLocalUpload(ticket, request.body, length, { actorId: guard.actor.user.id });
    return reply({ ok: true, bytes });
  } catch (error) {
    return errorReply(error, "local media upload failed", "Dosya kaydedilemedi. Lütfen tekrar deneyin.");
  }
}
