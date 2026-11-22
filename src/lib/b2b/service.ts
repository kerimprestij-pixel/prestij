// B2B services: the business application (storefront), the approval workflow and company edits
// (panel), and customer groups (panel). They take (tx, input, actor) and never touch Next APIs, so the
// DB tests call them directly. E-mails are queued with enqueueEmail in the caller's transaction.
//
// Security model: a customer can only ever create or resubmit a *pending* application for their own
// account. Groups, payment terms, the approved status and user.companyId/customerGroupId on another
// company are written only here, by panel actions that require the admin role (src/app/panel/(dashboard)/
// kurumsal-hesaplar/actions.ts). Better Auth keeps companyId/customerGroupId non-writable (input: false).
import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { CompanyStatus } from "@/db/schema/commerce";
import { LOCALES, type Locale } from "@/i18n/locales";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { firstNameOf } from "@/lib/customer/viewer";
import { adminRecipients, enqueueEmail } from "@/lib/email";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { isStaffRole } from "@/lib/panel/roles";
import {
  DEFERRED_DAYS,
  readApplicationDetails,
  type BusinessApplicationData,
  type CompanyAddress,
  type CompanyFields,
  type PaymentTerms,
} from "./application";

const c = schema.companies;
const u = schema.user;
const g = schema.customerGroups;

const asLocale = (value: unknown): Locale => (typeof value === "string" && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : "tr");
const epoch = (d: Date) => Math.floor(d.getTime() / 1000);

/** The user row holds a staff role (also inside a comma-separated admin-plugin role list). */
export const isStaffUserRole = (role: string | null | undefined): boolean => (role ?? "").split(",").some((r) => isStaffRole(r.trim()));

// ---------------------------------------------------------------------------------------------------
// Storefront: the application

export type ApplicationFailure = "closed" | "already_pending" | "already_approved" | "staff" | "not_found" | "not_verified";

export type ApplicationResult = { ok: true; companyId: number; resubmitted: boolean } | { ok: false; code: ApplicationFailure };

function companyAddress(data: CompanyFields & { monthlyVolume?: BusinessApplicationData["monthlyVolume"]; note?: string | null }, contactName: string, locale: Locale): CompanyAddress {
  return {
    fullName: contactName,
    phone: data.phone,
    city: data.address.city,
    district: data.address.district,
    line1: data.address.line1,
    ...(data.address.postalCode ? { postalCode: data.address.postalCode } : {}),
    country: "TR",
    application: { monthlyVolume: data.monthlyVolume ?? null, note: data.note ?? null, locale },
  };
}

/**
 * Creates (or, after a rejection, resubmits) the signed-in customer's business application: a
 * `pending` company with `applicant_user_id`, linked through user.companyId. Queues the receipt for the
 * customer and one notification per admin recipient.
 */
