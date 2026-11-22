// Panel workflows of quote and sample requests: status changes, the offer, shipping, admin notes.
// Services take (tx, input, actor) and never touch Next APIs, so DB tests call them directly; the
// Server Actions in src/app/panel/(dashboard)/{teklifler,numune-talepleri}/actions.ts wrap them in
// panelAction (session, role, audit, refresh). Every row is re-read FOR UPDATE and guarded by the
// updatedAt the editor loaded; e-mails are queued in the same transaction.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { QuoteOffer } from "@/db/schema/commerce";
import { localize } from "@/i18n/localize";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { enqueueQuoteOffer, enqueueSampleStatusMail, loadRequestDisplay } from "./emails";
import {
  QUOTE_OFFER_FROM,
  QUOTE_TRANSITIONS,
  REQUEST_LIMITS,
  SAMPLE_SHIP_FROM,
  SAMPLE_TRANSITIONS,
  type QuoteStatus,
  type SampleStatus,
} from "./types";

export type WorkflowActor = { userId: string | null };

/** Turkish status names for error messages (the panel badges use REQUEST_STATUS in components/panel/labels). */
const STATUS_NAME: Record<QuoteStatus | SampleStatus, string> = {
  new: "Yeni",
  in_review: "İnceleniyor",
  approved: "Onaylandı",
  quoted: "Teklif verildi",
  shipped: "Gönderildi",
  won: "Kazanıldı",
  rejected: "Reddedildi",
};

const notAllowed = (from: string, to: string) =>
  new PanelError(
    "invalid",
    `Bu talep “${STATUS_NAME[from as QuoteStatus] ?? from}” durumundayken “${STATUS_NAME[to as QuoteStatus] ?? to}” yapılamaz. Sayfayı yenileyip tekrar deneyin.`,
  );

/** Today in Istanbul as YYYY-MM-DD. */
export function istanbulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ---------------------------------------------------------------------------------------------
// Quotes

async function lockQuote(tx: Tx, id: number, updatedAt: Date) {
  const t = schema.quoteRequests;
  const [row] = await tx.select().from(t).where(eq(t.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Teklif talebi bulunamadı; silinmiş olabilir.");
  assertFresh(row.updatedAt, updatedAt);
  return row;
}

export type QuoteStatusInput = { id: number; status: QuoteStatus; updatedAt: Date };

export async function setQuoteStatus(tx: Tx, input: QuoteStatusInput): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const row = await lockQuote(tx, input.id, input.updatedAt);
  const from = row.status as QuoteStatus;
  if (!QUOTE_TRANSITIONS[from]?.includes(input.status)) throw notAllowed(from, input.status);
  const [saved] = await tx
    .update(schema.quoteRequests)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(schema.quoteRequests.id, row.id))
    .returning({ updatedAt: schema.quoteRequests.updatedAt });
  return {
    updatedAt: saved.updatedAt,
    audit: { action: "status", entity: "quote_request", entityId: row.id, before: { status: from }, after: { status: input.status } },
  };
}

export type QuoteOfferLineInput = { variantId: number | null; label: string; quantity: number; unitPrice: number };
export type QuoteOfferInput = { id: number; updatedAt: Date; lines: QuoteOfferLineInput[]; validUntil: string | null; note: string | null };

export const OFFER_LIMITS = { maxLines: 50, note: 2000, maxTotal: 2_000_000_000 } as const;

/**
 * Saves the offer (lines with unit prices, validity, note, server-computed total), sets the request to
 * "quoted" and queues the quote_offer e-mail in the requester's language. Sending again from "quoted"
 * replaces the offer and sends a revised mail.
 */
