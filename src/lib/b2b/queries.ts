// Panel reads for Müşteriler and Kurumsal Hesaplar. Uncached on purpose (applications, bans and group
// changes must show at once). Callers check the session first (requireStaff / requirePanelActor).
// Rows are serializable (ISO dates) and carry no secrets.
import "server-only";
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { AddressData, BusinessSector, CompanyStatus, InvoiceData, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import { isAnonymizedEmail } from "@/lib/account/service";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import { readApplicationDetails, readCompanyAddress, type ApplicationDetails, type PaymentTerms } from "./application";
import { groupUsage, isStaffUserRole, type GroupUsage } from "./service";

export const CUSTOMERS_PAGE_SIZE = 25;
export const COMPANIES_PAGE_SIZE = 25;

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;
const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : typeof d === "string" ? new Date(d).toISOString() : d.toISOString());
const pageOf = (page: number | null | undefined) => (typeof page === "number" && Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1);

/** user.role holds no staff role (customers have "customer" or null). */
const CUSTOMER_ROLE = sql`not exists (select 1 from unnest(string_to_array(coalesce(u.role, ''), ',')) as r(v) where btrim(r.v) in ('admin', 'editor', 'staff'))`;

/**
 * Orders that count as revenue (money received or the order is live on account / at the door). Day 6:
 * exported; the gift wheel's "new customer" rule treats a buyer with such an order as an existing customer.
 */
export const COUNTED_ORDER_STATUSES = ["paid", "processing", "shipped", "delivered", "awaiting_transfer"] as const satisfies readonly OrderStatus[];
/** The same list as an SQL tuple for `status in ${COUNTED_STATUSES}` (constant literals, no parameters). */
export const COUNTED_STATUSES = sql.raw(`(${COUNTED_ORDER_STATUSES.map((s) => `'${s}'`).join(", ")})`);

export type GroupOption = { id: number; slug: string; name: LocalizedText; isBusiness: boolean; discountPercent: number; showPricesExVat: boolean };

export async function listGroupOptions(executor: Tx = db): Promise<GroupOption[]> {
  const g = schema.customerGroups;
  return executor
    .select({ id: g.id, slug: g.slug, name: g.name, isBusiness: g.isBusiness, discountPercent: g.discountPercent, showPricesExVat: g.showPricesExVat })
    .from(g)
    .orderBy(asc(g.isBusiness), asc(g.id));
}

// ---------------------------------------------------------------------------------------------------
// Customers

export type YesNo = "yes" | "no" | null;

export type CustomerListInput = {
  q?: string | null;
  groupId?: number | null;
  /** "yes" = linked to a company, "no" = not; or a company id. */
  company?: YesNo;
  companyId?: number | null;
  hasOrders?: YesNo;
  verified?: YesNo;
  page?: number | null;
};

export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  emailVerified: boolean;
  banned: boolean;
  anonymized: boolean;
  /** The customer's own group (wins) or, for an approved company, the company's group. */
  groupName: LocalizedText | null;
  groupSource: "own" | "company" | null;
  company: { id: number; name: string; status: CompanyStatus } | null;
  orderCount: number;
  spent: number;
  lastOrderAt: string | null;
};

export type CustomerList = { rows: CustomerRow[]; total: number; page: number; pageSize: number; pageCount: number };

function customerWhere(input: CustomerListInput): SQL {
  const parts: SQL[] = [CUSTOMER_ROLE];
  const term = (input.q ?? "").trim().slice(0, 100);
  if (term) {
    const like = `%${escapeLike(foldText(term))}%`;
    const or: SQL[] = [sql`${fold(sql`u.name`)} like ${like}`, sql`${fold(sql`u.email`)} like ${like}`, sql`${fold(sql`c.name`)} like ${like}`];
    const digits = term.replace(/\D/g, "");
    if (digits.length >= 4) or.push(sql`regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g') like ${`%${digits.slice(-10)}%`}`);
    parts.push(sql`(${sql.join(or, sql` or `)})`);
  }
  if (input.groupId != null) {
    parts.push(sql`(u.customer_group_id = ${input.groupId} or (u.customer_group_id is null and c.status = 'approved' and c.group_id = ${input.groupId}))`);
  }
  if (input.companyId != null) parts.push(sql`u.company_id = ${input.companyId}`);
  else if (input.company === "yes") parts.push(sql`u.company_id is not null`);
  else if (input.company === "no") parts.push(sql`u.company_id is null`);
  if (input.hasOrders === "yes") parts.push(sql`exists (select 1 from orders o where o.user_id = u.id)`);
  else if (input.hasOrders === "no") parts.push(sql`not exists (select 1 from orders o where o.user_id = u.id)`);
  if (input.verified === "yes") parts.push(sql`u.email_verified = true`);
  else if (input.verified === "no") parts.push(sql`u.email_verified = false`);
  return sql.join(parts, sql` and `);
}

type RawCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  created_at: Date | string;
  email_verified: boolean;
  banned: boolean | null;
  own_group: LocalizedText | null;
  company_id: number | null;
  company_name: string | null;
  company_status: CompanyStatus | null;
  company_group: LocalizedText | null;
  order_count: string;
  spent: string;
  last_order_at: Date | string | null;
};

export async function listCustomers(input: CustomerListInput, executor: Tx = db): Promise<CustomerList> {
  const where = customerWhere(input);
  const page = pageOf(input.page);
  const from = sql`from "user" u left join companies c on c.id = u.company_id left join customer_groups cg on cg.id = u.customer_group_id left join customer_groups ccg on ccg.id = c.group_id`;
  const [{ n }] = await executor.execute<{ n: string }>(sql`select count(*)::text as n ${from} where ${where}`);
  const total = Number(n);
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = await executor.execute<RawCustomer>(sql`
    select u.id, u.name, u.email, u.phone, u.created_at, u.email_verified, u.banned,
      cg.name as own_group, c.id as company_id, c.name as company_name, c.status as company_status,
      case when c.status = 'approved' then ccg.name end as company_group,
      (select count(*) from orders o where o.user_id = u.id)::text as order_count,
      (select coalesce(sum(o.grand_total), 0) from orders o where o.user_id = u.id and o.status in ${COUNTED_STATUSES})::text as spent,
      (select max(o.created_at) from orders o where o.user_id = u.id) as last_order_at
    ${from}
    where ${where}
    order by u.created_at desc, u.id
    limit ${CUSTOMERS_PAGE_SIZE} offset ${(current - 1) * CUSTOMERS_PAGE_SIZE}
  `);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      createdAt: iso(r.created_at)!,
      emailVerified: r.email_verified,
      banned: Boolean(r.banned),
      anonymized: isAnonymizedEmail(r.email),
      groupName: r.own_group ?? r.company_group ?? null,
      groupSource: r.own_group ? "own" : r.company_group ? "company" : null,
      company: r.company_id != null && r.company_name ? { id: r.company_id, name: r.company_name, status: r.company_status ?? "pending" } : null,
      orderCount: Number(r.order_count),
      spent: Number(r.spent),
      lastOrderAt: iso(r.last_order_at),
    })),
    total,
    page: current,
    pageSize: CUSTOMERS_PAGE_SIZE,
    pageCount,
  };
}

export type CustomerDetail = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  createdAt: string;
  updatedAt: string;
  emailVerified: boolean;
  banned: boolean;
  anonymized: boolean;
  marketingConsent: boolean;
  customerGroupId: number | null;
  ownGroup: { id: number; name: LocalizedText; isBusiness: boolean } | null;
  company: { id: number; name: string; status: CompanyStatus; groupName: LocalizedText | null; isApplicant: boolean } | null;
  /** The customer's group as pricing sees it right now (b2b.requireApproval honoured). */
  effectiveGroup: { name: LocalizedText; source: "own" | "company" } | null;
  requireApproval: boolean;
  addresses: { id: number; title: string; data: AddressData; invoice: InvoiceData | null; isDefaultShipping: boolean; isDefaultBilling: boolean }[];
  orders: { id: number; orderNumber: string; status: OrderStatus; paymentMethod: PaymentMethod; grandTotal: number; createdAt: string }[];
  orderCount: number;
  spent: number;
  subscriptions: { id: number; status: string; planName: LocalizedText | null; nextRunAt: string; paymentMethod: PaymentMethod }[];
  reviews: { id: number; productName: LocalizedText | null; productId: number; rating: number; status: string; createdAt: string }[];
  emails: EmailLogRow[];
  favoriteCount: number;
  activeSessions: number;
  lastSignInAt: string | null;
  newsletter: { status: string; confirmedAt: string | null } | null;
};