export async function submitBusinessApplication(
  tx: Tx,
  data: BusinessApplicationData,
  actor: { userId: string },
  options: { now?: Date } = {},
): Promise<ApplicationResult> {
  const now = options.now ?? new Date();
  const [user] = await tx
    .select({ id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, banned: u.banned, role: u.role, companyId: u.companyId, locale: u.locale })
    .from(u)
    .where(eq(u.id, actor.userId))
    .for("update");
  if (!user || user.banned) return { ok: false, code: "not_found" };
  if (isStaffUserRole(user.role)) return { ok: false, code: "staff" };
  if (!user.emailVerified) return { ok: false, code: "not_verified" };

  const { b2b } = await loadCommerceSettings(tx);
  if (!b2b.enabled) return { ok: false, code: "closed" };

  let existing: { id: number; status: CompanyStatus; applicantUserId: string | null } | null = null;
  if (user.companyId != null) {
    const [row] = await tx.select({ id: c.id, status: c.status, applicantUserId: c.applicantUserId }).from(c).where(eq(c.id, user.companyId)).for("update");
    existing = row ?? null;
  }
  if (existing?.status === "pending") return { ok: false, code: "already_pending" };
  if (existing?.status === "approved") return { ok: false, code: "already_approved" };

  const values = {
    name: data.companyName,
    sector: data.sector,
    taxOffice: data.taxOffice,
    taxNumber: data.taxNumber,
    phone: data.phone,
    email: data.email,
    website: data.website,
    address: companyAddress(data, user.name, data.locale),
    status: "pending" as const,
    applicantUserId: user.id,
    groupId: null,
    paymentTerms: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    updatedAt: now,
  };

  let companyId: number;
  const resubmitted = existing?.status === "rejected" && existing.applicantUserId === user.id;
  if (resubmitted && existing) {
    await tx.update(c).set(values).where(eq(c.id, existing.id));
    companyId = existing.id;
  } else {
    // A rejected company someone else applied for stays as it is; this account gets its own application.
    const [row] = await tx.insert(c).values({ ...values, createdAt: now }).returning({ id: c.id });
    companyId = row.id;
    await tx.update(u).set({ companyId, updatedAt: now }).where(eq(u.id, user.id));
  }

  const locale = asLocale(user.locale ?? data.locale);
  const mailData = {
    name: firstNameOf(user.name) ?? "",
    company: data.companyName,
    sector: data.sector,
    taxOffice: data.taxOffice,
    taxNumber: data.taxNumber,
    city: data.address.city,
    district: data.address.district,
  };
  const stamp = epoch(now);
  await enqueueEmail(tx, {
    template: "business_application_received",
    to: user.email,
    locale,
    data: mailData,
    related: { type: "company", id: companyId },
    dedupeKey: `company:${companyId}:received:customer:${stamp}`,
  });
  for (const to of await adminRecipients(tx)) {
    await enqueueEmail(tx, {
      template: "business_application_admin",
      to,
      locale: "tr",
      data: {
        ...mailData,
        companyId,
        contactName: user.name,
        accountEmail: user.email,
        companyEmail: data.email,
        phone: data.phone,
        website: data.website,
        monthlyVolume: data.monthlyVolume,
        note: data.note,
      },
      related: { type: "company", id: companyId },
      dedupeKey: `company:${companyId}:received:admin:${to.toLowerCase()}:${stamp}`,
    });
  }
  return { ok: true, companyId, resubmitted };
}

// ---------------------------------------------------------------------------------------------------
// Panel: approval workflow

type Actor = { user: { id: string } };

export const B2B_MESSAGES = {
  companyNotFound: "Bu firma bulunamadı; silinmiş olabilir. Listeyi yenileyin.",
  groupNotFound: "Seçilen müşteri grubu bulunamadı. Sayfayı yenileyip yeniden seçin.",
  daysRequired: `Vade süresini ${DEFERRED_DAYS.min}–${DEFERRED_DAYS.max} gün arasında girin.`,
  alreadyApproved: "Bu firma zaten onaylı. Grubu ve ödeme koşullarını “Koşulları düzenle” ile değiştirebilirsiniz.",
  notApproved: "Koşullar yalnızca onaylı firmalarda düzenlenebilir. Önce başvuruyu onaylayın.",
  alreadyRejected: "Bu başvuru zaten reddedilmiş.",
  reasonRequired: "Reddetme gerekçesini yazın; müşteriye e-postayla gönderilir.",
} as const;

async function lockCompany(tx: Tx, id: number) {
  const [row] = await tx.select().from(c).where(eq(c.id, id)).for("update");
  if (!row) throw new PanelError("not_found", B2B_MESSAGES.companyNotFound);
  return row;
}

async function requireGroup(tx: Tx, groupId: number) {
  const [row] = await tx
    .select({ id: g.id, name: g.name, slug: g.slug, isBusiness: g.isBusiness, showPricesExVat: g.showPricesExVat, discountPercent: g.discountPercent })
    .from(g)
    .where(eq(g.id, groupId));
  if (!row) throw fieldError("groupId", B2B_MESSAGES.groupNotFound);
  return row;
}

/** Validated terms to store: deferred needs whole days in range; otherwise deferred is off. */
export function buildPaymentTerms(input: { allowDeferred: boolean; days: number | null }): PaymentTerms {
  if (!input.allowDeferred) return { allowDeferred: false };
  const days = input.days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < DEFERRED_DAYS.min || days > DEFERRED_DAYS.max) {
    throw fieldError("days", B2B_MESSAGES.daysRequired);
  }
  return { allowDeferred: true, days };
}

/** Where the customer mails of a company go: the applicant's account (and language), else the company e-mail. */
async function companyContact(tx: Tx, company: { applicantUserId: string | null; email: string | null; address: unknown }) {
  if (company.applicantUserId) {
    const [user] = await tx
      .select({ name: u.name, email: u.email, locale: u.locale, banned: u.banned })
      .from(u)
      .where(eq(u.id, company.applicantUserId));
    if (user && !user.banned) return { to: user.email, name: firstNameOf(user.name) ?? "", locale: asLocale(user.locale) };
  }
  if (company.email) return { to: company.email, name: "", locale: readApplicationDetails(company.address)?.locale ?? "tr" };
  return null;
}

