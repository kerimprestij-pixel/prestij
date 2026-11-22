// Day 6 FIX (SEO-3), pure: the Turkish message for a refused file PUT of the direct upload flow.
//   our own route (local driver, a relative URL): 401 = the panel session ended; its JSON `error` is ours;
//   the storage (Supabase signed URL, absolute): its refusal is shown as such, with the storage's own
//     `message`/`error` text and where the go-live checklist explains the storage settings. A 401 there is
//     never "session expired" (signing in again would not help: e.g. a missing apikey on the gateway).

export const SESSION_ERROR = "Oturumunuz sona erdi. Sayfayı yenileyip tekrar giriş yapın.";
export const STORAGE_HELP = "SEO Kontrol › Yayına alma adımları › “Fotoğraf ve video depolama” adımına bakın.";

/** The message for a failed PUT of `targetUrl` with `status` and the response body text. */
export function putFailureMessage(targetUrl: string, status: number, responseText: string): string {
  const own = targetUrl.startsWith("/");
  if (own && status === 401) return SESSION_ERROR;
  if (status === 413) return "Dosya depolamanın boyut sınırını aşıyor.";
  let body: { error?: unknown; message?: unknown } | null = null;
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (parsed && typeof parsed === "object") body = parsed as { error?: unknown; message?: unknown };
  } catch {
    // not JSON (an error page)
  }
  if (own) {
    return typeof body?.error === "string" ? body.error : `Dosya gönderilemedi (HTTP ${status}). Lütfen tekrar deneyin.`;
  }
  const raw = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "";
  const detail = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return `Depolama dosyayı reddetti (HTTP ${status})${detail ? `: ${detail}` : ""}. ${STORAGE_HELP}`;
}
