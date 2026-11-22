"use server";
// Teklif Talepleri actions (staff+). Requests are never cached on the storefront, so no tags:
// panelAction then calls refresh() and the open page re-renders with fresh data. Schemas and run
// functions live in src/lib/requests/definitions.ts (DB-tested).
import { panelAction } from "@/lib/panel/action";
import {
  noteSchema,
  quoteOfferSchema,
  quoteStatusSchema,
  runSaveQuoteNote,
  runSendQuoteOffer,
  runSetQuoteStatus,
} from "@/lib/requests/definitions";

export const setQuoteStatusAction = panelAction({ minRole: "staff", schema: quoteStatusSchema, run: runSetQuoteStatus });

export const sendQuoteOfferAction = panelAction({ minRole: "staff", schema: quoteOfferSchema, run: runSendQuoteOffer });

export const saveQuoteNoteAction = panelAction({ minRole: "staff", schema: noteSchema, run: runSaveQuoteNote });