export type ApproveCompanyInput = { id: number; groupId: number; allowDeferred: boolean; days: number | null; updatedAt: Date };

/** Pending or rejected → approved, with a group and payment terms; e-mails `business_approved`. */
export async function approveCompany(tx: Tx, input: ApproveCompanyInput, actor: Actor, options: { now?: Date } = {}): Promise<{ audit: AuditEntry; notified: boolean }> {
  const now = options.now ?? new Date();
  const row = await lockCompany(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.status === "approved") throw new PanelError("conflict", B2B_MESSAGES.alreadyApproved);
  const group = await requireGroup(tx, input.groupId);
  const paymentTerms = buildPaymentTerms(input);

  await tx
    .update(c)
    .set({ status: "approved", groupId: group.id, paymentTerms, approvedAt: now, rejectedAt: null, rejectionReason: null, updatedAt: now })
    .where(eq(c.id, row.id));

  const contact = await companyContact(tx, row);
  let notified = false;
  if (contact) {
    const queued = await enqueueEmail(tx, {
      template: "business_approved",
      to: contact.to,
      locale: contact.locale,
      data: {
        name: contact.name,
        company: row.name,
        groupName: group.name as LocalizedText,
        deferredDays: paymentTerms.allowDeferred ? (paymentTerms.days ?? null) : null,
        pricesExVat: group.showPricesExVat,
      },
      related: { type: "company", id: row.id },
      dedupeKey: `company:${row.id}:approved:customer:${epoch(now)}`,
      createdBy: actor.user.id,
    });
    notified = queued !== null;
  }

  return {
    notified,
    audit: {
      action: "status",
      entity: "company",
      entityId: row.id,
      before: { status: row.status, groupId: row.groupId, paymentTerms: row.paymentTerms },
      after: { status: "approved", groupId: group.id, paymentTerms },
    },
  };
}

export type CompanyTermsInput = ApproveCompanyInput;

/** Changes the group / payment terms of an approved company (no e-mail). */
export async function updateCompanyTerms(tx: Tx, input: CompanyTermsInput): Promise<{ audit: AuditEntry | null }> {
  const row = await lockCompany(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.status !== "approved") throw new PanelError("conflict", B2B_MESSAGES.notApproved);
  const group = await requireGroup(tx, input.groupId);
  const paymentTerms = buildPaymentTerms(input);
  const same = row.groupId === group.id && JSON.stringify(row.paymentTerms ?? {}) === JSON.stringify(paymentTerms);
  if (same) return { audit: null };
  await tx.update(c).set({ groupId: group.id, paymentTerms, updatedAt: new Date() }).where(eq(c.id, row.id));
  return {
    audit: {
      action: "update",
      entity: "company",
      entityId: row.id,
      before: { groupId: row.groupId, paymentTerms: row.paymentTerms },
      after: { groupId: group.id, paymentTerms },
    },
  };
}

export type RejectCompanyInput = { id: number; reason: string; updatedAt: Date };

/**
 * Pending → rejected (or approved → rejected: business status revoked), with a reason that is shown to
 * the applicant and e-mailed (`business_rejected`). Group and terms are cleared, so pricing falls back
 * to retail right away.
 */
export async function rejectCompany(tx: Tx, input: RejectCompanyInput, actor: Actor, options: { now?: Date } = {}): Promise<{ audit: AuditEntry; notified: boolean }> {
  const now = options.now ?? new Date();
  const reason = input.reason.trim();
  if (!reason) throw fieldError("reason", B2B_MESSAGES.reasonRequired);
  const row = await lockCompany(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.status === "rejected") throw new PanelError("conflict", B2B_MESSAGES.alreadyRejected);

  await tx
    .update(c)
    .set({ status: "rejected", rejectedAt: now, rejectionReason: reason, approvedAt: null, groupId: null, paymentTerms: null, updatedAt: now })
    .where(eq(c.id, row.id));

  const contact = await companyContact(tx, row);
  let notified = false;
  if (contact) {
    const queued = await enqueueEmail(tx, {
      template: "business_rejected",
      to: contact.to,
      locale: contact.locale,
      data: { name: contact.name, company: row.name, reason, revoked: row.status === "approved" },
      related: { type: "company", id: row.id },
      dedupeKey: `company:${row.id}:rejected:customer:${epoch(now)}`,
      createdBy: actor.user.id,
    });
    notified = queued !== null;
  }
  return {
    notified,
    audit: {
      action: "status",
      entity: "company",
      entityId: row.id,
      before: { status: row.status, groupId: row.groupId, paymentTerms: row.paymentTerms },
      after: { status: "rejected", reason },
    },
  };
}

