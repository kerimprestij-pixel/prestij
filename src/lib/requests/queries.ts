// Panel reads of quote and sample requests (uncached on purpose: new requests and status changes must
// show at once). Callers check the session first (requireStaff / requirePanelActor).
import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { QuoteOffer } from "@/db/schema/commerce";
import { localize } from "@/i18n/localize";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import { resolveUnitPrice } from "@/lib/pricing/resolve";
import { parseSettings } from "@/lib/settings/types";
import { carrierOf, emailImagePath, loadRequestDisplay, trackingLink } from "./emails";
import {
  parseRequestRef,
  QUOTE_STATUSES,
  quoteRef,
  SAMPLE_STATUSES,
  sampleRef,
  type QuoteStatus,
  type SampleStatus,
} from "./types";

export const REQUESTS_PAGE_SIZE = 20;

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;

function searchWhere(table: typeof schema.quoteRequests | typeof schema.sampleRequests, prefix: "TKL" | "NMN", q: string | null | undefined): SQL | undefined {
  const term = (q ?? "").trim().slice(0, 100);
  if (!term) return undefined;
  const like = `%${escapeLike(foldText(term))}%`;
  const parts: SQL[] = [
    sql`${fold(sql`${table.companyName}`)} like ${like}`,
    sql`${fold(sql`${table.contactName}`)} like ${like}`,
    sql`${fold(sql`${table.email}`)} like ${like}`,
  ];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) parts.push(sql`regexp_replace(coalesce(${table.phone}, ''), '\\D', '', 'g') like ${`%${digits.slice(-10)}%`}`);
  const ref = parseRequestRef(term, prefix);
  if (ref !== null) parts.push(eq(table.id, ref));
  return or(...parts);
}

export type RequestListInput<S extends string> = { status?: S | null; q?: string | null; page?: number | null };

type Paged<T, S extends string> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Per status, honouring the search (tab counters). */
  counts: Record<S | "all", number>;
};

function paging(total: number, requested: number | null | undefined) {
  const pageSize = REQUESTS_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Number.isSafeInteger(requested) && (requested ?? 0) > 0 ? (requested as number) : 1);
  return { pageSize, pageCount, page };
}

// ---------------------------------------------------------------------------------------------
// Quotes

export type QuoteListRow = {
  id: number;
  reference: string;
  companyName: string;
  contactName: string;
  email: string;
  status: QuoteStatus;
  lineCount: number;
  totalQuantity: number;
  offerTotal: number | null;
  locale: string;
  createdAt: string;
};

export async function listQuoteRequests(input: RequestListInput<QuoteStatus> = {}, executor: Tx = db): Promise<Paged<QuoteListRow, QuoteStatus>> {
  const t = schema.quoteRequests;
  const search = searchWhere(t, "TKL", input.q);
  const where = and(search, input.status ? eq(t.status, input.status) : undefined);
  const [groups, [{ total }]] = await Promise.all([
    executor.select({ status: t.status, n: count() }).from(t).where(search).groupBy(t.status),
    executor.select({ total: count() }).from(t).where(where),
  ]);
  const { page, pageSize, pageCount } = paging(total, input.page);
  const rows = await executor
    .select({
      id: t.id,
      companyName: t.companyName,
      contactName: t.contactName,
      email: t.email,
      status: t.status,
      items: t.items,
      offerTotal: t.offerTotal,
      locale: t.locale,
      createdAt: t.createdAt,
    })
    .from(t)
    .where(where)
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const counts = Object.fromEntries([["all", 0], ...QUOTE_STATUSES.map((s) => [s, 0])]) as Record<QuoteStatus | "all", number>;
  for (const g of groups) {
    counts.all += g.n;
    if (g.status in counts) counts[g.status as QuoteStatus] += g.n;
  }
  return {
    rows: rows.map(({ items, ...r }) => ({
      ...r,
      status: r.status as QuoteStatus,
      reference: quoteRef(r.id),
      lineCount: items.length,
      totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    pageCount,
    counts,
  };
}

/** One requested line with the shop's current prices for the offer editor. */
export type QuoteDetailLine = {
  variantId: number | null;
  label: string;
  /** Size / variant ("5 L Bidon") for product lines. */
  detail: string | null;
  quantity: number;
  imageUrl: string | null;
  accent: string | null;
  /** Current retail price (kuruş) or null for free-text lines and removed variants. */
  listPrice: number | null;
  /** Price for the reference group at this quantity (group price / discount and volume tiers). */
  groupPrice: number | null;
};

export type OfferVariantOption = { variantId: number; label: string; listPrice: number; groupPrice: number | null };

export type QuoteDetail = {
  id: number;
  reference: string;
  status: QuoteStatus;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  sector: string | null;
  message: string | null;
  adminNote: string | null;
  locale: string;
  userId: string | null;
  company: { id: number; name: string; status: string } | null;
  lines: QuoteDetailLine[];
  offer: QuoteOffer | null;
  quotedAt: string | null;
  consentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The customer group whose prices are shown next to the list price. */
  priceGroup: { id: number; name: string; discountPercent: number; isCompanyGroup: boolean } | null;
  /** Every active variant, for lines added in the offer editor. */
  variantOptions: OfferVariantOption[];
  emails: RequestEmailRow[];
};

export type RequestEmailRow = { id: number; template: string; toEmail: string; status: string; subject: string; createdAt: string; sentAt: string | null };

async function relatedEmails(executor: Tx, type: "quote" | "sample", id: number): Promise<RequestEmailRow[]> {
  const e = schema.emailMessages;
  const rows = await executor
    .select({ id: e.id, template: e.template, toEmail: e.toEmail, status: e.status, subject: e.subject, createdAt: e.createdAt, sentAt: e.sentAt })
    .from(e)
    .where(and(eq(e.relatedType, type), eq(e.relatedId, String(id))))
    .orderBy(desc(e.createdAt), desc(e.id))
    .limit(50);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null }));
}

