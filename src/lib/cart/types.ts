// Shared, serializable types of the cart/checkout money engine (src/lib/cart/compute.ts).
// Type-only module (plus two constants): safe to import from server and client code.
import type { ProductStatus, ProductType } from "@/db/schema/catalog";
import type { CouponSource, CouponType, PaymentMethod } from "@/db/schema/commerce";
import type { LocalizedText } from "@/db/schema/common";
import type { AppliedRule } from "@/lib/pricing/resolve";
import type { Settings, SubscriptionPaymentMethod } from "@/lib/settings/types";

export type { CouponSource, CouponType, PaymentMethod };

/** Every checkout payment method, in display order. */
export const PAYMENT_METHODS = ["card", "bank_transfer", "cash_on_delivery", "deferred"] as const satisfies readonly PaymentMethod[];

/** VAT rate (percent) included in shipping fees and the kapıda ödeme fee. */
export const SHIPPING_VAT_RATE = 20;
/** Upper quantity bound for a line when the variant has no maxQuantity. */
export const DEFAULT_MAX_QUANTITY = 99;

// ---------------------------------------------------------------------------------------------
// Inputs

/** Who is buying. Built by getCustomerContext() (src/lib/customer/context.ts); retail when signed out. */
export type CustomerContext = {
  userId: string | null;
  /** Pricing group. Only set when it applies (approved company when b2b.requireApproval). */
  groupId: number | null;
  groupSlug: string | null;
  /** Blanket group discount used when a variant has no explicit group price. */
  groupDiscountPercent: number;
  isBusiness: boolean;
  /** Display hint for B2B (prices are still stored and charged VAT-included). */
  showPricesExVat: boolean;
  companyId: number | null;
  companyApproved: boolean;
  /** Approved company with paymentTerms.allowDeferred: may pay by "deferred" (vadeli / cari hesap). */
  allowDeferred: boolean;
  deferredDays: number | null;
  /**
   * Go-live CF-11: a signed-in panel user (admin, editor or staff). Only they may pay by card while the
   * panel's test mode is on on a live site (cardTestModeHidden). Set by getCustomerContext; omitted = false.
   */
  staff?: boolean;
};

export const RETAIL_CUSTOMER: CustomerContext = Object.freeze({
  userId: null,
  groupId: null,
  groupSlug: null,
  groupDiscountPercent: 0,
  isBusiness: false,
  showPricesExVat: false,
  companyId: null,
  companyApproved: false,
  allowDeferred: false,
  deferredDays: null,
});

/** A volume tier row; `groupId` null = retail tier. */
export type EngineTier = { minQuantity: number; discountPercent: number; groupId: number | null };