export type UpdateCompanyInput = { id: number; fields: CompanyFields; adminNote: string | null; updatedAt: Date };

/** Company data edited in the panel (the application details stay as the applicant sent them). */
export async function updateCompany(tx: Tx, input: UpdateCompanyInput): Promise<{ updatedAt: Date; audit: AuditEntry | null }> {
  const row = await lockCompany(tx, input.id);
  assertFresh(row.updatedAt, input.updatedAt);
  const f = input.fields;
  const previousAddress = (row.address ?? null) as CompanyAddress | null;
  const address: CompanyAddress = {
    fullName: previousAddress?.fullName ?? "",
    phone: f.phone,
    city: f.address.city,
    district: f.address.district,
    line1: f.address.line1,
    ...(f.address.postalCode ? { postalCode: f.address.postalCode } : {}),
    country: "TR",
    ...(previousAddress?.application ? { application: previousAddress.application } : {}),
  };
  const next = {
    name: f.companyName,
    sector: f.sector,
    taxOffice: f.taxOffice,
    taxNumber: f.taxNumber,
    phone: f.phone,
    email: f.email,
    website: f.website,
    address,
    adminNote: input.adminNote,
  };
  const before = {
    name: row.name,
    sector: row.sector,
    taxOffice: row.taxOffice,
    taxNumber: row.taxNumber,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: row.address,
    adminNote: row.adminNote,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(sortKeys(before[k])) !== JSON.stringify(sortKeys(next[k])));
  if (changed.length === 0) return { updatedAt: row.updatedAt, audit: null };
  const now = new Date();
  await tx.update(c).set({ ...next, updatedAt: now }).where(eq(c.id, row.id));
  // Company data is business contact data; the audit keeps which fields changed, not the values.
  return { updatedAt: now, audit: { action: "update", entity: "company", entityId: row.id, after: { changed } } };
}

function sortKeys(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
}

// ---------------------------------------------------------------------------------------------------
// Panel: customer groups

export type GroupInput = { slug: string; name: LocalizedText; isBusiness: boolean; discountPercent: number; showPricesExVat: boolean };

export type GroupUsage = {
  companies: number;
  customers: number;
  groupPrices: number;
  tiers: number;
  campaigns: number;
  coupons: number;
  /** The group named by settings.b2b.defaultGroupSlug (preselected on approval). */
  isDefault: boolean;
};

export const GROUP_MESSAGES = {
  notFound: "Bu müşteri grubu bulunamadı; silinmiş olabilir. Listeyi yenileyin.",
  slugTaken: "Bu kısa ad başka bir grupta kullanılıyor.",
  defaultSlug:
    "Bu grup, Ayarlar › Kurumsal'da varsayılan kurumsal grup olarak seçili. Kısa adını değiştirmeden önce orada başka bir grup seçin.",
} as const;

export async function groupUsage(tx: Tx, groupId: number): Promise<GroupUsage> {
  const [row] = await tx.execute<{
    companies: string;
    customers: string;
    group_prices: string;
    tiers: string;
    campaigns: string;
    coupons: string;
    slug: string | null;
    default_slug: string | null;
  }>(sql`
    select
      (select count(*) from companies where group_id = ${groupId})::text as companies,
      (select count(*) from "user" where customer_group_id = ${groupId})::text as customers,
      (select count(*) from group_prices where group_id = ${groupId})::text as group_prices,
      (select count(*) from tier_prices where group_id = ${groupId})::text as tiers,
      (select count(*) from campaigns where ${groupId} = any(customer_group_ids))::text as campaigns,
      (select count(*) from coupons where ${groupId} = any(customer_group_ids))::text as coupons,
      (select slug from customer_groups where id = ${groupId}) as slug,
      (select coalesce(value->>'defaultGroupSlug', 'kurumsal') from settings where key = 'b2b') as default_slug
  `);
  const defaultSlug = row?.default_slug ?? "kurumsal";
  return {
    companies: Number(row?.companies ?? 0),
    customers: Number(row?.customers ?? 0),
    groupPrices: Number(row?.group_prices ?? 0),
    tiers: Number(row?.tiers ?? 0),
    campaigns: Number(row?.campaigns ?? 0),
    coupons: Number(row?.coupons ?? 0),
    isDefault: row?.slug != null && row.slug === defaultSlug,
  };
}