/** The group whose prices the offer editor shows: the requester's company group, else the default business group. */
async function referenceGroup(executor: Tx, companyGroupId: number | null) {
  const g = schema.customerGroups;
  if (companyGroupId != null) {
    const [row] = await executor.select().from(g).where(eq(g.id, companyGroupId)).limit(1);
    if (row) return { row, isCompanyGroup: true };
  }
  const [settingsRow] = await executor.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "b2b")).limit(1);
  const slug = parseSettings("b2b", settingsRow?.value).defaultGroupSlug;
  const [row] = slug ? await executor.select().from(g).where(eq(g.slug, slug)).limit(1) : [];
  return row ? { row, isCompanyGroup: false } : null;
}

/**
 * Group prices for variants at the given quantities, by the cart engine's rules (compute.ts tiersFor):
 * an explicit group price takes no volume tier; otherwise the group's own tiers win over retail ones.
 */
async function groupPriceFor(
  executor: Tx,
  group: { id: number; discountPercent: number } | null,
  variants: { id: number; productId: number; price: number; quantity: number }[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!group || variants.length === 0) return out;
  const ids = variants.map((v) => v.id);
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const tp = schema.tierPrices;
  const [explicit, tiers] = await Promise.all([
    executor
      .select({ variantId: schema.groupPrices.variantId, price: schema.groupPrices.price })
      .from(schema.groupPrices)
      .where(and(eq(schema.groupPrices.groupId, group.id), inArray(schema.groupPrices.variantId, ids))),
    executor
      .select({ variantId: tp.variantId, productId: tp.productId, groupId: tp.groupId, minQuantity: tp.minQuantity, discountPercent: tp.discountPercent })
      .from(tp)
      .where(and(or(inArray(tp.variantId, ids), inArray(tp.productId, productIds)), or(isNull(tp.groupId), eq(tp.groupId, group.id)))),
  ]);
  for (const v of variants) {
    const forVariant = tiers.filter((t) => t.variantId === v.id || (t.variantId == null && t.productId === v.productId));
    const groupPrice = explicit.find((e) => e.variantId === v.id)?.price ?? null;
    const groupTiers = forVariant.filter((t) => t.groupId === group.id);
    const tierDiscounts = groupPrice != null ? [] : groupTiers.length > 0 ? groupTiers : forVariant.filter((t) => t.groupId == null);
    const resolved = resolveUnitPrice({
      basePrice: v.price,
      groupPrice,
      groupDiscountPercent: group.discountPercent,
      tierDiscounts,
      quantity: Math.max(1, v.quantity),
    });
    out.set(v.id, resolved.unitPrice);
  }
  return out;
}

