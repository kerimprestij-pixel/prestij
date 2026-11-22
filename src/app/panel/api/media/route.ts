// POST /panel/api/media — legacy media library upload (multipart: "files" repeated, optional "folder"),
// images only. Kept for back-compat with small single files: on Vercel a request body over ~4.5 MB never
// reaches this handler, so both panel clients use the day-6 direct flow (./uploads/**) instead.
// 200 { items: PanelMedia[] } | 4xx/5xx { error } (Turkish). Checks, in order: same origin, editor+
// session, body size, then per file: size, sniffed type (JPEG/PNG/WebP/AVIF; videos are refused with a
// pointer to the new flow), pixel limit.
// The proxy matcher skips /panel/api/ so the body is not buffered (10 MB cap) on its way here.
import { getPanelActor } from "@/lib/panel/action";
import { PanelError } from "@/lib/panel/errors";
import { uploadMediaFiles } from "@/lib/panel/media/service";
import { MEDIA_UPLOAD, type MediaUploadResponse } from "@/lib/panel/media/types";
import { checkUploadSize, isSameOriginRequest, MAX_UPLOAD_REQUEST_BYTES } from "@/lib/panel/media/upload";
import { hasRole } from "@/lib/panel/roles";
import { folderInput } from "@/lib/panel/schemas";
import { safeErrorInfo } from "@/lib/db-errors";

const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: MediaUploadResponse, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) {
    return reply({ error: "İstek reddedildi: yükleme yalnızca panelden yapılabilir." }, 403);
  }

  const actor = await getPanelActor();
  if (!actor) return reply({ error: "Oturumunuz sona ermiş. Lütfen yeniden giriş yapın." }, 401);
  if (!hasRole(actor.staffRole, "editor")) return reply({ error: "Görsel yüklemek için yetkiniz yok." }, 403);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return reply({ error: "Geçersiz yükleme isteği." }, 415);
  }
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) return reply({ error: "Yükleme boyutu belirlenemedi. Tekrar deneyin." }, 411);
  if (length > MAX_UPLOAD_REQUEST_BYTES) {
    return reply({ error: `Tek seferde en fazla ${MEDIA_UPLOAD.maxFiles} görsel ve görsel başına ${MEDIA_UPLOAD.maxFileBytes / 1024 / 1024} MB yükleyebilirsiniz.` }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply({ error: "Yükleme okunamadı. Bağlantınızı kontrol edip tekrar deneyin." }, 400);
  }

  const entries = form.getAll(MEDIA_UPLOAD.fileField);
  const files = entries.filter((entry): entry is File => typeof entry !== "string");
  if (files.length === 0 || files.length !== entries.length) return reply({ error: "Yüklenecek görsel seçin." }, 400);
  if (files.length > MEDIA_UPLOAD.maxFiles) {
    return reply({ error: `Tek seferde en fazla ${MEDIA_UPLOAD.maxFiles} görsel yükleyebilirsiniz.` }, 400);
  }

  const rawFolder = form.get(MEDIA_UPLOAD.folderField);
  const folder = folderInput.safeParse(typeof rawFolder === "string" && rawFolder.trim() ? rawFolder : MEDIA_UPLOAD.defaultFolder);
  if (!folder.success) return reply({ error: folder.error.issues[0]?.message ?? "Klasör adı geçersiz." }, 400);

  try {
    // Sizes first, without reading the bodies.
    for (const file of files) {
      const sizeError = checkUploadSize(file);
      if (sizeError) return reply({ error: sizeError }, 413);
    }
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, data: Buffer.from(await file.arrayBuffer()) })));
    const items = await uploadMediaFiles(inputs, { folder: folder.data, actorId: actor.user.id });
    return reply({ items });
  } catch (error) {
    if (error instanceof PanelError) return reply({ error: error.message }, error.code === "server" ? 500 : 400);
    console.error("[panel] media upload route failed", safeErrorInfo(error));
    return reply({ error: "Görseller yüklenemedi. Lütfen tekrar deneyin." }, 500);
  }
}
