// E-mails of the quote and sample workflows (and the contact form's admin notification), queued with
// enqueueEmail inside the caller's transaction. Product names are re-read and localized for the
// recipient; dedupe keys follow docs/DAY4-CORE-API.md §5.4. No Next APIs (DB tests call these).
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { QuoteOffer } from "@/db/schema/commerce";
import { isLocale, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { adminRecipients, enqueueEmail } from "@/lib/email";
import type { RequestEmailLine, RequestEmailProduct } from "@/lib/email/templates/requests";
import type { ContactSubject } from "@/lib/contact/subjects";
import { firstNameOf } from "@/lib/customer/viewer";
import { imageOnly, mediaColumns } from "@/lib/data/media";
import { variantUrl, type MediaLike } from "@/lib/media/types";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { quoteRef, sampleRef } from "./types";

type QuoteRow = typeof schema.quoteRequests.$inferSelect;
type SampleRow = typeof schema.sampleRequests.$inferSelect;

const localeOf = (value: string): Locale => (isLocale(value) ? value : "tr");
const greetingName = (contactName: string) => firstNameOf(contactName) ?? contactName;
const lower = (email: string) => email.trim().toLowerCase();

/** A small WebP/PNG/JPEG for the 64×64 mail thumbnail (never AVIF: Outlook and some clients lack it). */
export function emailImagePath(media: MediaLike | null): string | null {
  if (!media) return null;
  const webp = (media.variants ?? []).filter((v) => v.format === "webp").sort((a, b) => a.width - b.width);
  const pick = webp.find((v) => v.width >= 128) ?? webp.at(-1);
  if (pick) return variantUrl(media, pick.key);
  return /\.(webp|png|jpe?g)(\?|$)/i.test(media.url) ? media.url : null;
}

type ProductInfo = { id: number; name: LocalizedText; accentColor: string | null; image: MediaLike | null };
type VariantInfo = { id: number; productId: number; labels: LocalizedText[] };

/** Products (any status: a request may outlive a product) and variant labels for the mails and panel. */
export async function loadRequestDisplay(
  tx: Tx,
  input: { productIds?: readonly number[]; variantIds?: readonly number[] },
): Promise<{ products: Map<number, ProductInfo>; variants: Map<number, VariantInfo> }> {
  const { products: p, productVariants: v, variantOptionValues: vov, productOptionValues: ov, productOptions: o, productMedia: pm } = schema;
  const variantIds = [...new Set(input.variantIds ?? [])];
  const variantRows = variantIds.length
    ? await tx.select({ id: v.id, productId: v.productId }).from(v).where(inArray(v.id, variantIds))
    : [];
  const productIds = [...new Set([...(input.productIds ?? []), ...variantRows.map((r) => r.productId)])];
  const products = new Map<number, ProductInfo>();
  const variants = new Map<number, VariantInfo>();
  if (productIds.length) {
    const [rows, media] = await Promise.all([
      tx.select({ id: p.id, name: p.name, accentColor: p.accentColor }).from(p).where(inArray(p.id, productIds)),
      tx
        .select({ productId: pm.productId, variantId: pm.variantId, role: pm.role, media: mediaColumns })
        .from(pm)
        .innerJoin(schema.media, eq(pm.mediaId, schema.media.id))
        // Images only (day 6): a product video never becomes a mail or panel thumbnail.
        .where(and(inArray(pm.productId, productIds), imageOnly()))
        .orderBy(asc(pm.productId), asc(pm.position), asc(pm.id)),
    ]);
    for (const r of rows) {
      const own = media.filter((m) => m.productId === r.id);
      const shared = own.filter((m) => m.variantId == null);
      const pool = shared.length ? shared : own;
      products.set(r.id, { ...r, image: (pool.find((m) => m.role === "packshot") ?? pool[0])?.media ?? null });
    }
  }
  if (variantRows.length) {
    const links = await tx
      .select({ variantId: vov.variantId, value: ov.value })
      .from(vov)
      .innerJoin(ov, eq(ov.id, vov.optionValueId))
      .innerJoin(o, eq(o.id, ov.optionId))
      .where(inArray(vov.variantId, variantIds))
      .orderBy(asc(vov.variantId), asc(o.position), asc(o.id));
    for (const r of variantRows) variants.set(r.id, { ...r, labels: links.filter((l) => l.variantId === r.id).map((l) => l.value) });
  }
  return { products, variants };
}

type Display = Awaited<ReturnType<typeof loadRequestDisplay>>;

/** "Lavanta Latte" + "5 L Bidon" for a variant in `locale`; the stored label for free-text lines. */
export function describeLine(display: Display, line: { variantId?: number | null; label: string }, locale: Locale) {
  const variant = line.variantId ? display.variants.get(line.variantId) : undefined;
  const product = variant ? display.products.get(variant.productId) : undefined;
  if (!variant || !product) return { name: line.label, detail: null, imageUrl: null, accent: null };
  const detail = variant.labels.map((l) => localize(l, locale)).filter(Boolean).join(" · ");
  return { name: localize(product.name, locale), detail: detail || null, imageUrl: emailImagePath(product.image), accent: product.accentColor };
}

function emailLines(display: Display, items: QuoteRow["items"], locale: Locale): RequestEmailLine[] {
  return items.map((item) => ({ ...describeLine(display, item, locale), quantity: item.quantity }));
}

function emailProducts(display: Display, ids: readonly number[], locale: Locale): RequestEmailProduct[] {
  return ids.flatMap((id) => {
    const product = display.products.get(id);
    return product ? [{ name: localize(product.name, locale), detail: null, imageUrl: emailImagePath(product.image), accent: product.accentColor }] : [];
  });
}

// ---------------------------------------------------------------------------------------------
// Quotes

/** quote_received to the requester + quote_received_admin to every admin recipient. */
export async function enqueueQuoteReceived(tx: Tx, quote: QuoteRow): Promise<void> {
  const locale = localeOf(quote.locale);
  const display = await loadRequestDisplay(tx, { variantIds: quote.items.flatMap((i) => (i.variantId ? [i.variantId] : [])) });
  const base = {
    name: greetingName(quote.contactName),
    companyName: quote.companyName,
    reference: quoteRef(quote.id),
    message: quote.message,
  };
  await enqueueEmail(tx, {
    template: "quote_received",
    to: quote.email,
    locale,
    data: { ...base, lines: emailLines(display, quote.items, locale) },
    related: { type: "quote", id: quote.id },
    dedupeKey: `quote:${quote.id}:received:customer`,
  });
  const adminLines = emailLines(display, quote.items, "tr");
  for (const to of await adminRecipients(tx)) {
    await enqueueEmail(tx, {
      template: "quote_received_admin",
      to,
      locale: "tr",
      data: {
        ...base,
        lines: adminLines,
        quoteId: quote.id,
        contactName: quote.contactName,
        email: quote.email,
        phone: quote.phone,
        sector: quote.sector,
        locale: quote.locale,
      },
      related: { type: "quote", id: quote.id },
      dedupeKey: `quote:${quote.id}:received:admin:${lower(to)}`,
    });
  }
}

/** quote_offer with the offer's lines (localized names), total, validity and note. One mail per send. */
export async function enqueueQuoteOffer(tx: Tx, quote: QuoteRow & { offer: QuoteOffer; quotedAt: Date }, createdBy: string | null) {
  const locale = localeOf(quote.locale);
  const display = await loadRequestDisplay(tx, { variantIds: quote.offer.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])) });
  return enqueueEmail(tx, {
    template: "quote_offer",
    to: quote.email,
    locale,
    data: {
      name: greetingName(quote.contactName),
      companyName: quote.companyName,
      reference: quoteRef(quote.id),
      lines: quote.offer.lines.map((l) => ({
        ...describeLine(display, l, locale),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.unitPrice * l.quantity,
      })),
      total: quote.offer.total,
      validUntil: quote.offer.validUntil ?? null,
      note: quote.offer.note ?? null,
    },
    related: { type: "quote", id: quote.id },
    // A revised offer is a new mail: the send time is the qualifier.
    dedupeKey: `quote:${quote.id}:offer:customer:${quote.quotedAt.getTime()}`,
    createdBy,
  });
}