export async function getQuoteRequest(id: number, executor: Tx = db): Promise<QuoteDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const t = schema.quoteRequests;
  const [row] = await executor.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) return null;

  const [company] = row.companyId
    ? await executor
        .select({ id: schema.companies.id, name: schema.companies.name, status: schema.companies.status, groupId: schema.companies.groupId })
        .from(schema.companies)
        .where(eq(schema.companies.id, row.companyId))
        .limit(1)
    : [];
  const group = await referenceGroup(executor, company?.status === "approved" ? (company.groupId ?? null) : null);

  // Every active variant (staff may quote business-only products too); samples are never quoted.
  const p = schema.products;
  const v = schema.productVariants;
  const allVariants = await executor
    .select({ id: v.id, productId: v.productId, price: v.price, productName: p.name })
    .from(v)
    .innerJoin(p, eq(p.id, v.productId))
    .where(and(eq(v.isActive, true), eq(p.status, "active"), ne(p.type, "sample")))
    .orderBy(asc(p.position), asc(p.id), asc(v.position), asc(v.id));
  const lineVariantIds = row.items.flatMap((i) => (i.variantId ? [i.variantId] : []));
  const offerVariantIds = (row.offer?.lines ?? []).flatMap((l) => (l.variantId ? [l.variantId] : []));
  const display = await loadRequestDisplay(executor, { variantIds: [...new Set([...lineVariantIds, ...offerVariantIds, ...allVariants.map((x) => x.id)])] });
  const priceOf = new Map<number, { price: number; productId: number }>();
  const variantRows = lineVariantIds.length
    ? await executor.select({ id: v.id, price: v.price, productId: v.productId }).from(v).where(inArray(v.id, lineVariantIds))
    : [];
  for (const r of variantRows) priceOf.set(r.id, { price: r.price, productId: r.productId });

  const lineGroupPrices = await groupPriceFor(
    executor,
    group?.row ?? null,
    row.items.flatMap((i) => {
      const hit = i.variantId ? priceOf.get(i.variantId) : undefined;
      return hit && i.variantId ? [{ id: i.variantId, productId: hit.productId, price: hit.price, quantity: i.quantity }] : [];
    }),
  );
  const optionGroupPrices = await groupPriceFor(
    executor,
    group?.row ?? null,
    allVariants.map((x) => ({ id: x.id, productId: x.productId, price: x.price, quantity: 1 })),
  );

  const describe = (variantId: number) => {
    const variant = display.variants.get(variantId);
    const product = variant ? display.products.get(variant.productId) : undefined;
    const size = variant ? variant.labels.map((l) => localize(l, "tr")).filter(Boolean).join(" · ") : "";
    return { product, size };
  };

  return {
    id: row.id,
    reference: quoteRef(row.id),
    status: row.status as QuoteStatus,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    sector: row.sector,
    message: row.message,
    adminNote: row.adminNote,
    locale: row.locale,
    userId: row.userId,
    company: company ? { id: company.id, name: company.name, status: company.status } : null,
    lines: row.items.map((item) => {
      if (!item.variantId) return { variantId: null, label: item.label, detail: null, quantity: item.quantity, imageUrl: null, accent: null, listPrice: null, groupPrice: null };
      const { product, size } = describe(item.variantId);
      return {
        variantId: item.variantId,
        label: product ? localize(product.name, "tr") : item.label,
        detail: size || null,
        quantity: item.quantity,
        imageUrl: emailImagePath(product?.image ?? null),
        accent: product?.accentColor ?? null,
        listPrice: priceOf.get(item.variantId)?.price ?? null,
        groupPrice: lineGroupPrices.get(item.variantId) ?? null,
      };
    }),
    offer: row.offer,
    quotedAt: row.quotedAt?.toISOString() ?? null,
    consentAt: row.consentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    priceGroup: group
      ? { id: group.row.id, name: localize(group.row.name, "tr"), discountPercent: group.row.discountPercent, isCompanyGroup: group.isCompanyGroup }
      : null,
    variantOptions: allVariants.map((x) => {
      const { size } = describe(x.id);
      const name = localize(x.productName, "tr");
      return { variantId: x.id, label: size ? `${name} · ${size}` : name, listPrice: x.price, groupPrice: optionGroupPrices.get(x.id) ?? null };
    }),
    emails: await relatedEmails(executor, "quote", row.id),
  };
}

