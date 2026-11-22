"use server";
// Legal documents (admin only): publish a new version, restore an old one, read one for the history viewer.
import { panelAction, requirePanelActor } from "@/lib/panel/action";
import { idInput } from "@/lib/panel/schemas";
import { getLegalVersion, legalPublishOptions, legalRestoreOptions } from "@/lib/panel/legal/service";

export const publishLegalVersionAction = panelAction(legalPublishOptions);
export const restoreLegalVersionAction = panelAction(legalRestoreOptions);

/** One stored version (sanitized, notice split from the body) for the "Görüntüle" dialog. */
export async function getLegalVersionAction(id: number) {
  await requirePanelActor("admin");
  const parsed = idInput.safeParse(id);
  if (!parsed.success) return null;
  return getLegalVersion(parsed.data);
}