// ---------------------------------------------------------------------------------------------
// Samples

export async function enqueueSampleReceived(tx: Tx, sample: SampleRow): Promise<void> {
  const locale = localeOf(sample.locale);
  const display = await loadRequestDisplay(tx, { productIds: sample.productIds });
  const base = {
    name: greetingName(sample.contactName),
    companyName: sample.companyName,
    reference: sampleRef(sample.id),
    address: { city: sample.address.city, district: sample.address.district, line1: sample.address.line1 },
    liters: sample.estimatedMonthlyLiters,
    message: sample.message,
  };
  await enqueueEmail(tx, {
    template: "sample_received",
    to: sample.email,
    locale,
    data: { ...base, products: emailProducts(display, sample.productIds, locale) },
    related: { type: "sample", id: sample.id },
    dedupeKey: `sample:${sample.id}:received:customer`,
  });
  const adminProducts = emailProducts(display, sample.productIds, "tr");
  for (const to of await adminRecipients(tx)) {
    await enqueueEmail(tx, {
      template: "sample_received_admin",
      to,
      locale: "tr",
      data: {
        ...base,
        products: adminProducts,
        sampleId: sample.id,
        contactName: sample.contactName,
        email: sample.email,
        phone: sample.phone,
        sector: sample.sector,
        locale: sample.locale,
      },
      related: { type: "sample", id: sample.id },
      dedupeKey: `sample:${sample.id}:received:admin:${lower(to)}`,
    });
  }
}

