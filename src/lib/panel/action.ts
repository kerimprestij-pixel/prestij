// panelAction: the wrapper every panel Server Action uses.
//
//   "use server";
//   export const saveThing = panelAction({
//     minRole: "editor",
//     schema: z.object({ id: idInput, name: localizedTextInput, updatedAt: updatedAtInput }),
//     run: async (input, { actor, tx }) => {
//       const row = await lockThing(tx, input.id);          // SELECT … FOR UPDATE
//       assertFresh(row.updatedAt, input.updatedAt);
//       … update …
//       return { message: "Kaydedildi.", tags: [TAGS.things], audit: { action: "update", entity: "thing", entityId: row.id, ...auditChanges(before, after) } };
//     },
//   });
//
// Client: useActionState(saveThing, null) with a form that posts `payload` = JSON.stringify(state)
// (see toPayloadFormData). The session and role are checked on every call; tags are expired with
// updateTag after commit (no tags → refresh() so the dynamic panel page re-renders).
import "server-only";
import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { getSession, PANEL_LOGIN_PATH, staffRoleOf, type StaffRole, type StaffSession } from "@/lib/session";
import { SESSION_EXPIRED_MESSAGE, type ActionResult } from "./action-types";
import { executePanelAction, type PanelActionOptions } from "./action-core";
import { PANEL_ERROR_MESSAGES, PanelError } from "./errors";
import { hasRole } from "./roles";

export type { ActionResult, PanelErrorCode } from "./action-types";
export { toPayloadFormData, PAYLOAD_FIELD } from "./action-types";
export type { AuditEntry } from "./audit";
export type { PanelActionContext, PanelRunResult, PanelActionOptions } from "./action-core";
export type { Tx } from "./tx";
export type { StaffSession, StaffRole };

/** The signed-in, non-banned staff session, or null. For route handlers (no redirects). */
export async function getPanelActor(): Promise<StaffSession | null> {
  const session = await getSession();
  if (!session) return null;
  const staffRole = staffRoleOf(session.user.role);
  if (!staffRole || session.user.banned) return null;
  return { ...session, staffRole };
}

/**
 * For panel Server Actions/functions that do not use panelAction (reads such as pickers):
 * no session → redirect to the login page; a role below `minRole` → throws PanelError("forbidden").
 */
export async function requirePanelActor(minRole: StaffRole = "staff"): Promise<StaffSession> {
  const session = await getSession();
  if (!session) redirect(PANEL_LOGIN_PATH);
  const actor = await getPanelActor();
  if (!actor) redirect(`${PANEL_LOGIN_PATH}?hata=yetki`);
  if (!hasRole(actor.staffRole, minRole)) throw new PanelError("forbidden");
  return actor;
}

export function panelAction<S extends z.ZodType, T = undefined>(
  opts: PanelActionOptions<S, T>,
): (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>> {
  return async (_prev, formData) => {
    const session = await getSession();
    // No redirect: the editor keeps the user's draft and offers a sign-in in a new tab (usePanelForm).
    if (!session) return { ok: false, code: "forbidden", error: SESSION_EXPIRED_MESSAGE, sessionExpired: true };
    const actor = await getPanelActor();
    if (!actor) redirect(`${PANEL_LOGIN_PATH}?hata=yetki`);
    if (!hasRole(actor.staffRole, opts.minRole)) {
      return { ok: false, code: "forbidden", error: PANEL_ERROR_MESSAGES.forbidden };
    }

    const { result, tags } = await executePanelAction(opts, actor, formData);
    if (result.ok) {
      if (tags.length > 0) for (const tag of tags) updateTag(tag);
      else refresh();
    }
    return result;
  };
}
