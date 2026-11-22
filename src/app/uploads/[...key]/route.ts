// GET/HEAD /uploads/<key> — serves panel uploads of the local storage driver from LOCAL_UPLOAD_DIR
// (default storage/uploads). Uploads cannot live in public/: `next start` indexes public/ once at boot,
// so files added later would 404. Images (AVIF/WebP/PNG/JPEG) and, from day 6, videos (MP4/WebM) with
// HTTP Range (206/416), streamed; HEAD without a body (Next would otherwise run GET for HEAD). See
// ../serve.ts for the rules. With STORAGE_DRIVER=supabase the files are served by Supabase (which
// supports Range itself) and this route always 404s.
import { localUploadRoot, storageDriver } from "@/lib/media/storage";
import { serveUpload } from "@/app/uploads/serve";

type Context = { params: Promise<{ key: string[] }> };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

async function handle(request: Request, { params }: Context): Promise<Response> {
  let driver: string;
  try {
    driver = storageDriver();
  } catch {
    return notFound();
  }
  if (driver !== "local") return notFound();
  const { key: parts } = await params;
  return serveUpload(request, (parts ?? []).join("/"), localUploadRoot());
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}

export async function HEAD(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}
