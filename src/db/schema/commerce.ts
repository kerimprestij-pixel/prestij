// Carts, orders, payments, coupons, campaigns, addresses, subscriptions and B2B
// (companies, quote requests, sample requests).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, schedule, timestamps, type Kurus, type LocalizedText } from "./common";
import type { MediaLike } from "../../lib/media/types";
import { user } from "./auth";
import { customerGroups, products, productVariants, subscriptionPlans } from "./catalog";

export type AddressData = {
  fullName: string;
  phone: string;
  city: string; // il
  district: string; // ilçe
  neighbourhood?: string; // mahalle
  line1: string;
  postalCode?: string;
  country?: string; // ISO, default TR
};

export type InvoiceData = {
  type: "individual" | "corporate";
  fullName?: string;
  /** TCKN is optional (e-Arşiv accepts 11111111111 for individuals). */
  nationalId?: string;
  companyName?: string;
  taxOffice?: string;
  taxNumber?: string;
  address?: AddressData;
  eInvoice?: boolean;
};

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    userId: text().notNull(),
    title: text().notNull().default("Ev"),
    data: jsonb().$type<AddressData>().notNull(),
    invoice: jsonb().$type<InvoiceData>(),
    isDefaultShipping: boolean().notNull().default(false),
    isDefaultBilling: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
).enableRLS();

export type CompanyStatus = "pending" | "approved" | "rejected";
export type BusinessSector = "hotel" | "spa" | "office" | "restaurant" | "hospital" | "school" | "retail" | "other";

/** Business (B2B) accounts. Approved companies get their group's prices and terms. */
export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text().notNull(),
    sector: text().$type<BusinessSector>().notNull().default("other"),
    taxOffice: text(),
    taxNumber: text(),
    phone: text(),
    email: text(),
    website: text(),
    address: jsonb().$type<AddressData>(),
    groupId: integer().references(() => customerGroups.id, { onDelete: "set null" }),
    status: text().$type<CompanyStatus>().notNull().default("pending"),
    /** Payment terms the business may use (e.g. bank transfer, 30-day invoice). */
    paymentTerms: jsonb().$type<{ allowDeferred?: boolean; days?: number }>(),
    adminNote: text(),
    approvedAt: timestamp({ withTimezone: true }),
    /** The customer account that applied on /hesap/kurumsal (null for companies created in the panel). */
    applicantUserId: text().references(() => user.id, { onDelete: "set null" }),
    rejectedAt: timestamp({ withTimezone: true }),
    /** Shown to the applicant and e-mailed with the rejection. */
    rejectionReason: text(),
    ...timestamps,
  },
  (t) => [index().on(t.status)],
).enableRLS();

export const carts = pgTable(
  "carts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text(),
    couponCode: text(),
    locale: text().notNull().default("tr"),
    ...timestamps,
    expiresAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
).enableRLS();

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: integer()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer().notNull().default(1),
    /** Free sample added to the order. */
    isSample: boolean().notNull().default(false),
    subscriptionPlanId: integer().references(() => subscriptionPlans.id, { onDelete: "set null" }),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // One row per variant and cart: adding the same variant again updates the quantity (ON CONFLICT).
  (t) => [uniqueIndex("cart_items_cart_variant_unique").on(t.cartId, t.variantId)],
).enableRLS();

export type OrderStatus =
  | "pending_payment"
  | "awaiting_transfer"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";
export type PaymentMethod = "card" | "bank_transfer" | "cash_on_delivery" | "deferred";
/** "simulator" is the local fake 3-D Secure gateway (PAYMENT_SIMULATOR=true, never in production). */
export type PaymentProvider = "iyzico" | "paytr" | "manual" | "simulator";

/** Order numbers: PR-<YY><seq padded to 4>, e.g. PR-261001 (src/lib/orders/number.ts). */
export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 1001 });

