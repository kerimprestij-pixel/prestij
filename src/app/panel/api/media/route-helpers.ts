// Shared pieces of the media upload route handlers (not a route: Next only routes route.ts files).
// Order of checks in every handler: same origin → editor+ session → input. Replies are JSON with
// `Cache-Control: no-store`; errors are Turkish `{ error }`.
import "server-only";
import { safeErrorInfo } from "@/lib/db-errors";
import { getPanelActor, type StaffSession } from "@/lib/panel/action";
import { PanelError } from "@/lib/panel/errors";
import { isSameOriginRequest } from "@/lib/panel/media/upload";
import { hasRole } from "@/lib/panel/roles";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Same-origin + editor session, or the error response to return. */
export async function requireUploader(request: Request): Promise<{ actor: StaffSession } | { response: Response }> {
  if (!isSameOriginRequest(request.headers)) {
    return { response: reply({ error: "İstek reddedildi: yükleme yalnızca panelden yapılabilir." }, 403) };
  }
  const actor = await getPanelActor();
  if (!actor) return { response: reply({ error: "Oturumunuz sona ermiş. Lütfen yeniden giriş yapın." }, 401) };
  if (!hasRole(actor.staffRole, "editor")) return { response: reply({ error: "Dosya yüklemek için yetkiniz yok." }, 403) };
  return { actor };
}

/** A small JSON body (tickets and completions are a few hundred bytes); null when missing, too big or not JSON. */
export async function readJsonBody(request: Request, maxBytes = 16 * 1024): Promise<unknown | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return null;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const STATUS: Record<string, number> = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409, in_use: 409, server: 500 };

/** PanelError → its status; anything else is logged (no secrets) and answered with a generic 500. */
export function errorReply(error: unknown, label: string, fallback = "Yükleme tamamlanamadı. Lütfen tekrar deneyin."): Response {
  if (error instanceof PanelError) return reply({ error: error.message }, STATUS[error.code] ?? 400);
  console.error(`[panel] ${label}`, safeErrorInfo(error));
  return reply({ error: fallback }, 500);
}