/** "3 firma, 2 müşteri ve 12 grup fiyatı" — what blocks a delete. */
export function describeGroupUsage(usage: GroupUsage): string | null {
  const parts = [
    usage.isDefault ? "varsayılan kurumsal grup ayarı" : null,
    usage.companies ? `${usage.companies} firma` : null,
    usage.customers ? `${usage.customers} müşteri` : null,
    usage.groupPrices ? `${usage.groupPrices} grup fiyatı` : null,
    usage.tiers ? `${usage.tiers} kademeli indirim` : null,
    usage.campaigns ? `${usage.campaigns} kampanya` : null,
    usage.coupons ? `${usage.coupons} kupon` : null,
  ].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} ve ${parts.at(-1)}`;
}

async function assertSlugFree(tx: Tx, slug: string, exceptId: number | null) {
  const rows = await tx.select({ id: g.id }).from(g).where(eq(g.slug, slug));
  if (rows.some((r) => r.id !== exceptId)) throw fieldError("slug", GROUP_MESSAGES.slugTaken);
}

export async function createGroup(tx: Tx, input: GroupInput): Promise<{ id: number; audit: AuditEntry }> {
  await assertSlugFree(tx, input.slug, null);
  const [row] = await tx
    .insert(g)
    .values({ slug: input.slug, name: input.name, isBusiness: input.isBusiness, discountPercent: input.discountPercent, showPricesExVat: input.showPricesExVat })
    .returning({ id: g.id });
  return { id: row.id, audit: { action: "create", entity: "customer_group", entityId: row.id, after: input } };
}

export async function updateGroup(tx: Tx, input: GroupInput & { id: number; updatedAt: Date }): Promise<{ updatedAt: Date; audit: AuditEntry | null }> {
  const [row] = await tx.select().from(g).where(eq(g.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", GROUP_MESSAGES.notFound);
  assertFresh(row.updatedAt, input.updatedAt);
  if (row.slug !== input.slug) {
    await assertSlugFree(tx, input.slug, row.id);
    if ((await groupUsage(tx, row.id)).isDefault) throw fieldError("slug", GROUP_MESSAGES.defaultSlug);
  }
  const next = { slug: input.slug, name: input.name, isBusiness: input.isBusiness, discountPercent: input.discountPercent, showPricesExVat: input.showPricesExVat };
  const before = { slug: row.slug, name: row.name, isBusiness: row.isBusiness, discountPercent: row.discountPercent, showPricesExVat: row.showPricesExVat };
  const changedKeys = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(sortKeys(before[k])) !== JSON.stringify(sortKeys(next[k])));
  if (changedKeys.length === 0) return { updatedAt: row.updatedAt, audit: null };
  const now = new Date();
  await tx.update(g).set({ ...next, updatedAt: now }).where(eq(g.id, row.id));
  const pick = (o: Record<string, unknown>) => Object.fromEntries(changedKeys.map((k) => [k, o[k]]));
  return { updatedAt: now, audit: { action: "update", entity: "customer_group", entityId: row.id, before: pick(before), after: pick(next) } };
}

export async function deleteGroup(tx: Tx, input: { id: number; updatedAt: Date }): Promise<{ audit: AuditEntry }> {
  const [row] = await tx.select().from(g).where(eq(g.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", GROUP_MESSAGES.notFound);
  assertFresh(row.updatedAt, input.updatedAt);
  const usage = await groupUsage(tx, row.id);
  const used = describeGroupUsage(usage);
  if (used) throw new PanelError("in_use", `Bu grup kullanımda (${used}). Silmeden önce bu kayıtları başka bir gruba taşıyın.`);
  await tx.delete(g).where(eq(g.id, row.id));
  return {
    audit: {
      action: "delete",
      entity: "customer_group",
      entityId: row.id,
      before: { slug: row.slug, name: row.name, isBusiness: row.isBusiness, discountPercent: row.discountPercent, showPricesExVat: row.showPricesExVat },
    },
  };
}

/** Pending applications (sidebar badge, dashboard). */
export async function pendingCompanyCount(tx: Tx): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(c).where(and(eq(c.status, "pending")));
  return row?.n ?? 0;
}