/** Totals detail kept with the order so the order page can show exactly what was charged. */
export type OrderBreakdown = {
  couponDiscount: Kurus;
  couponType: CouponType | null;
  bankTransferDiscount: Kurus;
  bankTransferPercent: number;
  /** Flat part of shippingTotal (0 when free) and the heavy-parcel surcharge. */
  shippingFlat: Kurus;
  shippingHeavy: Kurus;
  /** Started kilograms above the heavy threshold (for the "Ağır gönderi ücreti (n kg)" label). */
  heavyKg: number;
  freeShipping: boolean;
  freeShippingReason: "threshold" | "coupon" | null;
  totalWeightGrams: number;
  /** Paid units + samples. */
  itemCount: number;
  /**
   * Havale orders (sales-ready FIX F4): settings.payments.bankTransfer.paymentDays at placement, the day count the
   * contract and the e-mail were written with. The order page, the panel and the overdue list read it, so a later
   * change in the panel never moves the deadline of an order already placed. Absent on older orders (the current
   * setting is used for them) and on other payment methods.
   */
  bankTransferDays?: number;
};

export const orders = pgTable(
  "orders",
  {
    id: id(),
    /** Public order number shown to customers, e.g. PR-260001. */
    orderNumber: text().notNull().unique(),
    /** Secret token for guest order tracking links. */
    accessToken: uuid().notNull().defaultRandom(),
    userId: text(),
    companyId: integer().references(() => companies.id, { onDelete: "set null" }),
    customerGroupId: integer(),
    email: text().notNull(),
    phone: text(),
    locale: text().notNull().default("tr"),
    status: text().$type<OrderStatus>().notNull().default("pending_payment"),
    /** The cart this order was placed from (no FK: carts are deleted on success). Makes double submits idempotent. */
    cartId: uuid().unique(),
    paymentMethod: text().$type<PaymentMethod>().notNull(),
    paymentProvider: text().$type<PaymentProvider>(),
    paymentRef: text(),
    currency: text().notNull().default("TRY"),
    subtotal: integer().$type<Kurus>().notNull(),
    discountTotal: integer().$type<Kurus>().notNull().default(0),
    shippingTotal: integer().$type<Kurus>().notNull().default(0),
    paymentFee: integer().$type<Kurus>().notNull().default(0), // e.g. kapıda ödeme fee
    vatTotal: integer().$type<Kurus>().notNull().default(0),
    grandTotal: integer().$type<Kurus>().notNull(),
    couponCode: text(),
    couponId: integer().references(() => coupons.id, { onDelete: "set null" }),
    breakdown: jsonb().$type<OrderBreakdown>(),
    shippingAddress: jsonb().$type<AddressData>().notNull(),
    invoice: jsonb().$type<InvoiceData>().notNull(),
    customerNote: text(),
    adminNote: text(),
    carrier: text(),
    trackingNumber: text(),
    invoiceUrl: text(),
    /** Legal texts the customer accepted at checkout (version + time), required for distance sales. */
    consents: jsonb().$type<{ key: string; version: string; acceptedAt: string }[]>().default([]),
    paidAt: timestamp({ withTimezone: true }),
    shippedAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    /** Renewal orders: the subscription that created them. */
    subscriptionId: integer().references((): AnyPgColumn => subscriptions.id, { onDelete: "set null" }),
    /** When the review request e-mail was queued (once per order). */
    reviewRequestedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index().on(t.status, t.createdAt),
    index().on(t.userId),
    index().on(t.email),
    index().on(t.subscriptionId),
    // Day 6: per-coupon order lookups (gift wheel statistics, perCustomerLimit counts, coupon usage).
    index().on(t.couponId),
  ],
).enableRLS();