export async function sendQuoteOffer(
  tx: Tx,
  input: QuoteOfferInput,
  actor: WorkflowActor,
  now = new Date(),
): Promise<{ updatedAt: Date; total: number; emailQueued: boolean; audit: AuditEntry }> {
  const row = await lockQuote(tx, input.id, input.updatedAt);
  const from = row.status as QuoteStatus;
  if (!QUOTE_OFFER_FROM.includes(from)) throw notAllowed(from, "quoted");

  if (input.lines.length === 0) throw fieldError("lines", "Teklife en az bir kalem ekleyin.");
  if (input.lines.length > OFFER_LIMITS.maxLines) throw fieldError("lines", `Bir teklifte en fazla ${OFFER_LIMITS.maxLines} kalem olabilir.`);
  if (input.validUntil && input.validUntil < istanbulToday(now)) throw fieldError("validUntil", "Geçerlilik tarihi bugünden önce olamaz.");

  // Product lines get their names from the database (the mail localizes them again for the reader).
  const variantIds = input.lines.flatMap((l) => (l.variantId ? [l.variantId] : []));
  const display = await loadRequestDisplay(tx, { variantIds });
  const existing = variantIds.length
    ? new Set((await tx.select({ id: schema.productVariants.id }).from(schema.productVariants).where(inArray(schema.productVariants.id, variantIds))).map((r) => r.id))
    : new Set<number>();
  const lines: QuoteOffer["lines"] = input.lines.map((line, index) => {
    if (line.variantId) {
      if (!existing.has(line.variantId)) throw fieldError(`lines.${index}.label`, "Bu ürün artık mevcut değil; satırı kaldırın veya serbest satır olarak yazın.");
      const variant = display.variants.get(line.variantId)!;
      const product = display.products.get(variant.productId);
      const size = variant.labels.map((l) => localize(l, "tr")).filter(Boolean).join(" · ");
      const label = [product ? localize(product.name, "tr") : line.label, size].filter(Boolean).join(" · ");
      return { variantId: line.variantId, label, quantity: line.quantity, unitPrice: line.unitPrice };
    }
    const label = line.label.trim();
    if (label.length < REQUEST_LIMITS.lineLabelMin) throw fieldError(`lines.${index}.label`, "Kalemin adını yazın.");
    return { label, quantity: line.quantity, unitPrice: line.unitPrice };
  });
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  if (total <= 0) throw fieldError("lines", "Teklif toplamı sıfır olamaz; birim fiyatları girin.");
  if (total > OFFER_LIMITS.maxTotal) throw fieldError("lines", "Teklif toplamı çok yüksek görünüyor; adetleri ve fiyatları kontrol edin.");

  const offer: QuoteOffer = {
    lines,
    total,
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  // quotedAt qualifies the mail's dedupe key: keep it strictly increasing per request.
  const quotedAt = row.quotedAt && row.quotedAt.getTime() >= now.getTime() ? new Date(row.quotedAt.getTime() + 1) : now;
  const [saved] = await tx
    .update(schema.quoteRequests)
    .set({ offer, offerTotal: total, quotedAt, status: "quoted", updatedAt: new Date() })
    .where(eq(schema.quoteRequests.id, row.id))
    .returning();
  const email = await enqueueQuoteOffer(tx, { ...saved, offer, quotedAt }, actor.userId);
  return {
    updatedAt: saved.updatedAt,
    total,
    emailQueued: email !== null,
    audit: {
      action: "status",
      entity: "quote_request",
      entityId: row.id,
      before: { status: from, offerTotal: row.offerTotal },
      after: { status: "quoted", offerTotal: total, lines: lines.length, validUntil: offer.validUntil ?? null, revised: from === "quoted" },
    },
  };
}

export type NoteInput = { id: number; adminNote: string | null; updatedAt: Date };

export async function saveQuoteNote(tx: Tx, input: NoteInput): Promise<{ updatedAt: Date; audit: AuditEntry | null }> {
  const row = await lockQuote(tx, input.id, input.updatedAt);
  if ((row.adminNote ?? null) === input.adminNote) return { updatedAt: row.updatedAt, audit: null };
  const [saved] = await tx
    .update(schema.quoteRequests)
    .set({ adminNote: input.adminNote, updatedAt: new Date() })
    .where(eq(schema.quoteRequests.id, row.id))
    .returning({ updatedAt: schema.quoteRequests.updatedAt });
  // The note's text stays out of the audit log (it may hold personal details); its length is enough.
  return {
    updatedAt: saved.updatedAt,
    audit: { action: "update", entity: "quote_request", entityId: row.id, before: { adminNoteLength: row.adminNote?.length ?? 0 }, after: { adminNoteLength: input.adminNote?.length ?? 0 } },
  };
}

// ---------------------------------------------------------------------------------------------
// Samples

async function lockSample(tx: Tx, id: number, updatedAt: Date) {
  const t = schema.sampleRequests;
  const [row] = await tx.select().from(t).where(eq(t.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Numune talebi bulunamadı; silinmiş olabilir.");
  assertFresh(row.updatedAt, updatedAt);
  return row;
}

export type SampleStatusInput = { id: number; status: SampleStatus; updatedAt: Date; /** Rejection only: shown to the requester. */ note?: string | null };

/**
 * Plain status changes. "approved" e-mails sample_approved; "rejected" before shipping e-mails
 * sample_rejected (with the optional note), after shipping it only closes the lead (no e-mail).
 */
export async function setSampleStatus(
  tx: Tx,
  input: SampleStatusInput,
  actor: WorkflowActor,
  now = new Date(),
): Promise<{ updatedAt: Date; emailQueued: boolean | null; audit: AuditEntry }> {
  const row = await lockSample(tx, input.id, input.updatedAt);
  const from = row.status as SampleStatus;
  if (!SAMPLE_TRANSITIONS[from]?.includes(input.status)) throw notAllowed(from, input.status);
  const patch: Partial<typeof schema.sampleRequests.$inferInsert> = { status: input.status, updatedAt: new Date() };
  if (input.status === "approved") patch.approvedAt = now;
  const [saved] = await tx.update(schema.sampleRequests).set(patch).where(eq(schema.sampleRequests.id, row.id)).returning();

  let emailQueued: boolean | null = null;
  if (input.status === "approved") {
    emailQueued = (await enqueueSampleStatusMail(tx, saved, { kind: "approved" }, actor.userId)) !== null;
  } else if (input.status === "rejected" && from !== "shipped") {
    emailQueued = (await enqueueSampleStatusMail(tx, saved, { kind: "rejected", note: input.note?.trim() || null }, actor.userId)) !== null;
  }
  return {
    updatedAt: saved.updatedAt,
    emailQueued,
    audit: {
      action: "status",
      entity: "sample_request",
      entityId: row.id,
      before: { status: from },
      after: { status: input.status, ...(input.status === "rejected" ? { emailed: from !== "shipped", withNote: Boolean(input.note?.trim()) } : {}) },
    },
  };
}

export type ShipSampleInput = { id: number; carrier: string; trackingNumber: string; updatedAt: Date };

/** "4 40 ab-12" → "440AB-12"; null unless 4–40 letters, digits and dashes. */
export function normalizeTrackingNumber(value: string): string | null {
  const v = value.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9-]{4,40}$/.test(v) ? v : null;
}

/** Approved → shipped with the carrier (from Ayarlar → Kargo) and tracking number; e-mails sample_shipped. */
export async function shipSample(
  tx: Tx,
  input: ShipSampleInput,
  actor: WorkflowActor,
  now = new Date(),
): Promise<{ updatedAt: Date; emailQueued: boolean; audit: AuditEntry }> {
  const row = await lockSample(tx, input.id, input.updatedAt);
  const from = row.status as SampleStatus;
  if (!SAMPLE_SHIP_FROM.includes(from)) throw notAllowed(from, "shipped");
  const [settingsRow] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "shipping")).limit(1);
  const carrier = parseSettings("shipping", settingsRow?.value).carriers.find((c) => c.key === input.carrier);
  if (!carrier) throw fieldError("carrier", "Kargo firmasını listeden seçin.");
  const tracking = normalizeTrackingNumber(input.trackingNumber);
  if (!tracking) throw fieldError("trackingNumber", "Takip numarası 4–40 harf, rakam ve tireden oluşmalı.");
  const [saved] = await tx
    .update(schema.sampleRequests)
    .set({ status: "shipped", carrier: carrier.key, trackingNumber: tracking, shippedAt: now, updatedAt: new Date() })
    .where(eq(schema.sampleRequests.id, row.id))
    .returning();
  const email = await enqueueSampleStatusMail(tx, saved, { kind: "shipped" }, actor.userId);
  return {
    updatedAt: saved.updatedAt,
    emailQueued: email !== null,
    audit: { action: "status", entity: "sample_request", entityId: row.id, before: { status: from }, after: { status: "shipped", carrier: carrier.key } },
  };
}

export async function saveSampleNote(tx: Tx, input: NoteInput): Promise<{ updatedAt: Date; audit: AuditEntry | null }> {
  const row = await lockSample(tx, input.id, input.updatedAt);
  if ((row.adminNote ?? null) === input.adminNote) return { updatedAt: row.updatedAt, audit: null };
  const [saved] = await tx
    .update(schema.sampleRequests)
    .set({ adminNote: input.adminNote, updatedAt: new Date() })
    .where(eq(schema.sampleRequests.id, row.id))
    .returning({ updatedAt: schema.sampleRequests.updatedAt });
  return {
    updatedAt: saved.updatedAt,
    audit: { action: "update", entity: "sample_request", entityId: row.id, before: { adminNoteLength: row.adminNote?.length ?? 0 }, after: { adminNoteLength: input.adminNote?.length ?? 0 } },
  };
}