export type EmailLogRow = { id: number; template: string; subject: string; toEmail: string; status: string; createdAt: string; sentAt: string | null };

async function emailsWhere(executor: Tx, where: SQL, limit = 20): Promise<EmailLogRow[]> {
  const m = schema.emailMessages;
  const rows = await executor
    .select({ id: m.id, template: m.template, subject: m.subject, toEmail: m.toEmail, status: m.status, createdAt: m.createdAt, sentAt: m.sentAt })
    .from(m)
    .where(where)
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), sentAt: iso(r.sentAt) }));
}

export async function getCustomerDetail(id: string, executor: Tx = db): Promise<CustomerDetail | null> {
  const u = schema.user;
  const [user] = await executor.select().from(u).where(eq(u.id, id));
  if (!user || isStaffUserRole(user.role)) return null;
  const email = user.email.trim().toLowerCase();
  const o = schema.orders;

  const [settings, ownGroup, company, addresses, orders, totals, subscriptions, reviews, emails, favorites, sessions, newsletter] = await Promise.all([
    loadCommerceSettings(executor),
    user.customerGroupId != null
      ? executor
          .select({ id: schema.customerGroups.id, name: schema.customerGroups.name, isBusiness: schema.customerGroups.isBusiness })
          .from(schema.customerGroups)
          .where(eq(schema.customerGroups.id, user.customerGroupId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    user.companyId != null
      ? executor
          .select({ id: schema.companies.id, name: schema.companies.name, status: schema.companies.status, applicantUserId: schema.companies.applicantUserId, groupName: schema.customerGroups.name })
          .from(schema.companies)
          .leftJoin(schema.customerGroups, eq(schema.customerGroups.id, schema.companies.groupId))
          .where(eq(schema.companies.id, user.companyId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    executor.select().from(schema.addresses).where(eq(schema.addresses.userId, id)).orderBy(desc(schema.addresses.isDefaultShipping), asc(schema.addresses.id)),
    executor
      .select({ id: o.id, orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, grandTotal: o.grandTotal, createdAt: o.createdAt })
      .from(o)
      .where(eq(o.userId, id))
      .orderBy(desc(o.createdAt))
      .limit(20),
    executor.execute<{ n: string; spent: string }>(
      sql`select count(*)::text as n, coalesce(sum(grand_total) filter (where status in ${COUNTED_STATUSES}), 0)::text as spent from orders where user_id = ${id}`,
    ),
    executor
      .select({ id: schema.subscriptions.id, status: schema.subscriptions.status, planName: schema.subscriptionPlans.name, nextRunAt: schema.subscriptions.nextRunAt, paymentMethod: schema.subscriptions.paymentMethod })
      .from(schema.subscriptions)
      .leftJoin(schema.subscriptionPlans, eq(schema.subscriptionPlans.id, schema.subscriptions.planId))
      .where(eq(schema.subscriptions.userId, id))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(20),
    executor
      .select({ id: schema.reviews.id, productId: schema.reviews.productId, productName: schema.products.name, rating: schema.reviews.rating, status: schema.reviews.status, createdAt: schema.reviews.createdAt })
      .from(schema.reviews)
      .leftJoin(schema.products, eq(schema.products.id, schema.reviews.productId))
      .where(eq(schema.reviews.userId, id))
      .orderBy(desc(schema.reviews.createdAt))
      .limit(20),
    emailsWhere(
      executor,
      or(sql`lower(${schema.emailMessages.toEmail}) = ${email}`, and(eq(schema.emailMessages.relatedType, "user"), eq(schema.emailMessages.relatedId, id)))!,
    ),
    executor.select({ n: count() }).from(schema.favorites).where(eq(schema.favorites.userId, id)),
    executor.execute<{ active: string; last: Date | string | null }>(
      sql`select count(*) filter (where expires_at > now())::text as active, max(created_at) as last from "session" where user_id = ${id}`,
    ),
    executor
      .select({ status: schema.newsletterSubscribers.status, confirmedAt: schema.newsletterSubscribers.confirmedAt })
      .from(schema.newsletterSubscribers)
      .where(sql`lower(${schema.newsletterSubscribers.email}) = ${email}`)
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const companyApproved = company?.status === "approved";
  const companyGroupApplies = companyApproved && company?.groupName;
  const ownApplies = ownGroup && settings.b2b.enabled && (!settings.b2b.requireApproval || companyApproved);
  const effectiveGroup = !settings.b2b.enabled
    ? null
    : ownApplies && ownGroup
      ? { name: ownGroup.name, source: "own" as const }
      : !ownGroup && companyGroupApplies && company?.groupName
        ? { name: company.groupName, source: "company" as const }
        : null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    locale: user.locale ?? "tr",
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    emailVerified: user.emailVerified,
    banned: Boolean(user.banned),
    anonymized: isAnonymizedEmail(user.email),
    marketingConsent: user.marketingConsent,
    customerGroupId: user.customerGroupId,
    ownGroup,
    company: company
      ? { id: company.id, name: company.name, status: company.status, groupName: company.groupName ?? null, isApplicant: company.applicantUserId === user.id }
      : null,
    effectiveGroup,
    requireApproval: settings.b2b.requireApproval,
    addresses: addresses.map((a) => ({ id: a.id, title: a.title, data: a.data, invoice: a.invoice, isDefaultShipping: a.isDefaultShipping, isDefaultBilling: a.isDefaultBilling })),
    orders: orders.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    orderCount: Number(totals[0]?.n ?? 0),
    spent: Number(totals[0]?.spent ?? 0),
    subscriptions: subscriptions.map((s) => ({ ...s, nextRunAt: s.nextRunAt.toISOString() })),
    reviews: reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    emails,
    favoriteCount: favorites[0]?.n ?? 0,
    activeSessions: Number(sessions[0]?.active ?? 0),
    lastSignInAt: iso(sessions[0]?.last ?? null),
    newsletter: newsletter ? { status: newsletter.status, confirmedAt: iso(newsletter.confirmedAt) } : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Companies

export type CompanyStatusFilter = CompanyStatus | "all";

export type CompanyListInput = { status?: CompanyStatusFilter; q?: string | null; page?: number | null };

export type CompanyRow = {
  id: number;
  name: string;
  sector: BusinessSector;
  status: CompanyStatus;
  city: string | null;
  taxNumber: string | null;
  groupName: LocalizedText | null;
  deferredDays: number | null;
  applicant: { id: string; name: string; email: string } | null;
  memberCount: number;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CompanyList = {
  rows: CompanyRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Honour the search, not the status filter (tab counters). */
  counts: Record<CompanyStatusFilter, number>;
};

function companySearch(q: string | null | undefined): SQL | null {
  const term = (q ?? "").trim().slice(0, 100);
  if (!term) return null;
  const like = `%${escapeLike(foldText(term))}%`;
  const parts: SQL[] = [
    sql`${fold(sql`c.name`)} like ${like}`,
    sql`${fold(sql`c.email`)} like ${like}`,
    sql`${fold(sql`a.name`)} like ${like}`,
    sql`${fold(sql`a.email`)} like ${like}`,
    sql`${fold(sql`c.address->>'city'`)} like ${like}`,
  ];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) {
    parts.push(sql`coalesce(c.tax_number, '') like ${`%${digits}%`}`);
    parts.push(sql`regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like ${`%${digits.slice(-10)}%`}`);
  }
  return sql`(${sql.join(parts, sql` or `)})`;
}

type RawCompany = {
  id: number;
  name: string;
  sector: BusinessSector;
  status: CompanyStatus;
  city: string | null;
  tax_number: string | null;
  group_name: LocalizedText | null;
  payment_terms: PaymentTerms | null;
  applicant_id: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  member_count: string;
  order_count: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function listCompanies(input: CompanyListInput, executor: Tx = db): Promise<CompanyList> {
  const status = input.status ?? "pending";
  const search = companySearch(input.q);
  const from = sql`from companies c left join "user" a on a.id = c.applicant_user_id left join customer_groups g on g.id = c.group_id`;
  const searchWhere = search ?? sql`true`;
  const [countRow] = await executor.execute<{ all: string; pending: string; approved: string; rejected: string }>(sql`
    select count(*)::text as all,
      count(*) filter (where c.status = 'pending')::text as pending,
      count(*) filter (where c.status = 'approved')::text as approved,
      count(*) filter (where c.status = 'rejected')::text as rejected
    ${from} where ${searchWhere}
  `);
  const counts: Record<CompanyStatusFilter, number> = {
    all: Number(countRow?.all ?? 0),
    pending: Number(countRow?.pending ?? 0),
    approved: Number(countRow?.approved ?? 0),
    rejected: Number(countRow?.rejected ?? 0),
  };
  const where = status === "all" ? searchWhere : sql`${searchWhere} and c.status = ${status}`;
  const total = counts[status];
  const pageCount = Math.max(1, Math.ceil(total / COMPANIES_PAGE_SIZE));
  const page = Math.min(pageOf(input.page), pageCount);
  // Pending: oldest first (first come, first served); otherwise the latest change first.
  const order =
    status === "pending"
      ? sql`c.created_at asc, c.id asc`
      : status === "all"
        ? sql`case c.status when 'pending' then 0 when 'approved' then 1 else 2 end, c.updated_at desc, c.id desc`
        : sql`c.updated_at desc, c.id desc`;
  const rows = await executor.execute<RawCompany>(sql`
    select c.id, c.name, c.sector, c.status, c.address->>'city' as city, c.tax_number, g.name as group_name, c.payment_terms,
      a.id as applicant_id, a.name as applicant_name, a.email as applicant_email,
      (select count(*) from "user" m where m.company_id = c.id)::text as member_count,
      (select count(*) from orders o where o.company_id = c.id)::text as order_count,
      c.created_at, c.updated_at
    ${from}
    where ${where}
    order by ${order}
    limit ${COMPANIES_PAGE_SIZE} offset ${(page - 1) * COMPANIES_PAGE_SIZE}
  `);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      sector: r.sector,
      status: r.status,
      city: r.city,
      taxNumber: r.tax_number,
      groupName: r.group_name,
      deferredDays: r.payment_terms?.allowDeferred ? (r.payment_terms.days ?? null) : null,
      applicant: r.applicant_id && r.applicant_name && r.applicant_email ? { id: r.applicant_id, name: r.applicant_name, email: r.applicant_email } : null,
      memberCount: Number(r.member_count),
      orderCount: Number(r.order_count),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    })),
    total,
    page,
    pageSize: COMPANIES_PAGE_SIZE,
    pageCount,
    counts,
  };
}

export type CompanyDetail = {
  id: number;
  name: string;
  sector: BusinessSector;
  taxOffice: string | null;
  taxNumber: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: AddressData | null;
  application: ApplicationDetails | null;
  status: CompanyStatus;
  groupId: number | null;
  group: { id: number; name: LocalizedText; showPricesExVat: boolean; discountPercent: number } | null;
  paymentTerms: PaymentTerms | null;
  adminNote: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  applicant: { id: string; name: string; email: string; locale: string; anonymized: boolean } | null;
  members: { id: string; name: string; email: string; banned: boolean; isApplicant: boolean; ownGroupName: LocalizedText | null }[];
  orders: { id: number; orderNumber: string; status: OrderStatus; paymentMethod: PaymentMethod; grandTotal: number; createdAt: string; customerName: string }[];
  orderCount: number;
  emails: EmailLogRow[];
  groups: GroupOption[];
  defaultGroupSlug: string;
};

export async function getCompanyDetail(id: number, executor: Tx = db): Promise<CompanyDetail | null> {
  const c = schema.companies;
  const [row] = await executor.select().from(c).where(eq(c.id, id));
  if (!row) return null;
  const u = schema.user;
  const o = schema.orders;
  const [group, applicant, members, orders, orderCount, emails, groups, settings] = await Promise.all([
    row.groupId != null
      ? executor
          .select({ id: schema.customerGroups.id, name: schema.customerGroups.name, showPricesExVat: schema.customerGroups.showPricesExVat, discountPercent: schema.customerGroups.discountPercent })
          .from(schema.customerGroups)
          .where(eq(schema.customerGroups.id, row.groupId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    row.applicantUserId
      ? executor.select({ id: u.id, name: u.name, email: u.email, locale: u.locale }).from(u).where(eq(u.id, row.applicantUserId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    executor
      .select({ id: u.id, name: u.name, email: u.email, banned: u.banned, ownGroupName: schema.customerGroups.name })
      .from(u)
      .leftJoin(schema.customerGroups, eq(schema.customerGroups.id, u.customerGroupId))
      .where(eq(u.companyId, id))
      .orderBy(asc(u.createdAt)),
    executor
      .select({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentMethod: o.paymentMethod,
        grandTotal: o.grandTotal,
        createdAt: o.createdAt,
        shippingAddress: o.shippingAddress,
      })
      .from(o)
      .where(eq(o.companyId, id))
      .orderBy(desc(o.createdAt))
      .limit(20),
    executor.select({ n: count() }).from(o).where(eq(o.companyId, id)),
    emailsWhere(executor, and(eq(schema.emailMessages.relatedType, "company"), eq(schema.emailMessages.relatedId, String(id)))!),
    listGroupOptions(executor),
    loadCommerceSettings(executor),
  ]);
  return {
    id: row.id,
    name: row.name,
    sector: row.sector,
    taxOffice: row.taxOffice,
    taxNumber: row.taxNumber,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: readCompanyAddress(row.address),
    application: readApplicationDetails(row.address),
    status: row.status,
    groupId: row.groupId,
    group,
    paymentTerms: row.paymentTerms,
    adminNote: row.adminNote,
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicant: applicant ? { ...applicant, locale: applicant.locale ?? "tr", anonymized: isAnonymizedEmail(applicant.email) } : null,
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, banned: Boolean(m.banned), isApplicant: m.id === row.applicantUserId, ownGroupName: m.ownGroupName ?? null })),
    orders: orders.map((r) => ({
      id: r.id,
      orderNumber: r.orderNumber,
      status: r.status,
      paymentMethod: r.paymentMethod,
      grandTotal: r.grandTotal,
      createdAt: r.createdAt.toISOString(),
      customerName: r.shippingAddress?.fullName ?? "",
    })),
    orderCount: orderCount[0]?.n ?? 0,
    emails,
    groups,
    defaultGroupSlug: settings.b2b.defaultGroupSlug,
  };
}

export type GroupRow = GroupOption & { updatedAt: string; usage: GroupUsage };

/** Every group with what uses it (the Müşteri Grupları tab). */
export async function listGroupsWithUsage(executor: Tx = db): Promise<GroupRow[]> {
  const g = schema.customerGroups;
  const rows = await executor
    .select({ id: g.id, slug: g.slug, name: g.name, isBusiness: g.isBusiness, discountPercent: g.discountPercent, showPricesExVat: g.showPricesExVat, updatedAt: g.updatedAt })
    .from(g)
    .orderBy(asc(g.isBusiness), asc(g.id));
  const usages = await Promise.all(rows.map((r) => groupUsage(executor, r.id)));
  return rows.map((r, i) => ({ ...r, updatedAt: r.updatedAt.toISOString(), usage: usages[i] }));
}

/** Customers by id (company member pickers etc.); only non-staff rows. */
export async function customerNames(ids: string[], executor: Tx = db): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const u = schema.user;
  const rows = await executor.select({ id: u.id, name: u.name, role: u.role }).from(u).where(inArray(u.id, ids));
  return new Map(rows.filter((r) => !isStaffUserRole(r.role)).map((r) => [r.id, r.name]));
}
