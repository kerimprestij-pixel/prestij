import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { isBlockedAuthPath } from "@/lib/auth-limits";

const handlers = toNextJsHandler(auth);

/**
 * The admin plugin's endpoints are not served over HTTP: the panel calls them in-process
 * (`auth.api.*`) from its team actions, which enforce the team rules and write the audit log.
 */
function guarded(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    if (isBlockedAuthPath(new URL(request.url).pathname)) {
      return Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return handler(request);
  };
}

export const GET = guarded(handlers.GET);
export const POST = guarded(handlers.POST);
export const PATCH = guarded(handlers.PATCH);
export const PUT = guarded(handlers.PUT);
export const DELETE = guarded(handlers.DELETE);