export type SampleStatusMail =
  | { kind: "approved" }
  | { kind: "shipped" }
  | { kind: "rejected"; note: string | null };

/** sample_approved / sample_shipped / sample_rejected (once per request and event). */
export async function enqueueSampleStatusMail(tx: Tx, sample: SampleRow, mail: SampleStatusMail, createdBy: string | null) {
  const locale = localeOf(sample.locale);
  const base = { name: greetingName(sample.contactName), companyName: sample.companyName, reference: sampleRef(sample.id) };
  const common = { to: sample.email, locale, related: { type: "sample" as const, id: sample.id }, createdBy, dedupeKey: `sample:${sample.id}:${mail.kind}:customer` };
  if (mail.kind === "rejected") {
    return enqueueEmail(tx, { ...common, template: "sample_rejected", data: { ...base, note: mail.note } });
  }
  const display = await loadRequestDisplay(tx, { productIds: sample.productIds });
  const products = emailProducts(display, sample.productIds, locale);
  if (mail.kind === "approved") {
    return enqueueEmail(tx, { ...common, template: "sample_approved", data: { ...base, products } });
  }
  const carrier = await carrierOf(tx, sample.carrier);
  const tracking = sample.trackingNumber ?? "";
  return enqueueEmail(tx, {
    ...common,
    template: "sample_shipped",
    data: {
      ...base,
      products,
      carrierName: carrier?.name ?? sample.carrier ?? "",
      trackingNumber: tracking,
      trackingUrl: carrier?.trackingUrl && tracking ? trackingLink(carrier.trackingUrl, tracking) : null,
    },
  });
}

/** The carrier from settings.shipping.carriers by key (fresh read inside the transaction). */
export async function carrierOf(tx: Tx, key: string | null): Promise<{ key: string; name: string; trackingUrl: string } | null> {
  if (!key) return null;
  const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "shipping")).limit(1);
  return parseSettings("shipping", row?.value).carriers.find((c) => c.key === key) ?? null;
}

/** The carrier's tracking page with `{code}` filled in (https only). */
export function trackingLink(template: string, code: string): string | null {
  const url = template.includes("{code}") ? template.replaceAll("{code}", encodeURIComponent(code)) : template;
  return /^https:\/\//i.test(url) ? url : null;
}

// ---------------------------------------------------------------------------------------------
// Contact form

/** contact_message to every admin recipient (replaces the day-3 notifyContactMessage stub). */
export async function enqueueContactMessage(
  tx: Tx,
  message: { id: number; name: string; email: string; phone: string | null; subject: ContactSubject | null; message: string; locale: string },
): Promise<number> {
  let queued = 0;
  for (const to of await adminRecipients(tx)) {
    const row = await enqueueEmail(tx, {
      template: "contact_message",
      to,
      locale: "tr",
      data: {
        messageId: message.id,
        name: message.name,
        email: message.email,
        phone: message.phone,
        subject: message.subject,
        message: message.message,
        locale: message.locale,
      },
      related: { type: "contact", id: message.id },
      dedupeKey: `contact:${message.id}:new:admin:${lower(to)}`,
    });
    if (row) queued += 1;
  }
  return queued;
}
