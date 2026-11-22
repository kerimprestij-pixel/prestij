// Schema + run of the quote and sample panel actions, without Next APIs: the action files in
// src/app/panel/(dashboard)/{teklifler,numune-talepleri}/actions.ts wrap them in panelAction (staff+;
// session, role, audit, refresh) and DB tests run them with executePanelAction. No cache tags: requests
// are never cached on the storefront, so panelAction refreshes the current page.
import "server-only";
import { z } from "zod";
import type { PanelActionContext, PanelRunResult } from "@/lib/panel/action-core";
import { idInput, kurusInput, textInput, updatedAtInput } from "@/lib/panel/schemas";
import { QUOTE_STATUSES, REQUEST_LIMITS, SAMPLE_STATUSES } from "./types";
import { OFFER_LIMITS, saveQuoteNote, saveSampleNote, sendQuoteOffer, setQuoteStatus, setSampleStatus, shipSample } from "./workflow";

const STATUS_DONE: Record<string, string> = {
  new: "Talep “Yeni” olarak işaretlendi.",
  in_review: "Talep incelemeye alındı.",
  approved: "Talep onaylandı.",
  quoted: "Teklif gönderildi.",
  shipped: "Numuneler kargoya verildi olarak işaretlendi.",
  won: "Talep “Kazanıldı” olarak kapatıldı.",
  rejected: "Talep reddedildi.",
};

const actorOf = (ctx: PanelActionContext) => ({ userId: ctx.actor.user.id });

// ---------------------------------------------------------------------------------------------
// Quotes

export const quoteStatusSchema = z.object({ id: idInput, status: z.enum(QUOTE_STATUSES), updatedAt: updatedAtInput });

export async function runSetQuoteStatus(input: z.output<typeof quoteStatusSchema>, { tx }: PanelActionContext): Promise<PanelRunResult<{ updatedAt: string }>> {
  const { updatedAt, audit } = await setQuoteStatus(tx, input);
  return { data: { updatedAt: updatedAt.toISOString() }, message: STATUS_DONE[input.status], audit };
}

const quantity = z.coerce
  .number({ error: "Adet girin." })
  .int("Adet tam sayı olmalı.")
  .min(1, "Adet en az 1 olmalı.")
  .max(REQUEST_LIMITS.quantityMax, `Adet en fazla ${REQUEST_LIMITS.quantityMax.toLocaleString("tr-TR")} olabilir.`);

const offerLine = z.object({
  variantId: z.union([z.null(), z.literal(""), idInput]).optional().transform((v) => (typeof v === "number" ? v : null)),
  label: z.string().trim().max(REQUEST_LIMITS.lineLabel, `En fazla ${REQUEST_LIMITS.lineLabel} karakter.`).default(""),
  quantity,
  unitPrice: kurusInput,
});

const isoDate = z
  .union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarihi gün.ay.yıl olarak seçin.")])
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime()), "Geçerli bir tarih seçin.");

export const quoteOfferSchema = z.object({
  id: idInput,
  updatedAt: updatedAtInput,
  lines: z.array(offerLine).min(1, "Teklife en az bir kalem ekleyin.").max(OFFER_LIMITS.maxLines, `En fazla ${OFFER_LIMITS.maxLines} kalem.`),
  validUntil: isoDate,
  note: textInput({ required: false, max: OFFER_LIMITS.note }),
});

export async function runSendQuoteOffer(
  input: z.output<typeof quoteOfferSchema>,
  ctx: PanelActionContext,
): Promise<PanelRunResult<{ updatedAt: string; total: number; emailQueued: boolean }>> {
  const { updatedAt, total, emailQueued, audit } = await sendQuoteOffer(ctx.tx, input, actorOf(ctx));
  return {
    data: { updatedAt: updatedAt.toISOString(), total, emailQueued },
    message: emailQueued
      ? "Teklif gönderildi; e-posta birazdan müşteriye ulaşır."
      : "Teklif kaydedildi, ancak “Teklif” e-posta şablonu kapalı olduğu için e-posta gönderilmedi.",
    audit,
  };
}

export const noteSchema = z.object({ id: idInput, adminNote: textInput({ required: false, max: 4000 }), updatedAt: updatedAtInput });

export async function runSaveQuoteNote(input: z.output<typeof noteSchema>, { tx }: PanelActionContext): Promise<PanelRunResult<{ updatedAt: string }>> {
  const { updatedAt, audit } = await saveQuoteNote(tx, input);
  return { data: { updatedAt: updatedAt.toISOString() }, message: "Not kaydedildi.", ...(audit ? { audit } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Samples

export const sampleStatusSchema = z.object({
  id: idInput,
  status: z.enum(SAMPLE_STATUSES),
  updatedAt: updatedAtInput,
  note: textInput({ required: false, max: 1000 }),
});

export async function runSetSampleStatus(
  input: z.output<typeof sampleStatusSchema>,
  ctx: PanelActionContext,
): Promise<PanelRunResult<{ updatedAt: string; emailQueued: boolean | null }>> {
  const { updatedAt, emailQueued, audit } = await setSampleStatus(ctx.tx, input, actorOf(ctx));
  const mail = emailQueued === true ? " Müşteriye e-posta gönderiliyor." : emailQueued === false ? " E-posta şablonu kapalı olduğu için e-posta gönderilmedi." : "";
  return { data: { updatedAt: updatedAt.toISOString(), emailQueued }, message: `${STATUS_DONE[input.status]}${mail}`, audit };
}

export const shipSampleSchema = z.object({
  id: idInput,
  carrier: z.string({ error: "Kargo firmasını seçin." }).trim().min(1, "Kargo firmasını seçin.").max(60),
  trackingNumber: z.string({ error: "Takip numarasını yazın." }).trim().min(1, "Takip numarasını yazın.").max(60, "Takip numarası çok uzun."),
  updatedAt: updatedAtInput,
});

export async function runShipSample(
  input: z.output<typeof shipSampleSchema>,
  ctx: PanelActionContext,
): Promise<PanelRunResult<{ updatedAt: string; emailQueued: boolean }>> {
  const { updatedAt, emailQueued, audit } = await shipSample(ctx.tx, input, actorOf(ctx));
  return {
    data: { updatedAt: updatedAt.toISOString(), emailQueued },
    message: emailQueued ? "Kargoya verildi; takip numarası müşteriye e-postayla gönderiliyor." : "Kargoya verildi; e-posta şablonu kapalı olduğu için e-posta gönderilmedi.",
    audit,
  };
}

export async function runSaveSampleNote(input: z.output<typeof noteSchema>, { tx }: PanelActionContext): Promise<PanelRunResult<{ updatedAt: string }>> {
  const { updatedAt, audit } = await saveSampleNote(tx, input);
  return { data: { updatedAt: updatedAt.toISOString() }, message: "Not kaydedildi.", ...(audit ? { audit } : {}) };
}