export type OrderItemSnapshot = {
  productId: number;
  productName: LocalizedText;
  /** Option values joined with " · " per locale, e.g. { tr: "5 L Bidon" }. */
  variantTitle: LocalizedText;
  sku: string;
  barcode?: string | null;
  imageUrl?: string | null;
  accentColor?: string | null;
  // Added on day 2 (optional so older rows stay valid):
  productSlug?: string;
  productSubtitle?: LocalizedText | null;
  variantLabels?: LocalizedText[];
  image?: MediaLike | null;
  categoryId?: number | null;
  compareAt?: Kurus | null;
  weightGrams?: number | null;
  /** True when placing the order decremented the variant stock (cancel restocks only these). */
  stockTracked?: boolean;
  couponDiscount?: Kurus;
  bankTransferDiscount?: Kurus;
};

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: integer(),
    snapshot: jsonb().$type<OrderItemSnapshot>().notNull(),
    unitPrice: integer().$type<Kurus>().notNull(),
    quantity: integer().notNull(),
    discount: integer().$type<Kurus>().notNull().default(0),
    lineTotal: integer().$type<Kurus>().notNull(),
    vatRate: smallint().notNull().default(20),
    isSample: boolean().notNull().default(false),
  },
  (t) => [index().on(t.orderId)],
).enableRLS();

/** Order timeline: status changes, payment callbacks, notes, e-mails sent. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text().notNull(),
    message: text(),
    data: jsonb(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orderId)],
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text().$type<PaymentProvider>().notNull(),
    status: text().$type<"initiated" | "succeeded" | "failed" | "refunded">().notNull(),
    amount: integer().$type<Kurus>().notNull(),
    providerRef: text(),
    raw: jsonb(),
    ...timestamps,
  },
  (t) => [
    index().on(t.orderId),
    // A provider reference is recorded once; replays of the same callback are idempotent.
    uniqueIndex("payments_provider_ref_unique").on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
  ],
).enableRLS();

export type CouponType = "percent" | "fixed" | "free_shipping";

/** Where a coupon came from (day 6): typed in the panel, or issued as a gift wheel prize. */
export const COUPON_SOURCES = ["manual", "wheel"] as const;
export type CouponSource = (typeof COUPON_SOURCES)[number];

export const coupons = pgTable(
  "coupons",
  {
    id: id(),
    code: text().notNull().unique(),
    description: text(),
    type: text().$type<CouponType>().notNull(),
    /** Percent (e.g. 15) or kuruş amount depending on type. */
    value: integer().notNull().default(0),
    minOrderTotal: integer().$type<Kurus>().notNull().default(0),
    maxUses: integer(),
    usedCount: integer().notNull().default(0),
    perCustomerLimit: integer(),
    productIds: integer().array(),
    categoryIds: integer().array(),
    customerGroupIds: integer().array(),
    isActive: boolean().notNull().default(true),
    /** Day 6: "manual" (panel Kuponlar) or "wheel" (a gift wheel prize, read-only in the panel). */
    source: text().$type<CouponSource>().notNull().default("manual"),
    /**
     * Day 6: the only account that may use the code (couponEligibility → "not_owner" for anyone else);
     * null = anyone. Wheel prizes always have one (check below), and go away with the account.
     */
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    ...schedule,
    ...timestamps,
  },
  (t) => [
    // Codes are matched case-insensitively (upper(code) = upper(input)), so they must be unique that way too.
    uniqueIndex("coupons_code_upper_unique").on(sql`upper(${t.code})`),
    index().on(t.source),
    index().on(t.userId),
    check("coupons_source_check", sql`${t.source} in ('manual', 'wheel')`),
    // A wheel prize is personal: an owner-less wheel code would be usable by anyone who sees it.
    check("coupons_wheel_owner_check", sql`${t.source} <> 'wheel' or ${t.userId} is not null`),
  ],
).enableRLS();

/** Automatic discounts (no code needed), e.g. "%15 off all 5 L" for a weekend. */
export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text().notNull(),
  label: jsonb().$type<LocalizedText>(), // badge text on products, e.g. "%15 İndirim"
  discountPercent: smallint().notNull(),
  productIds: integer().array(),
  categoryIds: integer().array(),
  customerGroupIds: integer().array(),
  /** Optional theme to switch on while the campaign runs. */
  themeId: integer(),
  priority: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  ...schedule,
  ...timestamps,
}).enableRLS();

