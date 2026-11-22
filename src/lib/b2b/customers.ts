// Panel customer administration (Müşteriler, admin actions): change the pricing group, ban / unban,
// export the customer's data (KVKK), anonymize. (tx, input, actor) services without Next APIs; the
// password reset mail goes through Better Auth in the action file. Staff accounts are never touched
// here (they are managed on the Ekip page).
import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import { anonymizeAccount, isAnonymizedEmail } from "@/lib/account/service";
import { isAccountError } from "@/lib/account/errors";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { readApplicationDetails, readCompanyAddress } from "./application";
import { isStaffUserRole } from "./service";

const u = schema.user;

export const CUSTOMER_MESSAGES = {
  notFound: "Bu müşteri bulunamadı; silinmiş olabilir. Listeyi yenileyin.",
  staff: "Bu bir panel kullanıcısı. Panel kullanıcıları Ekip sayfasından yönetilir.",
  anonymized: "Bu hesap silinmiş (anonimleştirilmiş); üzerinde işlem yapılamaz.",
  groupNotFound: "Seçilen müşteri grubu bulunamadı. Sayfayı yenileyip yeniden seçin.",
  banReason: "Panelden erişimi kapatıldı.",
} as const;

/** Locks a customer row (never staff, never an anonymized account). */
async function lockCustomer(tx: Tx, userId: string) {
  const [row] = await tx
    .select({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      banned: u.banned,
      banReason: u.banReason,
      customerGroupId: u.customerGroupId,
      companyId: u.companyId,
      locale: u.locale,
      updatedAt: u.updatedAt,
    })
    .from(u)
    .where(eq(u.id, userId))
    .for("update");
  if (!row) throw new PanelError("not_found", CUSTOMER_MESSAGES.notFound);
  if (isStaffUserRole(row.role)) throw new PanelError("forbidden", CUSTOMER_MESSAGES.staff);
  if (isAnonymizedEmail(row.email)) throw new PanelError("conflict", CUSTOMER_MESSAGES.anonymized);
  return row;
}

/** Sets the customer's own pricing group (wins over the company's group); null = none. */
export async function setCustomerGroup(tx: Tx, input: { userId: string; groupId: number | null; updatedAt: Date }): Promise<{ audit: AuditEntry | null }> {
  const row = await lockCustomer(tx, input.userId);
  assertFresh(row.updatedAt, input.updatedAt);
  if (input.groupId != null) {
    const [group] = await tx.select({ id: schema.customerGroups.id }).from(schema.customerGroups).where(eq(schema.customerGroups.id, input.groupId));
    if (!group) throw fieldError("groupId", CUSTOMER_MESSAGES.groupNotFound);
  }
  if (row.customerGroupId === input.groupId) return { audit: null };
  await tx.update(u).set({ customerGroupId: input.groupId, updatedAt: new Date() }).where(eq(u.id, row.id));
  return { audit: { action: "update", entity: "user", entityId: row.id, before: { customerGroupId: row.customerGroupId }, after: { customerGroupId: input.groupId } } };
}

/** Ban = no sign-in and every session revoked right away; unban lets the old password work again. */
export async function setCustomerBanned(tx: Tx, input: { userId: string; banned: boolean; updatedAt: Date }): Promise<{ revokedSessions: number; audit: AuditEntry | null }> {
  const row = await lockCustomer(tx, input.userId);
  assertFresh(row.updatedAt, input.updatedAt);
  if (Boolean(row.banned) === input.banned) return { revokedSessions: 0, audit: null };
  const now = new Date();
  await tx
    .update(u)
    .set(input.banned ? { banned: true, banReason: CUSTOMER_MESSAGES.banReason, banExpires: null, updatedAt: now } : { banned: false, banReason: null, banExpires: null, updatedAt: now })
    .where(eq(u.id, row.id));
  let revokedSessions = 0;
  if (input.banned) {
    const gone = await tx.delete(schema.session).where(eq(schema.session.userId, row.id)).returning({ id: schema.session.id });
    revokedSessions = gone.length;
  }
  return {
    revokedSessions,
    audit: { action: "status", entity: "user", entityId: row.id, before: { banned: Boolean(row.banned) }, after: { banned: input.banned, revokedSessions } },
  };
}

/** Anonymizes the customer with the self-service deletion rules (src/lib/account/service.ts). */
export async function anonymizeCustomer(tx: Tx, input: { userId: string }, actor: { user: { id: string } }) {
  await lockCustomer(tx, input.userId);
  try {
    return await anonymizeAccount(tx, input.userId, { actorId: actor.user.id, reason: "admin" });
  } catch (error) {
    if (isAccountError(error)) {
      if (error.code === "forbidden") throw new PanelError("forbidden", CUSTOMER_MESSAGES.staff);
      throw new PanelError("not_found", CUSTOMER_MESSAGES.notFound);
    }
    throw error;
  }
}

/** The customer for a password reset mail (Better Auth sends it; see the action). */
export async function customerForPasswordReset(tx: Tx, userId: string): Promise<{ id: string; email: string; locale: string | null }> {
  const row = await lockCustomer(tx, userId);
  if (row.banned) throw new PanelError("conflict", "Erişimi kapalı bir hesaba şifre sıfırlama bağlantısı gönderilemez. Önce erişimi açın.");
  return { id: row.id, email: row.email, locale: row.locale };
}

