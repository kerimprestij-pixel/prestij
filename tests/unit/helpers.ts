// Fixtures for the money engine tests.
import { RETAIL_CUSTOMER, type CartComputeInput, type CouponData, type CustomerContext, type EngineLine, type EngineSettings } from "@/lib/cart/types";

export const NOW = new Date("2026-11-06T12:00:00.000Z");

export function settings(overrides: { shipping?: Partial<EngineSettings["shipping"]>; payments?: Partial<EngineSettings["payments"]>; samples?: Partial<EngineSettings["samples"]> } = {}): EngineSettings {
  return {
    shipping: { flatFee: 9990, freeThreshold: 150000, heavy: { enabled: true, thresholdGrams: 10000, feePerKg: 1500 }, ...overrides.shipping },
    payments: {
      card: { enabled: true, provider: "iyzico", testMode: true, installments: true, maxInstallments: 1 },
      bankTransfer: {
        enabled: true,
        discountPercent: 5,
        accounts: [{ bank: "Test Bankası", holder: "PRESTİJ", iban: "TR330006100519786457841326" }],
        instructions: { tr: "Açıklamaya sipariş numaranızı yazın." },
        paymentDays: 3,
      },
      cashOnDelivery: { enabled: true, fee: 4990, maxOrderTotal: 500000 },
      ...overrides.payments,
    },
    samples: { cartSampleEnabled: true, maxPerOrder: 2, minOrderTotal: 0, ...overrides.samples },
  };
}

let nextLineId = 1;

/** A paid 500 ml line by default (14990 kuruş, 750 g, stock 100). */
export function line(overrides: Partial<EngineLine> = {}): EngineLine {
  const lineId = overrides.lineId ?? nextLineId++;
  return {
    lineId,
    variantId: overrides.variantId ?? 1000 + lineId,
    productId: 1,
    categoryId: 1,
    productType: "standard",
    productStatus: "active",
    variantActive: true,
    businessOnly: false,
    quantity: 1,
    basePrice: 14990,
    compareAtPrice: null,
    groupPrice: null,
    tiers: [],
    vatRate: 20,
    weightGrams: 750,
    stock: 100,
    trackStock: true,
    allowBackorder: false,
    minQuantity: 1,
    maxQuantity: null,
    ...overrides,
  };
}

export function sample(overrides: Partial<EngineLine> = {}): EngineLine {
  return line({ productType: "sample", basePrice: 0, weightGrams: 30, stock: 500, maxQuantity: 1, productId: 90, categoryId: 4, ...overrides });
}

export function coupon(overrides: Partial<CouponData> = {}): CouponData {
  return {
    id: 1,
    code: "TEST",
    type: "percent",
    value: 10,
    minOrderTotal: 0,
    maxUses: null,
    usedCount: 0,
    perCustomerLimit: null,
    productIds: null,
    categoryIds: null,
    customerGroupIds: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    // Day 6: owner (null = anyone) and origin, as loadCoupon selects them.
    userId: null,
    source: "manual",
    ...overrides,
  };
}

export const BUSINESS: CustomerContext = {
  ...RETAIL_CUSTOMER,
  userId: "u1",
  groupId: 2,
  groupSlug: "kurumsal",
  groupDiscountPercent: 15,
  isBusiness: true,
  showPricesExVat: true,
  companyId: 7,
  companyApproved: true,
  allowDeferred: true,
  deferredDays: 30,
};

export function input(lines: EngineLine[], overrides: Partial<CartComputeInput> = {}): CartComputeInput {
  return { lines, customer: RETAIL_CUSTOMER, coupon: null, settings: settings(), now: NOW, ...overrides };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
