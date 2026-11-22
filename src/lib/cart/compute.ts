// The money engine: the ONLY place cart and order totals are computed (docs/DAY2-CART-CHECKOUT.md,
// "Money rules"). Pure: no DB, no clock (input.now), no I/O. All amounts are integer kuruş, VAT included.
//
// Order of operations
//   1. Sanitize every line (status, quantity clamps, stock) and price it with resolveUnitPrice.
//   2. subtotal = Σ unitPrice × qty over included paid lines; validate samples against it.
//   3. Coupon (percent / fixed capped at the eligible total / free_shipping) on eligible lines.
//   4. Shipping from the merchandise after the coupon; heavy surcharge from the weight (always).
//   5. Havale/EFT discount on (subtotal − coupon) when that method is chosen; kapıda ödeme fee.
//   6. Discounts allocated to lines (largest remainder), VAT per line + shipping + fee, grand total.
//
// Subscribe and save: a line with a usable plan gets the plan discount on its resolved unit price
// instead of the automatic campaign when the plan percent is at least as large (resolveUnitPrice);
// coupons apply on top as usual. Such a cart needs a signed-in buyer and one of
// subscriptions.allowedMethods.
import { pickCampaign } from "@/lib/campaigns/pick";
import { resolveUnitPrice, type AppliedRule, type TierDiscount } from "@/lib/pricing/resolve";
import { couponEligibility } from "@/lib/coupons/eligibility";
import {
  DEFAULT_MAX_QUANTITY,
  PAYMENT_METHODS,
  SHIPPING_VAT_RATE,
  type CartComputeInput,
  type CartIssue,
  type CartTotals,
  type CouponState,
  type CustomerContext,
  type EngineCampaign,
  type EngineLine,
  type MethodTotals,
  type PaymentMethod,
  type PaymentMethodOption,
  type PaymentUnavailableReason,
  type PricedLine,
  type PricedSubscription,
  type SamplesState,
  type ShippingBreakdown,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Integer helpers

/** Non-negative integer, or `fallback` for NaN/Infinity/negative/non-numbers. */
function safeInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/** round(numerator / denominator), halves rounded up, for non-negative integers. */
export function roundDiv(numerator: number, denominator: number): number {
  if (!(denominator > 0)) throw new RangeError("roundDiv: denominator must be positive");
  if (!(numerator > 0)) return 0;
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** VAT contained in a VAT-included amount: round(amount × rate / (100 + rate)). */
export function vatIncluded(amount: number, rate: number): number {
  const r = safeInt(rate, 20);
  return r === 0 ? 0 : roundDiv(amount * r, 100 + r);
}

/**
 * Splits `total` over `weights` proportionally with largest-remainder rounding. The shares are
 * integers, sum to exactly `total`, and no share exceeds its weight when total ≤ Σ weights.
 * Ties on the remainder go to the larger weight, then the earlier index (deterministic).
 * BigInt keeps total × weight exact for any realistic amount.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const w = weights.map((x) => BigInt(safeInt(x)));
  const T = BigInt(safeInt(total));
  const W = w.reduce((a, b) => a + b, BigInt(0));
  if (T === BigInt(0) || W === BigInt(0)) return weights.map(() => 0);
  const shares = w.map((wi) => (T * wi) / W);
  const remainders = w.map((wi) => (T * wi) % W);
  let left = Number(T - shares.reduce((a, b) => a + b, BigInt(0)));
  const order = w
    .map((wi, i) => i)
    .sort((a, b) => (remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : w[b] > w[a] ? 1 : w[b] < w[a] ? -1 : a - b));
  for (const i of order) {
    if (left <= 0) break;
    if (remainders[i] === BigInt(0) && w[i] === BigInt(0)) continue;
    shares[i] += BigInt(1);
    left -= 1;
  }
  return shares.map(Number);
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------------------------
// Pricing helpers

/** Group-specific tiers win over retail ones; no tiers at all when an explicit group price exists. */
function tiersFor(line: EngineLine, customer: CustomerContext, explicitGroupPrice: boolean): TierDiscount[] | null {
  if (explicitGroupPrice) return null;
  const valid = (line.tiers ?? []).filter((t) => Number.isFinite(t.minQuantity) && Number.isFinite(t.discountPercent));
  if (customer.groupId != null) {
    const own = valid.filter((t) => t.groupId === customer.groupId);
    if (own.length > 0) return own;
  }
  return valid.filter((t) => t.groupId == null);
}

/**
 * Highest-priority campaign (then highest percent) that covers the line now. The choice lives in
 * src/lib/campaigns/pick.ts, shared with the storefront display (parity: tests/unit/campaign-*.test.ts).
 */
function campaignFor(line: EngineLine, customer: CustomerContext, campaigns: readonly EngineCampaign[], now: number): number | null {
  return pickCampaign(campaigns, line, { groupId: customer.groupId, now })?.percent ?? null;
}

// ---------------------------------------------------------------------------------------------
// Line sanitizing

type WorkLine = PricedLine & { categoryId: number | null };

function sanitizeLine(
  line: EngineLine,
  customer: CustomerContext,
  campaigns: readonly EngineCampaign[],
  now: number,
  remainingStock: Map<number, number>,
  subscriptionsEnabled: boolean,
): WorkLine {
  const isSample = line.productType === "sample";
  const issues: CartIssue[] = [];
  const base = { lineId: line.lineId, variantId: line.variantId };
  let included = true;

  // Subscribe and save: only a paid line whose stored plan is usable right now.
  const wantsPlan = !isSample && line.subscriptionPlanId != null;
  const plan =
    wantsPlan && subscriptionsEnabled && line.subscriptionPlan && line.subscriptionPlan.id === line.subscriptionPlanId ? line.subscriptionPlan : null;

  // A free sample that cannot be sent (unavailable, sold out) is only left out: it never blocks the
  // paid order, and syncCart removes it from the cart.
  if (line.productStatus !== "active" || !line.variantActive || (line.businessOnly && !customer.isBusiness)) {
    issues.push({ ...base, code: "unavailable", blocking: !isSample });
    included = false;
  }

  // Quantity: integer ≥ 1, else the line is invalid (never silently turned into 1).
  const raw = line.quantity;
  const whole = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : Number.NaN;
  const requested = whole >= 1 ? whole : 0;
  if (requested === 0) {
    if (included) issues.push({ ...base, code: "invalid_quantity", blocking: true });
    included = false;
  }

  const minQuantity = isSample ? 1 : Math.max(1, safeInt(line.minQuantity, 1));
  const configuredMax =
    line.maxQuantity != null && Number.isFinite(line.maxQuantity) && line.maxQuantity >= 1 ? Math.floor(line.maxQuantity) : DEFAULT_MAX_QUANTITY;
  const maxByRules = isSample ? 1 : Math.max(minQuantity, configuredMax);

  let quantity = Math.min(Math.max(requested, minQuantity), maxByRules);
  let reason: CartIssue["reason"] | undefined;
  if (requested > 0) {
    if (isSample && requested !== 1) reason = "sample";
    else if (requested < minQuantity) reason = "min";
    else if (requested > maxByRules) reason = "max";
    else if (typeof raw === "number" && raw !== whole) reason = "fraction";
  }

  const tracked = line.trackStock && !line.allowBackorder;
  let availableStock: number | null = null;
  let maxQuantity = maxByRules;
  if (tracked) {
    const stockLeft = remainingStock.has(line.variantId) ? remainingStock.get(line.variantId)! : safeInt(line.stock);
    availableStock = stockLeft;
    maxQuantity = Math.min(maxByRules, stockLeft);
    if (included && stockLeft < minQuantity) {
      issues.push({ ...base, code: "out_of_stock", blocking: !isSample });
      included = false;
    } else if (quantity > stockLeft) {
      quantity = stockLeft;
      reason = "stock";
    }
  }
  if (included && reason) issues.push({ ...base, code: "quantity_adjusted", blocking: false, requested, allowed: quantity, reason });
  if (included && wantsPlan && !plan) issues.push({ ...base, code: "subscription_unavailable", blocking: false });
  if (included && tracked) remainingStock.set(line.variantId, (availableStock ?? 0) - quantity);

  // Price (also for excluded lines, so the cart can still show what it was).
  let unitPrice = 0;
  let compareAt: number | null = null;
  let appliedRules: AppliedRule[] = [];
  let subscription: PricedSubscription | null = null;
  if (!isSample) {
    try {
      const explicit = customer.groupId != null && typeof line.groupPrice === "number" && Number.isFinite(line.groupPrice) && line.groupPrice >= 0;
      const resolved = resolveUnitPrice({
        basePrice: line.basePrice,
        compareAtPrice: line.compareAtPrice,
        groupPrice: explicit ? line.groupPrice : null,
        groupDiscountPercent: customer.groupId != null ? customer.groupDiscountPercent : 0,
        tierDiscounts: tiersFor(line, customer, explicit),
        campaignPercent: campaignFor(line, customer, campaigns, now),
        subscriptionPercent: plan ? plan.percent : null,
        quantity,
      });
      unitPrice = resolved.unitPrice;
      compareAt = resolved.compareAt ?? null;
      appliedRules = resolved.appliedRules;
      if (plan) {
        const won = resolved.appliedRules.find((r) => r.kind === "subscription" || r.kind === "campaign");
        subscription = {
          planId: plan.id,
          percent: Math.min(100, Math.max(0, Math.round(plan.percent) || 0)),
          interval: plan.interval,
          intervalCount: Math.max(1, Math.round(plan.intervalCount) || 1),
          discount: won?.kind === "subscription" ? "subscription" : won?.kind === "campaign" ? "campaign" : "none",
          campaignPercent: won?.kind === "campaign" ? won.percent : 0,
        };
      }
    } catch {
      // Invalid base price (NaN, negative): fail closed, the line cannot be bought.
      if (included) issues.push({ ...base, code: "unavailable", blocking: true });
      included = false;
    }
  }

  const vatRate = typeof line.vatRate === "number" && Number.isFinite(line.vatRate) ? Math.min(100, Math.max(0, Math.round(line.vatRate))) : 20;
  return {
    lineId: line.lineId,
    variantId: line.variantId,
    productId: line.productId,
    categoryId: line.categoryId,
    isSample,
    included,
    requestedQuantity: requested,
    quantity: included ? quantity : Math.max(requested, 0),
    minQuantity,
    maxQuantity: Math.max(0, maxQuantity),
    availableStock,
    unitPrice,
    compareAt,
    appliedRules,
    lineSubtotal: 0,
    couponDiscount: 0,
    bankTransferDiscount: 0,
    discount: 0,
    lineTotal: 0,
    vatRate,
    vat: 0,
    weightGrams: included ? safeInt(line.weightGrams) * quantity : 0,
    couponEligible: false,
    subscription,
    issues,
  };
}

function exclude(line: WorkLine, issue: CartIssue) {
  line.included = false;
  line.weightGrams = 0;
  line.issues.push(issue);
}

// ---------------------------------------------------------------------------------------------
// Core

type Core = MethodTotals & {
  lines: WorkLine[];
  issues: CartIssue[];
  totalWeightGrams: number;
  itemCount: number;
  paidItemCount: number;
  coupon: CouponState | null;
  samples: SamplesState;
  paidLineCount: number;
  subscriptionLineCount: number;
};

function computeCore(input: CartComputeInput, method: PaymentMethod | null): Core {
  const { settings, customer, coupon } = input;
  const now = input.now.getTime();
  const campaigns = input.campaigns ?? [];
  const remainingStock = new Map<number, number>();
  const subscriptionsEnabled = Boolean(settings.subscriptions?.enabled);
  const lines = input.lines.map((l) => sanitizeLine(l, customer, campaigns, now, remainingStock, subscriptionsEnabled));

  // 2. Paid subtotal, then samples.
  for (const l of lines) l.lineSubtotal = l.included && !l.isSample ? l.unitPrice * l.quantity : 0;
  const paid = lines.filter((l) => l.included && !l.isSample);
  const subtotal = sum(paid.map((l) => l.lineSubtotal));

  const s = settings.samples;
  const maxSamples = safeInt(s.maxPerOrder);
  const sampleMin = safeInt(s.minOrderTotal);
  const samplesReason: SamplesState["reason"] = !s.cartSampleEnabled
    ? "disabled"
    : paid.length === 0
      ? "no_paid_items"
      : subtotal < sampleMin
        ? "min_order"
        : undefined;
  const seenSamples = new Set<number>();
  for (const l of lines) {
    if (!l.isSample || !l.included) continue;
    const base = { lineId: l.lineId, variantId: l.variantId, blocking: false };
    if (samplesReason === "min_order") exclude(l, { ...base, code: "sample_min_order" });
    else if (samplesReason) exclude(l, { ...base, code: "sample_not_allowed" });
    else if (seenSamples.size >= maxSamples || seenSamples.has(l.variantId)) exclude(l, { ...base, code: "sample_limit" });
    else seenSamples.add(l.variantId);
  }
  const samples: SamplesState = {
    enabled: s.cartSampleEnabled,
    allowed: !samplesReason && maxSamples > 0,
    ...(samplesReason ? { reason: samplesReason } : {}),
    max: maxSamples,
    used: seenSamples.size,
    minOrderTotal: sampleMin,
  };

  // 3. Coupon.
  let couponState: CouponState | null = null;
  let couponDiscount = 0;
  let couponFreeShipping = false;
  let couponLineIds: number[] = [];
  if (coupon) {
    const result = couponEligibility(coupon, { lines: paid, subtotal, customer, now: input.now });
    couponLineIds = result.eligibleLineIds;
    if (result.valid) {
      if (coupon.type === "percent") {
        const pct = Math.min(100, safeInt(coupon.value));
        couponDiscount = roundDiv(result.eligibleSubtotal * pct, 100);
      } else if (coupon.type === "fixed") {
        couponDiscount = Math.min(safeInt(coupon.value), result.eligibleSubtotal);
      } else {
        couponFreeShipping = true;
      }
    }
    // Day 6: nothing about a coupon bound to another account is passed on (expiry, origin, minimum).
    const foreign = !result.valid && result.reason === "not_owner";
    couponState = {
      code: coupon.code,
      type: coupon.type,
      status: result.valid ? "applied" : "invalid",
      ...(result.valid ? {} : { reason: result.reason }),
      discount: couponDiscount,
      eligibleSubtotal: result.eligibleSubtotal,
      minOrderTotal: foreign ? 0 : safeInt(coupon.minOrderTotal),
      ...(!foreign && coupon.endsAt ? { endsAt: coupon.endsAt.toISOString() } : {}),
      ...(!foreign && coupon.source ? { source: coupon.source } : {}),
    };
  }
  const couponShares = allocate(
    couponDiscount,
    paid.map((l) => (couponLineIds.includes(l.lineId) ? l.lineSubtotal : 0)),
  );
  paid.forEach((l, i) => {
    l.couponDiscount = couponShares[i];
    l.couponEligible = couponLineIds.includes(l.lineId);
  });
  const merchandiseAfterCoupon = subtotal - couponDiscount;

  // 4. Shipping.
  const included = lines.filter((l) => l.included);
  const totalWeightGrams = sum(included.map((l) => l.weightGrams));
  const { flatFee, freeThreshold, heavy } = settings.shipping;
  const threshold = safeInt(freeThreshold);
  const baseFee = safeInt(flatFee);
  const hasShipment = included.length > 0;
  const thresholdMet = threshold > 0 && merchandiseAfterCoupon >= threshold;
  const free = hasShipment && (couponFreeShipping || thresholdMet);
  const flat = hasShipment && !free ? baseFee : 0;
  const heavyThreshold = safeInt(heavy?.thresholdGrams);
  const heavyKg = hasShipment && heavy?.enabled && totalWeightGrams > heavyThreshold ? Math.ceil((totalWeightGrams - heavyThreshold) / 1000) : 0;
  const heavyFee = heavyKg * safeInt(heavy?.feePerKg);
  const shipping: ShippingBreakdown = {
    flat,
    heavy: heavyFee,
    total: flat + heavyFee,
    free,
    // The threshold wins: a free_shipping coupon on a cart that ships free anyway saved nothing.
    freeReason: free ? (thresholdMet ? "threshold" : "coupon") : null,
    remainingForFree: threshold > 0 && !free ? Math.max(0, threshold - merchandiseAfterCoupon) : 0,
    threshold,
    baseFee,
    heavyKg,
  };

  // 5. Havale discount (after the coupon, merchandise only) and the kapıda ödeme fee.
  const bankPercent = method === "bank_transfer" ? Math.min(100, safeInt(settings.payments.bankTransfer.discountPercent)) : 0;
  const bankTransferDiscount = roundDiv(merchandiseAfterCoupon * bankPercent, 100);
  const bankShares = allocate(
    bankTransferDiscount,
    paid.map((l) => l.lineSubtotal - l.couponDiscount),
  );
  paid.forEach((l, i) => {
    l.bankTransferDiscount = bankShares[i];
  });
  const paymentFee = method === "cash_on_delivery" && hasShipment ? safeInt(settings.payments.cashOnDelivery.fee) : 0;

  // 6. Line totals, VAT, grand total.
  for (const l of lines) {
    l.discount = l.couponDiscount + l.bankTransferDiscount;
    l.lineTotal = l.lineSubtotal - l.discount;
    l.vat = vatIncluded(l.lineTotal, l.vatRate);
  }
  const discountTotal = couponDiscount + bankTransferDiscount;
  const vatTotal = sum(lines.map((l) => l.vat)) + vatIncluded(shipping.total, SHIPPING_VAT_RATE) + vatIncluded(paymentFee, SHIPPING_VAT_RATE);
  const grandTotal = subtotal - discountTotal + shipping.total + paymentFee;

  // Cart-level issues.
  const issues: CartIssue[] = lines.flatMap((l) => l.issues);
  if (lines.length === 0) issues.push({ code: "empty", blocking: true });
  else if (paid.length === 0 && lines.some((l) => l.isSample) && !issues.some((i) => i.blocking)) {
    issues.push({ code: "samples_only", blocking: true });
  }
  // A subscription renews into the buyer's account: no subscription without one.
  const subscriptionLineCount = paid.filter((l) => l.subscription).length;
  if (subscriptionLineCount > 0 && !customer.userId) issues.push({ code: "subscription_sign_in", blocking: true });

  return {
    lines,
    issues,
    subtotal,
    discounts: { coupon: couponDiscount, bankTransfer: bankTransferDiscount },
    discountTotal,
    shipping,
    paymentFee,
    vatTotal,
    grandTotal,
    totalWeightGrams,
    itemCount: sum(included.map((l) => l.quantity)),
    paidItemCount: sum(paid.map((l) => l.quantity)),
    coupon: couponState,
    samples,
    paidLineCount: paid.length,
    subscriptionLineCount,
  };
}

function methodTotals(core: Core): MethodTotals {
  return {
    subtotal: core.subtotal,
    discounts: { ...core.discounts },
    discountTotal: core.discountTotal,
    shipping: { ...core.shipping },
    paymentFee: core.paymentFee,
    vatTotal: core.vatTotal,
    grandTotal: core.grandTotal,
  };
}

function unavailableReason(method: PaymentMethod, core: Core, input: CartComputeInput): PaymentUnavailableReason | null {
  const own = methodReason(method, core, input);
  if (own || core.subscriptionLineCount === 0) return own;
  const allowed: readonly PaymentMethod[] = input.settings.subscriptions?.allowedMethods ?? [];
  return allowed.includes(method) ? null : "subscription";
}

function methodReason(method: PaymentMethod, core: Core, input: CartComputeInput): PaymentUnavailableReason | null {
  const { payments } = input.settings;
  switch (method) {
    case "card":
      if (!payments.card.enabled) return "disabled";
      if (input.cardGatewayReady === false) return "not_configured";
      return core.grandTotal > 0 ? null : "nothing_to_pay";
    case "bank_transfer":
      if (!payments.bankTransfer.enabled) return "disabled";
      if (!payments.bankTransfer.accounts?.length) return "no_bank_account";
      return core.grandTotal > 0 ? null : "nothing_to_pay";
    case "cash_on_delivery": {
      if (!payments.cashOnDelivery.enabled) return "disabled";
      const max = safeInt(payments.cashOnDelivery.maxOrderTotal);
      return max > 0 && core.grandTotal - core.paymentFee > max ? "over_limit" : null;
    }
    case "deferred":
      return input.customer.companyApproved && input.customer.allowDeferred ? null : "not_eligible";
  }
}

/** Computes the cart for `input.paymentMethod` (none = no fee, no havale discount) plus every method's totals. */
export function computeCart(input: CartComputeInput): CartTotals {
  const chosen = input.paymentMethod ?? null;
  const core = computeCore(input, chosen);
  const paymentMethods: PaymentMethodOption[] = PAYMENT_METHODS.map((method) => {
    const forMethod = method === chosen ? core : computeCore(input, method);
    const reason = unavailableReason(method, forMethod, input);
    return {
      method,
      available: reason === null,
      ...(reason ? { reason } : {}),
      totals: methodTotals(forMethod),
      discountPercent: method === "bank_transfer" ? Math.min(100, safeInt(input.settings.payments.bankTransfer.discountPercent)) : 0,
      ...(method === "cash_on_delivery" ? { limit: safeInt(input.settings.payments.cashOnDelivery.maxOrderTotal) } : {}),
      ...(method === "bank_transfer" && input.settings.payments.bankTransfer.paymentDays ? { paymentDays: safeInt(input.settings.payments.bankTransfer.paymentDays) } : {}),
    };
  });
  const blocking = core.issues.some((i) => i.blocking);
  const { lines, paidLineCount, subscriptionLineCount, ...rest } = core;
  return {
    ...rest,
    lines: lines.map((l) => {
      const { categoryId, ...line } = l;
      void categoryId;
      return line;
    }),
    paymentMethod: chosen,
    paymentMethods,
    checkoutAllowed: paidLineCount > 0 && !blocking && paymentMethods.some((m) => m.available),
    subscription: {
      lineCount: subscriptionLineCount,
      signInRequired: subscriptionLineCount > 0 && !input.customer.userId,
      allowedMethods: [...(input.settings.subscriptions?.allowedMethods ?? [])],
    },
  };
}

/** Totals for one method (convenience for checkout). Unavailable methods still return their totals. */
export function totalsForMethod(totals: CartTotals, method: PaymentMethod): PaymentMethodOption {
  return totals.paymentMethods.find((m) => m.method === method)!;
}