// ---------------------------------------------------------------------------------------------------
// KVKK data export

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Everything we hold about one customer, as plain JSON (KVKK m.11 access request): account, addresses,
 * company, orders (with lines), subscriptions, reviews, favorites, newsletter consent, contact
 * messages, quote and sample requests, gift wheel spins and prize codes (day 6), and the e-mails we sent
 * (subject and date, not the body). Never secrets: no password hashes, session tokens or access tokens;
 * of a spin's salted IP hash only the fact that one is stored.
 */
export async function exportCustomerData(tx: Tx, userId: string): Promise<Record<string, unknown>> {
  const [user] = await tx.select().from(u).where(eq(u.id, userId));
  if (!user) throw new PanelError("not_found", CUSTOMER_MESSAGES.notFound);
  if (isStaffUserRole(user.role)) throw new PanelError("forbidden", CUSTOMER_MESSAGES.staff);
  const email = user.email.trim().toLowerCase();
  const byEmail = <T extends { email: unknown }>(col: T["email"]) => sql`lower(${col}) = ${email}`;
  const o = schema.orders;

  const ws = schema.wheelSpins;
  const wc = schema.coupons;
  const [addresses, orders, subscriptions, reviews, favorites, newsletter, contact, quotes, samples, mails, company, group, wheelSpins, wheelPrizes] = await Promise.all([
    tx.select().from(schema.addresses).where(eq(schema.addresses.userId, userId)),
    tx
      .select()
      .from(o)
      .where(or(eq(o.userId, userId), sql`lower(${o.email}) = ${email}`))
      .orderBy(desc(o.createdAt)),
    tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId)),
    tx.select().from(schema.reviews).where(eq(schema.reviews.userId, userId)),
    tx
      .select({ productId: schema.favorites.productId, slug: schema.products.slug, createdAt: schema.favorites.createdAt })
      .from(schema.favorites)
      .innerJoin(schema.products, eq(schema.products.id, schema.favorites.productId))
      .where(eq(schema.favorites.userId, userId)),
    tx.select().from(schema.newsletterSubscribers).where(byEmail(schema.newsletterSubscribers.email)),
    tx.select().from(schema.contactMessages).where(byEmail(schema.contactMessages.email)),
    tx.select().from(schema.quoteRequests).where(or(eq(schema.quoteRequests.userId, userId), byEmail(schema.quoteRequests.email))),
    tx.select().from(schema.sampleRequests).where(byEmail(schema.sampleRequests.email)),
    tx
      .select({ template: schema.emailMessages.template, subject: schema.emailMessages.subject, status: schema.emailMessages.status, createdAt: schema.emailMessages.createdAt, sentAt: schema.emailMessages.sentAt })
      .from(schema.emailMessages)
      .where(byEmail(schema.emailMessages.toEmail))
      .orderBy(desc(schema.emailMessages.createdAt)),
    user.companyId != null ? tx.select().from(schema.companies).where(eq(schema.companies.id, user.companyId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    user.customerGroupId != null
      ? tx.select({ slug: schema.customerGroups.slug, name: schema.customerGroups.name }).from(schema.customerGroups).where(eq(schema.customerGroups.id, user.customerGroupId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    tx.select().from(ws).where(eq(ws.userId, userId)).orderBy(desc(ws.createdAt), desc(ws.id)),
    tx
      .select({
        code: wc.code,
        type: wc.type,
        value: wc.value,
        minOrderTotal: wc.minOrderTotal,
        startsAt: wc.startsAt,
        endsAt: wc.endsAt,
        usedCount: wc.usedCount,
        maxUses: wc.maxUses,
        isActive: wc.isActive,
        createdAt: wc.createdAt,
      })
      .from(wc)
      .where(and(eq(wc.source, "wheel"), eq(wc.userId, userId)))
      .orderBy(desc(wc.createdAt), desc(wc.id)),
  ]);

  const orderIds = orders.map((r) => r.id);
  const items = orderIds.length ? await tx.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds)) : [];

  return {
    exportedAt: new Date().toISOString(),
    format: "PRESTİJ müşteri verisi (KVKK m.11)",
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      preferredLanguage: user.locale,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
      marketingConsent: user.marketingConsent,
      marketingConsentAt: iso(user.marketingConsentAt),
      accessBlocked: Boolean(user.banned),
      customerGroup: group ? { slug: group.slug, name: group.name } : null,
    },
    company: company
      ? {
          name: company.name,
          sector: company.sector,
          taxOffice: company.taxOffice,
          taxNumber: company.taxNumber,
          phone: company.phone,
          email: company.email,
          website: company.website,
          address: readCompanyAddress(company.address),
          application: readApplicationDetails(company.address),
          status: company.status,
          paymentTerms: company.paymentTerms,
          isApplicant: company.applicantUserId === user.id,
          approvedAt: iso(company.approvedAt),
          rejectedAt: iso(company.rejectedAt),
          rejectionReason: company.rejectionReason,
          createdAt: iso(company.createdAt),
        }
      : null,
    addresses: addresses.map((a) => ({ title: a.title, address: a.data, invoice: a.invoice, isDefaultShipping: a.isDefaultShipping, isDefaultBilling: a.isDefaultBilling, createdAt: iso(a.createdAt) })),
    orders: orders.map((r) => ({
      orderNumber: r.orderNumber,
      createdAt: iso(r.createdAt),
      status: r.status,
      paymentMethod: r.paymentMethod,
      email: r.email,
      phone: r.phone,
      locale: r.locale,
      subtotal: r.subtotal,
      discountTotal: r.discountTotal,
      shippingTotal: r.shippingTotal,
      paymentFee: r.paymentFee,
      vatTotal: r.vatTotal,
      grandTotal: r.grandTotal,
      currency: r.currency,
      couponCode: r.couponCode,
      shippingAddress: r.shippingAddress,
      invoice: r.invoice,
      customerNote: r.customerNote,
      carrier: r.carrier,
      trackingNumber: r.trackingNumber,
      paidAt: iso(r.paidAt),
      shippedAt: iso(r.shippedAt),
      deliveredAt: iso(r.deliveredAt),
      cancelledAt: iso(r.cancelledAt),
      consents: r.consents,
      items: items
        .filter((i) => i.orderId === r.id)
        .map((i) => ({
          product: i.snapshot.productName,
          variant: i.snapshot.variantTitle,
          sku: i.snapshot.sku,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount,
          lineTotal: i.lineTotal,
          vatRate: i.vatRate,
          isSample: i.isSample,
        })),
    })),
    moneyNote: "Tutarlar kuruş cinsindendir (12990 = 129,90 TL).",
    subscriptions: subscriptions.map((s) => ({
      status: s.status,
      items: s.items,
      shippingAddress: s.shippingAddress,
      invoice: s.invoice,
      paymentMethod: s.paymentMethod,
      nextRunAt: iso(s.nextRunAt),
      createdAt: iso(s.createdAt),
      cancelledAt: iso(s.cancelledAt),
    })),
    reviews: reviews.map((r) => ({ productId: r.productId, rating: r.rating, title: r.title, body: r.body, authorName: r.authorName, status: r.status, createdAt: iso(r.createdAt) })),
    favorites: favorites.map((f) => ({ productId: f.productId, product: f.slug, addedAt: iso(f.createdAt) })),
    newsletter: newsletter.map((n) => ({
      email: n.email,
      status: n.status,
      locale: n.locale,
      source: n.source,
      consentAt: iso(n.consentAt),
      confirmedAt: iso(n.confirmedAt),
      unsubscribedAt: iso(n.unsubscribedAt),
    })),
    contactMessages: contact.map((m) => ({ name: m.name, email: m.email, phone: m.phone, subject: m.subject, message: m.message, createdAt: iso(m.createdAt) })),
    quoteRequests: quotes.map((q) => ({ companyName: q.companyName, contactName: q.contactName, email: q.email, phone: q.phone, items: q.items, message: q.message, status: q.status, createdAt: iso(q.createdAt) })),
    sampleRequests: samples.map((s) => ({ companyName: s.companyName, contactName: s.contactName, email: s.email, phone: s.phone, address: s.address, message: s.message, status: s.status, createdAt: iso(s.createdAt) })),
    emailsSent: mails.map((m) => ({ template: m.template, subject: m.subject, status: m.status, createdAt: iso(m.createdAt), sentAt: iso(m.sentAt) })),
    giftWheel: {
      note: "Hediye çarkı: çevirme kayıtları ve hesaba tanımlanan ödül kodları. IP adresi saklanmaz; kötüye kullanımı önlemek için yalnızca tuzlanmış bir özeti (hash) tutulur ve 30 gün sonra silinir.",
      spins: wheelSpins.map((w) => ({
        round: w.round,
        prize: { label: w.prize.label, type: w.prize.type, value: w.prize.value, minOrderTotal: w.prize.minOrderTotal },
        status: w.status,
        boundVia: w.boundVia,
        locale: w.locale,
        pagePath: w.pagePath,
        spunAt: iso(w.createdAt),
        boundAt: iso(w.boundAt),
        claimedAt: iso(w.claimedAt),
        remindedAt: iso(w.remindedAt),
        ipHashStored: w.ipHash != null,
      })),
      prizes: wheelPrizes.map((p) => ({
        code: p.code,
        type: p.type,
        value: p.value,
        minOrderTotal: p.minOrderTotal,
        startsAt: iso(p.startsAt),
        endsAt: iso(p.endsAt),
        used: p.maxUses != null ? p.usedCount >= p.maxUses : p.usedCount > 0,
        usedCount: p.usedCount,
        isActive: p.isActive,
        createdAt: iso(p.createdAt),
      })),
    },
  };
}

/** Whether the user row is a (non-staff) customer; for the route handler's 404. */
export async function isCustomer(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.select({ role: u.role }).from(u).where(and(eq(u.id, userId)));
  return Boolean(row) && !isStaffUserRole(row.role);
}