/** New quote requests (sidebar / dashboard). */
export async function countNewQuoteRequests(executor: Tx = db): Promise<number> {
  const [row] = await executor.select({ n: count() }).from(schema.quoteRequests).where(eq(schema.quoteRequests.status, "new"));
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Samples

export type SampleProductInfo = { id: number; name: string; accent: string | null; imageUrl: string | null };

export type SampleListRow = {
  id: number;
  reference: string;
  companyName: string;
  contactName: string;
  email: string;
  city: string;
  status: SampleStatus;
  products: SampleProductInfo[];
  locale: string;
  createdAt: string;
};

async function productInfos(executor: Tx, ids: number[]): Promise<Map<number, SampleProductInfo>> {
  const display = await loadRequestDisplay(executor, { productIds: ids });
  return new Map(
    [...display.products.values()].map((p) => [p.id, { id: p.id, name: localize(p.name, "tr"), accent: p.accentColor, imageUrl: emailImagePath(p.image) }]),
  );
}

export async function listSampleRequests(input: RequestListInput<SampleStatus> = {}, executor: Tx = db): Promise<Paged<SampleListRow, SampleStatus>> {
  const t = schema.sampleRequests;
  const search = searchWhere(t, "NMN", input.q);
  const where = and(search, input.status ? eq(t.status, input.status) : undefined);
  const [groups, [{ total }]] = await Promise.all([
    executor.select({ status: t.status, n: count() }).from(t).where(search).groupBy(t.status),
    executor.select({ total: count() }).from(t).where(where),
  ]);
  const { page, pageSize, pageCount } = paging(total, input.page);
  const rows = await executor
    .select({
      id: t.id,
      companyName: t.companyName,
      contactName: t.contactName,
      email: t.email,
      address: t.address,
      status: t.status,
      productIds: t.productIds,
      locale: t.locale,
      createdAt: t.createdAt,
    })
    .from(t)
    .where(where)
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const infos = await productInfos(executor, [...new Set(rows.flatMap((r) => r.productIds))]);
  const counts = Object.fromEntries([["all", 0], ...SAMPLE_STATUSES.map((s) => [s, 0])]) as Record<SampleStatus | "all", number>;
  for (const g of groups) {
    counts.all += g.n;
    if (g.status in counts) counts[g.status as SampleStatus] += g.n;
  }
  return {
    rows: rows.map(({ address, productIds, ...r }) => ({
      ...r,
      status: r.status as SampleStatus,
      reference: sampleRef(r.id),
      city: address.city,
      products: productIds.flatMap((id) => (infos.has(id) ? [infos.get(id)!] : [])),
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    pageCount,
    counts,
  };
}

export type SampleDetail = {
  id: number;
  reference: string;
  status: SampleStatus;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  sector: string;
  address: { city: string; district: string; line1: string; fullName: string; phone: string };
  products: SampleProductInfo[];
  estimatedMonthlyLiters: number | null;
  message: string | null;
  adminNote: string | null;
  locale: string;
  carrier: { key: string; name: string } | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  approvedAt: string | null;
  shippedAt: string | null;
  consentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Carriers from Ayarlar → Kargo for the shipping form. */
  carriers: { key: string; name: string }[];
  emails: RequestEmailRow[];
};

export async function getSampleRequest(id: number, executor: Tx = db): Promise<SampleDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const t = schema.sampleRequests;
  const [row] = await executor.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) return null;
  const infos = await productInfos(executor, row.productIds);
  const [shipping] = await executor.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "shipping")).limit(1);
  const carriers = parseSettings("shipping", shipping?.value).carriers.map((c) => ({ key: c.key, name: c.name }));
  const carrier = await carrierOf(executor, row.carrier);
  return {
    id: row.id,
    reference: sampleRef(row.id),
    status: row.status as SampleStatus,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    sector: row.sector,
    address: { city: row.address.city, district: row.address.district, line1: row.address.line1, fullName: row.address.fullName, phone: row.address.phone },
    products: row.productIds.flatMap((pid) => (infos.has(pid) ? [infos.get(pid)!] : [])),
    estimatedMonthlyLiters: row.estimatedMonthlyLiters,
    message: row.message,
    adminNote: row.adminNote,
    locale: row.locale,
    carrier: row.carrier ? { key: row.carrier, name: carrier?.name ?? row.carrier } : null,
    trackingNumber: row.trackingNumber,
    trackingUrl: carrier?.trackingUrl && row.trackingNumber ? trackingLink(carrier.trackingUrl, row.trackingNumber) : null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    consentAt: row.consentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    carriers,
    emails: await relatedEmails(executor, "sample", row.id),
  };
}
