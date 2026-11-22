// Schema + run of the inbox actions, without Next APIs: src/app/panel/(dashboard)/mesajlar/actions.ts
// wraps them in panelAction (session, role, refresh) and DB tests run them with executePanelAction.
import "server-only";
import { z } from "zod";
import type { PanelActionContext, PanelRunResult } from "@/lib/panel/action-core";
import { idInput } from "@/lib/panel/schemas";
import { deleteContactMessage, markAllMessagesRead, setMessageRead } from "./service";

export const setMessageReadSchema = z.object({ id: idInput, isRead: z.boolean() });

export async function runSetMessageRead(
  input: z.output<typeof setMessageReadSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ isRead: boolean; changed: boolean }>> {
  const { changed, audit } = await setMessageRead(tx, input);
  return {
    data: { isRead: input.isRead, changed },
    message: input.isRead ? "Mesaj okundu olarak işaretlendi." : "Mesaj okunmadı olarak işaretlendi.",
    ...(audit ? { audit } : {}),
  };
}

export const markAllMessagesReadSchema = z.object({ maxId: idInput });

export async function runMarkAllMessagesRead(
  input: z.output<typeof markAllMessagesReadSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ count: number }>> {
  const { count, audit } = await markAllMessagesRead(tx, input);
  return {
    data: { count },
    message: count > 0 ? `${count.toLocaleString("tr-TR")} mesaj okundu olarak işaretlendi.` : "Okunmamış mesaj kalmadı.",
    ...(audit ? { audit } : {}),
  };
}

export const deleteMessageSchema = z.object({ id: idInput });

export async function runDeleteMessage(
  input: z.output<typeof deleteMessageSchema>,
  { tx }: PanelActionContext,
): Promise<PanelRunResult<{ id: number }>> {
  const { audit } = await deleteContactMessage(tx, input);
  return { data: { id: input.id }, message: "Mesaj silindi.", audit };
}
