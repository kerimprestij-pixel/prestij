"use server";
// Inbox actions (staff+). Messages are never cached on the storefront, so no tags: panelAction then
// calls refresh() and the inbox, the open message and the sidebar badge re-render with fresh counts.
// The schemas and run functions live in src/lib/panel/messages/definitions.ts (DB-tested).
import { panelAction } from "@/lib/panel/action";
import {
  deleteMessageSchema,
  markAllMessagesReadSchema,
  runDeleteMessage,
  runMarkAllMessagesRead,
  runSetMessageRead,
  setMessageReadSchema,
} from "@/lib/panel/messages/definitions";

export const setMessageReadAction = panelAction({ minRole: "staff", schema: setMessageReadSchema, run: runSetMessageRead });

export const markAllMessagesReadAction = panelAction({ minRole: "staff", schema: markAllMessagesReadSchema, run: runMarkAllMessagesRead });

export const deleteMessageAction = panelAction({ minRole: "staff", schema: deleteMessageSchema, run: runDeleteMessage });