/** An automatic campaign (table `campaigns`). Empty/null id lists mean "everything". */
export type EngineCampaign = {
  id: number;
  percent: number;
  priority: number;
  productIds: number[] | null;
  categoryIds: number[] | null;
  customerGroupIds: number[] | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** A subscribe-and-save plan (table subscription_plans) as the engine needs it. */
export type EngineSubscriptionPlan = {
  id: number;
  /** Display only (the cart line names the plan); the engine ignores it. */
  name?: LocalizedText | null;
  /** Plan discount (whole percent); never stacks with a campaign, the larger one wins. */
  percent: number;
  interval: "week" | "month";
  intervalCount: number;
};

/** One cart row with everything the engine needs (no display data). Built by loadCart(). */
export type EngineLine = {
  lineId: number;
  variantId: number;
  productId: number;
  categoryId: number | null;
  productType: ProductType;
  productStatus: ProductStatus;
  variantActive: boolean;
  businessOnly: boolean;
  /** Requested quantity as stored (the engine sanitizes it). */
  quantity: number;
  basePrice: number;
  compareAtPrice: number | null;
  /** Explicit price for the customer's group (group_prices), if any. */
  groupPrice: number | null;
  /** Tier rows for this variant or its product: retail and the customer's group only. */
  tiers: EngineTier[];
  vatRate: number;
  weightGrams: number | null;
  stock: number;
  trackStock: boolean;
  allowBackorder: boolean;
  minQuantity: number;
  maxQuantity: number | null;
  /** cart_items.subscription_plan_id as stored (null/absent = a one-time purchase). */
  subscriptionPlanId?: number | null;
  /**
   * That plan when it may be used for this line now (the plan is active and the product allows
   * subscriptions). A stored plan id without it is a one-time purchase with "subscription_unavailable".
   */
  subscriptionPlan?: EngineSubscriptionPlan | null;
};

export type CouponData = {
  id: number;
  code: string;
  type: CouponType;
  /** Percent for "percent", kuruş for "fixed", ignored for "free_shipping". */
  value: number;
  minOrderTotal: number;
  maxUses: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  productIds: number[] | null;
  categoryIds: number[] | null;
  customerGroupIds: number[] | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  /**
   * Day 6: the only account that may use the code; null/absent = anyone. couponEligibility fails with
   * "not_owner" for every other customer (signed out included). Optional so older literals stay valid.
   */
  userId?: string | null;
  /** Day 6: "manual" (panel) or "wheel" (gift wheel prize); absent = manual. */
  source?: CouponSource;
};

export type EngineSettings = {
  shipping: Pick<Settings<"shipping">, "flatFee" | "freeThreshold" | "heavy">;
  payments: Pick<Settings<"payments">, "card" | "bankTransfer" | "cashOnDelivery">;
  samples: Pick<Settings<"samples">, "cartSampleEnabled" | "maxPerOrder" | "minOrderTotal">;
  /** Subscribe and save. Absent = subscriptions are off (subscription lines are one-time purchases). */
  subscriptions?: { enabled: boolean; allowedMethods: readonly SubscriptionPaymentMethod[] };
};

export type CartComputeInput = {
  lines: EngineLine[];
  customer: CustomerContext;
  coupon: CouponData | null;
  settings: EngineSettings;
  /** Totals are computed for this method (fee, havale discount). Omit for the cart page. */
  paymentMethod?: PaymentMethod | null;
  campaigns?: EngineCampaign[];
  /** False when no card gateway is configured (PAYMENT_SIMULATOR off and no real provider). Default true. */
  cardGatewayReady?: boolean;
  now: Date;
};

// ---------------------------------------------------------------------------------------------
// Outputs

export type LineIssueCode =
  /** Product/variant inactive, draft, archived, business-only for a retail buyer, or unpriceable. Blocking. */
  | "unavailable"
  /** Stock is below the minimum quantity. Blocking. */
  | "out_of_stock"
  /** Stored quantity is NaN, Infinity, 0 or negative. Blocking. */
  | "invalid_quantity"
  /** Quantity was clamped (min/max/stock/fraction/sample = 1). Informational; totals use the new quantity. */
  | "quantity_adjusted"
  /** Samples are disabled or there is no paid line. The sample is ignored. */
  | "sample_not_allowed"
  /** Paid subtotal below samples.minOrderTotal. The sample is ignored. */
  | "sample_min_order"
  /** More distinct samples than samples.maxPerOrder (or a duplicate). The sample is ignored. */
  | "sample_limit"
  /** The line asks for a plan that cannot be used now (plan off, product or shop not offering it). Informational: bought once. */
  | "subscription_unavailable";

/** subscription_sign_in: the cart has a subscription line but nobody is signed in. Blocking. */
export type CartIssueCode = LineIssueCode | "empty" | "samples_only" | "subscription_sign_in";

export type CartIssue = {
  code: CartIssueCode;
  /** Blocking issues stop checkout until the customer fixes the cart. */
  blocking: boolean;
  lineId?: number;
  variantId?: number;
  /** For quantity_adjusted: what was asked for and what is used. */
  requested?: number;
  allowed?: number;
  reason?: "min" | "max" | "stock" | "fraction" | "sample";
};

export type PricedLine = {
  lineId: number;
  variantId: number;
  productId: number;
  isSample: boolean;
  /** Counted in totals and weight. False for lines with a blocking issue and for ignored samples. */
  included: boolean;
  /** Sanitized stored quantity (0 when invalid). */
  requestedQuantity: number;
  /** Quantity used for pricing (after clamping). */
  quantity: number;
  minQuantity: number;
  /** Effective upper bound for a stepper: min(maxQuantity ?? 99, stock when tracked). */
  maxQuantity: number;
  /** Stock available for this line, null when not tracked or backorder is allowed. */
  availableStock: number | null;
  unitPrice: number;
  compareAt: number | null;
  appliedRules: AppliedRule[];
  /** unitPrice × quantity (0 when excluded). */
  lineSubtotal: number;
  couponDiscount: number;
  bankTransferDiscount: number;
  /** couponDiscount + bankTransferDiscount (largest-remainder share of the order discounts). */
  discount: number;
  /** lineSubtotal − discount. */
  lineTotal: number;
  vatRate: number;
  /** VAT contained in lineTotal. */
  vat: number;
  /** weightGrams × quantity. */
  weightGrams: number;
  couponEligible: boolean;
  /** The plan this line subscribes to (null = one-time purchase), and which discount won. */
  subscription: PricedSubscription | null;
  issues: CartIssue[];
};

export type PricedSubscription = {
  planId: number;
  /** The plan's discount percent. */
  percent: number;
  interval: "week" | "month";
  intervalCount: number;
  /** Which discount the unit price carries: the plan's, a better campaign's, or none (0 % plan, no campaign). */
  discount: "subscription" | "campaign" | "none";
  /** The campaign percent that beat the plan (discount = "campaign"), else 0. */
  campaignPercent: number;
};

export type ShippingBreakdown = {
  /** Flat fee charged (0 when free or nothing to ship). */
  flat: number;
  /** Heavy-parcel surcharge (charged even when shipping is free). */
  heavy: number;
  total: number;
  /** The flat fee was waived (threshold reached or free_shipping coupon). */
  free: boolean;
  freeReason: "threshold" | "coupon" | null;
  /** Merchandise (after coupon) still needed for free shipping; 0 when free or no threshold. */
  remainingForFree: number;
  /** shipping.freeThreshold (0 = never free). */
  threshold: number;
  /** shipping.flatFee from settings. */
  baseFee: number;
  /** Started kilograms above the heavy threshold. */
  heavyKg: number;
};

export type MethodTotals = {
  subtotal: number;
  discounts: { coupon: number; bankTransfer: number };
  discountTotal: number;
  shipping: ShippingBreakdown;
  paymentFee: number;
  vatTotal: number;
  grandTotal: number;
};

export type PaymentUnavailableReason =
  | "disabled"
  | "not_configured"
  | "no_bank_account"
  | "over_limit"
  | "not_eligible"
  | "nothing_to_pay"
  /** The cart has a subscription line and subscriptions.allowedMethods does not include this method. */
  | "subscription";

export type PaymentMethodOption = {
  method: PaymentMethod;
  available: boolean;
  reason?: PaymentUnavailableReason;
  /** Full totals as they would be with this method (fee, havale discount). */
  totals: MethodTotals;
  /** bankTransfer.discountPercent for havale, else 0. */
  discountPercent: number;
  /** For kapıda ödeme: cashOnDelivery.maxOrderTotal (0 = none), used in the "over_limit" message. */
  limit?: number;
  /** SR-2, havale only: bankTransfer.paymentDays (the checkout hint "pay within N days"). */
  paymentDays?: number;
};

export type CouponInvalidReason =
  | "not_found"
  /** Day 6: the coupon belongs to another account (checked first, so nothing else about it is revealed). */
  | "not_owner"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "group_not_allowed"
  | "min_order"
  | "no_eligible_items"
  | "per_customer_limit";

export type CouponState = {
  code: string;
  type: CouponType;
  status: "applied" | "invalid";
  reason?: CouponInvalidReason;
  /** Order discount from the coupon (0 for free_shipping; see shipping.freeReason). */
  discount: number;
  /** Total of the lines the coupon can apply to. */
  eligibleSubtotal: number;
  minOrderTotal: number;
  /** Day 6: ISO end of the coupon's validity when it has one (the gift wheel countdown is a real expiry). */
  endsAt?: string;
  /** Day 6: set when the coupon row says where it came from ("wheel" prizes show a countdown). */
  source?: CouponSource;
};

export type SamplesState = {
  enabled: boolean;
  /** Samples can be in this cart right now. */
  allowed: boolean;
  reason?: "disabled" | "no_paid_items" | "min_order";
  max: number;
  /** Valid sample lines counted in the cart. */
  used: number;
  minOrderTotal: number;
};

export type CartTotals = MethodTotals & {
  lines: PricedLine[];
  /** Line issues and cart-level issues (empty, samples_only). */
  issues: CartIssue[];
  totalWeightGrams: number;
  /** Units of included lines, samples included (header badge). */
  itemCount: number;
  /** Units of included paid lines. */
  paidItemCount: number;
  coupon: CouponState | null;
  samples: SamplesState;
  paymentMethod: PaymentMethod | null;
  paymentMethods: PaymentMethodOption[];
  /** There are paid lines, no blocking issue and at least one available payment method. */
  checkoutAllowed: boolean;
  /** Subscribe and save: included paid lines with a plan, and the methods such a cart may use. */
  subscription: { lineCount: number; signInRequired: boolean; allowedMethods: SubscriptionPaymentMethod[] };
};