export type SubscriptionStatus = "active" | "paused" | "cancelled" | "past_due";

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: text().notNull(),
    planId: integer()
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    status: text().$type<SubscriptionStatus>().notNull().default("active"),
    items: jsonb().$type<{ variantId: number; quantity: number }[]>().notNull(),
    shippingAddress: jsonb().$type<AddressData>().notNull(),
    invoice: jsonb().$type<InvoiceData>().notNull(),
    /** Stored-card reference at the payment provider (never card numbers). */
    paymentToken: text(),
    paymentProvider: text().$type<PaymentProvider>(),
    nextRunAt: timestamp({ withTimezone: true }).notNull(),
    lastOrderId: integer(),
    /** Where renewal e-mails go (the account e-mail when the subscription was created). */
    email: text().notNull(),
    locale: text().notNull().default("tr"),
    /** card renewals send a pay link; bank_transfer → awaiting_transfer; cash_on_delivery → processing. */
    paymentMethod: text().$type<PaymentMethod>().notNull(),
    /** Skip the next renewal once (cleared when the run is skipped). */
    skipNext: boolean().notNull().default(false),
    reminderSentAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    /** Consecutive failed renewals (e.g. out of stock); reset on success. */
    failedCount: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.nextRunAt), index().on(t.userId)],
).enableRLS();

export type RequestStatus = "new" | "in_review" | "approved" | "quoted" | "shipped" | "won" | "rejected";

/** The offer sent for a quote request (panel offer editor → quote_offer e-mail). Money in kuruş. */
export type QuoteOffer = {
  lines: { variantId?: number; label: string; quantity: number; unitPrice: Kurus }[];
  /** ISO date (YYYY-MM-DD) until which the offer is valid. */
  validUntil?: string;
  note?: string;
  total: Kurus;
};

export const quoteRequests = pgTable(
  "quote_requests",
  {
    id: id(),
    companyId: integer().references(() => companies.id, { onDelete: "set null" }),
    userId: text(),
    companyName: text().notNull(),
    contactName: text().notNull(),
    email: text().notNull(),
    phone: text(),
    sector: text().$type<BusinessSector>(),
    items: jsonb().$type<{ variantId?: number; label: string; quantity: number }[]>().notNull().default([]),
    message: text(),
    status: text().$type<RequestStatus>().notNull().default("new"),
    offerTotal: integer().$type<Kurus>(),
    offer: jsonb().$type<QuoteOffer>(),
    quotedAt: timestamp({ withTimezone: true }),
    /** When the requester accepted the KVKK notice on the form. */
    consentAt: timestamp({ withTimezone: true }),
    adminNote: text(),
    locale: text().notNull().default("tr"),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.createdAt)],
).enableRLS();

/** Free sample requests from businesses (hotels, spas, offices), approved from the panel. */
export const sampleRequests = pgTable(
  "sample_requests",
  {
    id: id(),
    companyName: text().notNull(),
    contactName: text().notNull(),
    email: text().notNull(),
    phone: text().notNull(),
    sector: text().$type<BusinessSector>().notNull().default("other"),
    address: jsonb().$type<AddressData>().notNull(),
    productIds: integer().array().notNull(),
    estimatedMonthlyLiters: integer(),
    message: text(),
    status: text().$type<RequestStatus>().notNull().default("new"),
    adminNote: text(),
    trackingNumber: text(),
    /** Carrier key from settings.shipping.carriers. */
    carrier: text(),
    approvedAt: timestamp({ withTimezone: true }),
    shippedAt: timestamp({ withTimezone: true }),
    /** When the requester accepted the KVKK notice on the form. */
    consentAt: timestamp({ withTimezone: true }),
    locale: text().notNull().default("tr"),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.createdAt)],
).enableRLS();

/** Customer favorites (/hesap/favoriler, the heart on product cards). */
export const favorites = pgTable(
  "favorites",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] }), index().on(t.productId)],
).enableRLS();
