// Turns engine totals + loaded cart rows into the serializable, localized, pre-formatted CartView
// that the cart drawer, the /sepet page and the checkout summary render as-is (no price math on the
// client). Pure (no DB, no cookies): safe to import types from client components.
import type { LocalizedText } from "@/db/schema/common";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { localize } from "@/i18n/localize";
import { defaultMessages, type Messages } from "@/i18n/messages";
import { href, signInHref } from "@/i18n/paths";
import type { MediaLike } from "@/lib/media/types";
import { formatPrice } from "@/lib/pricing/money";
import { stockStatus, type StockStatus } from "@/components/store/format";
import { formatCountdown, formatPrizeExpiry, msUntil, type CountdownTexts } from "./countdown";
import type { LoadedCart } from "./load";
import { cartRevision } from "./totals";
import type {
  CartIssue,
  CartIssueCode,
  CartTotals,
  CouponInvalidReason,
  CouponSource,
  CouponType,
  MethodTotals,
  PaymentMethod,
  PaymentUnavailableReason,
  PricedLine,
} from "./types";

/** An amount in kuruş with its localized label (formatPrice). */
export type Money = { amount: number; label: string };

export type SummaryRowKey = "subtotal" | "coupon" | "bankTransfer" | "shipping" | "heavy" | "paymentFee" | "total" | "vat";

/** One row of a totals table, already labelled: render label + amountLabel. */
export type SummaryRow = {
  key: SummaryRowKey;
  label: string;
  amount: number;
  /** Discounts are formatted negative ("-29,98 ₺"); free shipping shows the "free" word. */
  amountLabel: string;
  kind: "default" | "discount" | "free" | "total" | "note";
};

export type IssueView = {
  code: CartIssueCode;
  lineId?: number;
  blocking: boolean;
  message: string;
};

export type CartLineView = {
  lineId: number;
  variantId: number;
  productId: number;
  productSlug: string;
  /** Product page link (samples link to their parent product when it exists by slug), or null. */
  href: string | null;
  name: string;
  subtitle: string | null;
  /** e.g. ["5 L Bidon"] */
  variantLabels: string[];
  /** variantLabels joined with " · " */
  variantLabel: string;
  sku: string;
  image: MediaLike | null;
  imageAlt: string;
  /** Product accent hex for productScopeStyle(), or null. */
  accentColor: string | null;
  isSample: boolean;
  /** Counted in totals. False when the line has a blocking issue or is an ignored sample. */
  included: boolean;
  quantity: number;
  requestedQuantity: number;
  minQuantity: number;
  /** Effective stepper maximum (limits and stock). */
  maxQuantity: number;
  canIncrease: boolean;
  canDecrease: boolean;
  stock: StockStatus;
  unitPrice: Money;
  compareAt: Money | null;
  /** unitPrice × quantity, before order-level discounts. */
  lineSubtotal: Money;
  /** This line's share of the order discounts (coupon + havale). */
  discount: Money;
  /** lineSubtotal − discount. */
  lineTotal: Money;
  /** "Kurumsal fiyat", "12+ adet indirimi (%10)", "İndirim", "Abone fiyatı" or null. */
  priceNote: string | null;
  /** Subscribe and save: the plan of this line (null = one-time purchase). */
  subscription: CartLineSubscriptionView | null;
  issues: IssueView[];
};

export type CartLineSubscriptionView = {
  planId: number;
  /** The plan's name, e.g. "Her ay". */
  name: string;
  percent: number;
  /** Which discount the unit price carries (a better campaign wins over the plan discount). */
  discount: "subscription" | "campaign" | "none";
  /** One line for the cart: "Abonelik · Her ay · %5 abone indirimi" / "… kampanya indirimi daha avantajlı". */
  note: string;
};

export type SampleOfferView = {
  variantId: number;
  productSlug: string;
  name: string;
  subtitle: string | null;
  accentColor: string | null;
  image: MediaLike | null;
  imageAlt: string;
  inCart: boolean;
  inStock: boolean;
  /** addSample would succeed now. */
  canAdd: boolean;
};

export type TotalsView = {
  subtotal: Money;
  couponDiscount: Money;
  bankTransferDiscount: Money;
  discountTotal: Money;
  shippingFlat: Money;
  shippingHeavy: Money;
  shippingTotal: Money;
  paymentFee: Money;
  vatTotal: Money;
  grandTotal: Money;
};

export type PaymentMethodView = {
  method: PaymentMethod;
  label: string;
  available: boolean;
  /** False for options the customer should not even see (card/havale/COD disabled in settings, deferred for non-eligible buyers). */
  visible: boolean;
  reason?: PaymentUnavailableReason;
  reasonMessage: string | null;
  /** Havale discount percent (0 otherwise). */
  discountPercent: number;
  /** SR-2, havale only: days the buyer has to pay (settings.payments.bankTransfer.paymentDays). */
  paymentDays?: number;
  totals: TotalsView;
  summary: SummaryRow[];
};

/**
 * Day 6: where the signed-in buyer's gift wheel prize stands in this cart.
 * - applied: the cart's code is the prize;
 * - ready: it would work now but is not on the cart (the buyer took it off): the cart offers to apply it;
 * - min_order: below the prize's minimum basket (applied automatically once the basket reaches it);
 * - other_code: the cart holds another code (never overwritten; removing that code applies the prize);
 * - no_benefit: it would not lower what the buyer pays now (e.g. free shipping on a cart that ships free);
 * - no_items: nothing to discount yet (empty cart, samples only).
 */
export type CartWheelPrizeStatus = "applied" | "ready" | "min_order" | "other_code" | "no_benefit" | "no_items";

/** buildCartView input: the prize as src/lib/cart/wheel-prize.ts (cartWheelPrize) found it. */
export type CartWheelPrizeInput = {
  code: string;
  /** The slice label from the spin snapshot; absent → a label built from type and value. */
  label?: LocalizedText;
  type: CouponType;
  value: number;
  minOrderTotal: number;
  /** coupons.ends_at: the countdown's real end. */
  endsAt: Date;
  status: CartWheelPrizeStatus;
};

/** The prize row of the cart drawer and the /sepet coupon box (localized, pre-formatted). */
export type CartWheelPrizeView = {
  code: string;
  /** "%10 indirim". */
  label: string;
  status: CartWheelPrizeStatus;
  /** Why it is (not) on the cart, or null when the row speaks for itself ("ready", an empty cart without a minimum). */
  message: string | null;
  /** ISO end of validity (the live countdown counts down to it). */
  endsAt: string;
  /** "Son kullanım: 15 Kasım 14:30" (Türkiye time). */
  expiresAt: string;
  /** The countdown when the view was built ("2g 03:14"): the server-rendered and first client value. */
  timeLeft: string;
  /** Templates the live countdown fills on the client (dictionary texts, panel overrides included). */
  text: {
    /** "Çark hediyeniz". */
    title: string;
    /** "Kalan süre: {time}". */
    timeLeft: string;
    /** "Çark hediyeniz · {time}" (drawer row). */
    drawer: string;
    countdown: CountdownTexts;
  };
};

/** Optional inputs of buildCartView that need the database or the clock (cart actions and getCartView pass them). */
export type CartViewExtras = {
  wheelPrize?: CartWheelPrizeInput | null;
  /** The clock the countdown fallback is computed with (default: now). */
  now?: Date;
};

export type CartView = {
  locale: Locale;
  /**
   * Fingerprint of the included lines (variant:quantity) and the applied coupon (cartRevision). The
   * checkout posts it back as expectedCart; it also tells the form that a newer cart arrived.
   */
  revision: string;
  isEmpty: boolean;
  /** Units incl. samples (header badge: publishCartCount(view.itemCount)). */
  itemCount: number;
  itemCountLabel: string;
  paidItemCount: number;
  lines: CartLineView[];
  availableSamples: SampleOfferView[];
  samples: {
    enabled: boolean;
    allowed: boolean;
    max: number;
    used: number;
    remaining: number;
    /** "Siparişinize en fazla 2 ücretsiz numune ekleyebilirsiniz." */
    hint: string | null;
    /** Why samples cannot be added right now, or null. */
    unavailableMessage: string | null;
  };
  coupon: {
    code: string;
    type: CouponType;
    status: "applied" | "invalid";
    reason?: CouponInvalidReason;
    message: string;
    discount: Money;
    /** Day 6: ISO expiry of the coupon (gift wheel prizes: the countdown's real end). */
    endsAt?: string;
    /** Day 6: "wheel" for a gift wheel prize. */
    source?: CouponSource;
  } | null;
  /** Day 6: the signed-in buyer's usable gift wheel prize (on this cart or kept for later), or null. */
  wheelPrize: CartWheelPrizeView | null;
  totals: TotalsView;
  shipping: {
    free: boolean;
    freeReason: "threshold" | "coupon" | null;
    heavyKg: number;
    /** null when free shipping is never offered (threshold 0). */
    threshold: Money | null;
    remainingForFree: Money;
    /** 0..1 progress toward free shipping, null without a threshold. */
    progress: number | null;
    /** "Ücretsiz kargo için 150,00 ₺ daha ekleyin." / "Kargonuz ücretsiz." / null */
    message: string | null;
  };
  /** Totals table rows for the current method (none chosen on the cart page). */
  summary: SummaryRow[];
  /** Every issue (line and cart level), localized. */
  issues: IssueView[];
  blockingIssues: IssueView[];
  checkoutAllowed: boolean;
  paymentMethod: PaymentMethod | null;
  paymentMethods: PaymentMethodView[];
  totalWeightGrams: number;
  /** deferredDays: the approved company's vade (B2B), shown next to "Vadeli ödeme"; null without deferred terms. */
  customer: { isBusiness: boolean; showPricesExVat: boolean; deferredDays: number | null };
  /** Subscribe and save: subscription lines, and where to sign in when the cart needs an account. */
  subscription: { lineCount: number; signInRequired: boolean; signInHref: string | null };
};

// ---------------------------------------------------------------------------------------------

export const PAYMENT_METHOD_LABEL_KEYS: Record<PaymentMethod, "card" | "bankTransfer" | "cashOnDelivery" | "deferred"> = {
  card: "card",
  bank_transfer: "bankTransfer",
  cash_on_delivery: "cashOnDelivery",
  deferred: "deferred",
};

/** Localized payment method name ("Kredi / banka kartı", …). */
export function paymentMethodLabel(method: PaymentMethod, messages: Messages): string {
  return messages.checkout[PAYMENT_METHOD_LABEL_KEYS[method]];
}

const money = (amount: number, locale: Locale): Money => ({ amount, label: formatPrice(amount, locale) });
const negative = (amount: number, locale: Locale) => formatPrice(-amount, locale);

/** Localized message for an issue. */
export function issueMessage(issue: Pick<CartIssue, "code" | "allowed" | "reason">, messages: Messages, locale: Locale, ctx: { sampleMinOrder?: number; sampleMax?: number } = {}): string {
  const m = messages.cart.issues;
  const vars = { count: issue.allowed ?? 0, amount: formatPrice(ctx.sampleMinOrder ?? 0, locale) };
  switch (issue.code) {
    case "quantity_adjusted":
      if (issue.reason === "stock") return format(m.quantity_adjusted_stock, vars, locale);
      if (issue.reason === "max") return format(m.quantity_adjusted_max, vars, locale);
      if (issue.reason === "min") return format(m.quantity_adjusted_min, vars, locale);
      return format(m.quantity_adjusted, vars, locale);
    case "sample_limit":
      return format(m.sample_limit, { count: ctx.sampleMax ?? 0 }, locale);
    case "sample_min_order":
      return format(m.sample_min_order, vars, locale);
    default:
      return m[issue.code];
  }
}

/** Localized message for a coupon refusal reason (cart.errors.coupon_*). */
export function couponReasonMessage(reason: CouponInvalidReason, messages: Messages, locale: Locale, minOrderTotal = 0): string {
  const key = `coupon_${reason}` as const;
  return format(messages.cart.errors[key], { amount: formatPrice(minOrderTotal, locale) }, locale);
}

/** Localized reason a payment method is unavailable. */
export function paymentReasonMessage(reason: PaymentUnavailableReason, messages: Messages, locale: Locale, codMaxOrderTotal = 0): string {
  return format(messages.checkout.paymentUnavailable[reason], { amount: formatPrice(codMaxOrderTotal, locale) }, locale);
}

function totalsView(t: MethodTotals, locale: Locale): TotalsView {
  return {
    subtotal: money(t.subtotal, locale),
    couponDiscount: money(t.discounts.coupon, locale),
    bankTransferDiscount: money(t.discounts.bankTransfer, locale),
    discountTotal: money(t.discountTotal, locale),
    shippingFlat: money(t.shipping.flat, locale),
    shippingHeavy: money(t.shipping.heavy, locale),
    shippingTotal: money(t.shipping.total, locale),
    paymentFee: money(t.paymentFee, locale),
    vatTotal: money(t.vatTotal, locale),
    grandTotal: money(t.grandTotal, locale),
  };
}

export type SummaryInput = {
  subtotal: number;
  couponDiscount: number;
  couponCode: string | null;
  bankTransferDiscount: number;
  bankTransferPercent: number;
  shippingFlat: number;
  shippingHeavy: number;
  heavyKg: number;
  freeShipping: boolean;
  /** The free_shipping coupon that made shipping free (named in the shipping row), else null. */
  freeShippingCoupon?: string | null;
  /** False for an empty cart: no shipping row. */
  hasShipment: boolean;
  paymentFee: number;
  vatTotal: number;
  grandTotal: number;
};

/** Totals table rows, shared by the cart, checkout, order page and legal texts. */
export function summaryRows(s: SummaryInput, locale: Locale, messages: Messages): SummaryRow[] {
  const m = messages.cart.summary;
  const rows: SummaryRow[] = [
    { key: "subtotal", label: m.subtotal, amount: s.subtotal, amountLabel: formatPrice(s.subtotal, locale), kind: "default" },
  ];
  if (s.couponDiscount > 0) {
    rows.push({
      key: "coupon",
      label: format(m.couponDiscount, { code: s.couponCode ?? "" }, locale),
      amount: -s.couponDiscount,
      amountLabel: negative(s.couponDiscount, locale),
      kind: "discount",
    });
  }
  if (s.bankTransferDiscount > 0) {
    rows.push({
      key: "bankTransfer",
      label: format(m.bankTransferDiscount, { percent: s.bankTransferPercent }, locale),
      amount: -s.bankTransferDiscount,
      amountLabel: negative(s.bankTransferDiscount, locale),
      kind: "discount",
    });
  }
  if (s.hasShipment) {
    // With a heavy-parcel surcharge the flat part is "standard shipping": never call the whole
    // shipping free while a shipping surcharge is charged in the next row.
    const base = s.shippingHeavy > 0 ? m.shippingStandard : m.shipping;
    const label = s.freeShipping && s.freeShippingCoupon ? format(m.shippingCoupon, { label: base, code: s.freeShippingCoupon }, locale) : base;
    rows.push(
      s.freeShipping
        ? { key: "shipping", label, amount: 0, amountLabel: m.shippingFree, kind: "free" }
        : { key: "shipping", label, amount: s.shippingFlat, amountLabel: formatPrice(s.shippingFlat, locale), kind: "default" },
    );
  }
  if (s.shippingHeavy > 0) {
    rows.push({
      key: "heavy",
      label: format(m.heavySurcharge, { kg: s.heavyKg }, locale),
      amount: s.shippingHeavy,
      amountLabel: formatPrice(s.shippingHeavy, locale),
      kind: "default",
    });
  }
  if (s.paymentFee > 0) {
    rows.push({ key: "paymentFee", label: m.paymentFee, amount: s.paymentFee, amountLabel: formatPrice(s.paymentFee, locale), kind: "default" });
  }
  rows.push({ key: "total", label: m.total, amount: s.grandTotal, amountLabel: formatPrice(s.grandTotal, locale), kind: "total" });
  rows.push({ key: "vat", label: m.vat, amount: s.vatTotal, amountLabel: formatPrice(s.vatTotal, locale), kind: "note" });
  return rows;
}

function summaryFor(t: MethodTotals, couponCode: string | null, bankPercent: number, hasShipment: boolean, locale: Locale, messages: Messages) {
  return summaryRows(
    {
      subtotal: t.subtotal,
      couponDiscount: t.discounts.coupon,
      couponCode,
      bankTransferDiscount: t.discounts.bankTransfer,
      bankTransferPercent: bankPercent,
      shippingFlat: t.shipping.flat,
      shippingHeavy: t.shipping.heavy,
      heavyKg: t.shipping.heavyKg,
      freeShipping: t.shipping.free,
      freeShippingCoupon: t.shipping.freeReason === "coupon" ? couponCode : null,
      hasShipment,
      paymentFee: t.paymentFee,
      vatTotal: t.vatTotal,
      grandTotal: t.grandTotal,
    },
    locale,
    messages,
  );
}

function priceNote(line: PricedLine, messages: Messages, locale: Locale): string | null {
  const rules = line.appliedRules;
  if (rules.some((r) => r.kind === "group_price" || r.kind === "group_discount")) return messages.product.businessPrice;
  const tier = rules.find((r) => r.kind === "tier");
  if (tier && tier.kind === "tier") return format(messages.cart.tierDiscount, { quantity: tier.minQuantity, percent: tier.percent }, locale);
  if (rules.some((r) => r.kind === "subscription")) return messages.subscriptions.cart.priceNote;
  if (rules.some((r) => r.kind === "campaign")) return messages.product.sale;
  return null;
}

/** The cart's one-line description of a subscription line. */
export function subscriptionLineNote(
  sub: { name: string; percent: number; discount: "subscription" | "campaign" | "none"; campaignPercent: number },
  messages: Messages,
  locale: Locale,
): string {
  const m = messages.subscriptions.cart;
  if (sub.discount === "subscription") return format(m.lineSaving, { plan: sub.name, percent: sub.percent }, locale);
  if (sub.discount === "campaign") return format(m.lineCampaignWins, { plan: sub.name, percent: sub.campaignPercent, planPercent: sub.percent }, locale);
  return format(m.line, { plan: sub.name }, locale);
}

/** A prize label for a coupon without a spin snapshot: "%10 indirim", "50,00 ₺ indirim", "Ücretsiz kargo". */
export function wheelPrizeFallbackLabel(prize: Pick<CartWheelPrizeInput, "type" | "value">, messages: Messages, locale: Locale): string {
  const m = messages.wheel.prize;
  if (prize.type === "percent") return format(m.percent, { value: prize.value }, locale);
  if (prize.type === "fixed") return format(m.fixed, { amount: formatPrice(prize.value, locale) }, locale);
  return m.freeShipping;
}

/** Localizes the cart's gift wheel prize (pure; `now` only feeds the first countdown value). */
export function buildWheelPrizeView(prize: CartWheelPrizeInput, locale: Locale, messages: Messages, now: Date): CartWheelPrizeView {
  const m = messages.wheel.cart;
  // The prize-name rule of the whole wheel: the label in this language (Turkish readers: the Turkish one),
  // else the generated name ("10% off"), never Turkish text on /en or /ar.
  const own = (prize.label?.[locale] ?? "").trim() || (locale === "tr" ? (prize.label?.tr ?? "").trim() : "");
  const label = own || wheelPrizeFallbackLabel(prize, messages, locale);
  const amount = formatPrice(prize.minOrderTotal, locale);
  const endsAt = prize.endsAt.toISOString();
  const countdown: CountdownTexts = { days: messages.wheel.countdown.days, expired: messages.wheel.countdown.expired };
  const message = ((): string | null => {
    switch (prize.status) {
      case "applied":
        return m.applied;
      case "min_order":
        return format(m.waitingMinOrder, { prize: label, amount }, locale);
      case "other_code":
        return m.waitingOtherCode;
      case "no_benefit":
        return format(m.waitingNoBenefit, { prize: label }, locale);
      case "no_items":
        return prize.minOrderTotal > 0 ? format(m.waitingMinOrder, { prize: label, amount }, locale) : null;
      case "ready":
        return null;
    }
  })();
  return {
    code: prize.code,
    label,
    status: prize.status,
    message,
    endsAt,
    expiresAt: format(m.expiresAt, { date: formatPrizeExpiry(endsAt, locale) }, locale),
    timeLeft: formatCountdown(msUntil(endsAt, now.getTime()), countdown, locale),
    text: { title: m.title, timeLeft: m.timeLeft, drawer: m.drawer, countdown },
  };
}

/**
 * Builds the CartView. `messages` should come from getMessages(locale) (panel overrides); without it
 * the built-in dictionary is used. `extras.wheelPrize` comes from cartWheelPrize (wheel-prize.ts); a
 * caller without it gets `wheelPrize: null`.
 */
export function buildCartView(
  totals: CartTotals,
  raw: LoadedCart,
  locale: Locale,
  messages: Messages = defaultMessages[locale],
  extras: CartViewExtras = {},
): CartView {
  const byLine = new Map(raw.lines.map((l) => [l.lineId, l]));
  const sampleCtx = { sampleMinOrder: totals.samples.minOrderTotal, sampleMax: totals.samples.max };
  const issueView = (i: CartIssue): IssueView => ({
    code: i.code,
    ...(i.lineId != null ? { lineId: i.lineId } : {}),
    blocking: i.blocking,
    message: issueMessage(i, messages, locale, sampleCtx),
  });

  const lines: CartLineView[] = totals.lines.flatMap((line) => {
    const loaded = byLine.get(line.lineId);
    if (!loaded) return [];
    const d = loaded.display;
    const name = localize(d.name, locale);
    const variantLabels = d.variantLabels.map((l) => localize(l, locale)).filter(Boolean);
    const parentSlug = line.isSample ? d.productSlug.replace(/-numune$/, "") : d.productSlug;
    return [
      {
        lineId: line.lineId,
        variantId: line.variantId,
        productId: line.productId,
        productSlug: d.productSlug,
        href: line.isSample && parentSlug === d.productSlug ? null : href(locale, "product", { slug: parentSlug }),
        name,
        subtitle: localize(d.subtitle, locale) || null,
        variantLabels,
        variantLabel: variantLabels.join(" · "),
        sku: d.sku,
        image: d.image,
        imageAlt: localize(d.image?.alt, locale) || [name, ...variantLabels].join(" — "),
        accentColor: d.accentColor,
        isSample: line.isSample,
        included: line.included,
        quantity: line.quantity,
        requestedQuantity: line.requestedQuantity,
        minQuantity: line.minQuantity,
        maxQuantity: line.maxQuantity,
        canIncrease: line.included && !line.isSample && line.quantity < line.maxQuantity,
        canDecrease: line.included && !line.isSample && line.quantity > line.minQuantity,
        stock: stockStatus({ stock: line.availableStock ?? loaded.stock, trackStock: loaded.trackStock, allowBackorder: loaded.allowBackorder, lowStockThreshold: d.lowStockThreshold }),
        unitPrice: money(line.unitPrice, locale),
        compareAt: line.compareAt != null ? money(line.compareAt, locale) : null,
        lineSubtotal: money(line.included ? line.lineSubtotal : line.unitPrice * line.quantity, locale),
        discount: money(line.discount, locale),
        lineTotal: money(line.included ? line.lineTotal : line.unitPrice * line.quantity, locale),
        priceNote: line.isSample ? messages.cart.sampleLabel : priceNote(line, messages, locale),
        subscription: line.subscription
          ? (() => {
              const name = localize(loaded.subscriptionPlan?.name, locale) || String(line.subscription.planId);
              return {
                planId: line.subscription.planId,
                name,
                percent: line.subscription.percent,
                discount: line.subscription.discount,
                note: subscriptionLineNote({ ...line.subscription, name }, messages, locale),
              };
            })()
          : null,
        issues: line.issues.map(issueView),
      },
    ];
  });

  const inCart = new Set(totals.lines.map((l) => l.variantId));
  const samplesRoom = totals.samples.allowed && totals.samples.used < totals.samples.max;
  const availableSamples: SampleOfferView[] = totals.samples.enabled
    ? raw.sampleOffers.map((o) => {
        const name = localize(o.name, locale);
        return {
          variantId: o.variantId,
          productSlug: o.productSlug,
          name,
          subtitle: localize(o.subtitle, locale) || null,
          accentColor: o.accentColor,
          image: o.image,
          imageAlt: localize(o.image?.alt, locale) || name,
          inCart: inCart.has(o.variantId),
          inStock: o.inStock,
          canAdd: samplesRoom && o.inStock && !inCart.has(o.variantId),
        };
      })
    : [];

  const s = totals.samples;
  const samplesUnavailable = s.reason
    ? format(messages.cart.samplesUnavailable[s.reason], { amount: formatPrice(s.minOrderTotal, locale) }, locale)
    : s.used >= s.max && s.max > 0
      ? format(messages.cart.errors.sample_limit, { count: s.max }, locale)
      : null;

  const coupon = totals.coupon
    ? {
        code: totals.coupon.code,
        type: totals.coupon.type,
        status: totals.coupon.status,
        ...(totals.coupon.reason ? { reason: totals.coupon.reason } : {}),
        message:
          totals.coupon.status === "applied"
            ? messages.cart.couponApplied
            : couponReasonMessage(totals.coupon.reason ?? "inactive", messages, locale, totals.coupon.minOrderTotal),
        discount: money(totals.coupon.discount, locale),
        ...(totals.coupon.endsAt ? { endsAt: totals.coupon.endsAt } : {}),
        ...(totals.coupon.source ? { source: totals.coupon.source } : {}),
      }
    : null;

  const sh = totals.shipping;
  const hasShipment = totals.lines.some((l) => l.included);
  const merchandise = totals.subtotal - totals.discounts.coupon;
  const shipping: CartView["shipping"] = {
    free: sh.free,
    freeReason: sh.freeReason,
    heavyKg: sh.heavyKg,
    threshold: sh.threshold > 0 ? money(sh.threshold, locale) : null,
    remainingForFree: money(sh.remainingForFree, locale),
    progress: sh.threshold > 0 ? (sh.free ? 1 : Math.min(1, Math.max(0, merchandise / sh.threshold))) : null,
    message: !hasShipment
      ? null
      : sh.free
        ? sh.heavy > 0
          ? messages.cart.freeShippingReachedHeavy
          : messages.cart.freeShippingReached
        : sh.threshold > 0
          ? format(messages.cart.freeShippingProgress, { amount: formatPrice(sh.remainingForFree, locale) }, locale)
          : null,
  };

  const issues = totals.issues.map(issueView);
  return {
    locale,
    revision: cartRevision(totals),
    isEmpty: totals.lines.length === 0,
    itemCount: totals.itemCount,
    itemCountLabel: format(messages.cart.itemCount, { count: totals.itemCount }, locale),
    paidItemCount: totals.paidItemCount,
    lines,
    availableSamples,
    samples: {
      enabled: s.enabled,
      allowed: s.allowed,
      max: s.max,
      used: s.used,
      remaining: Math.max(0, s.max - s.used),
      hint: s.enabled && s.max > 0 ? format(messages.cart.samplesHint, { count: s.max }, locale) : null,
      unavailableMessage: s.enabled ? samplesUnavailable : null,
    },
    coupon,
    wheelPrize: extras.wheelPrize ? buildWheelPrizeView(extras.wheelPrize, locale, messages, extras.now ?? new Date()) : null,
    totals: totalsView(totals, locale),
    shipping,
    summary: summaryFor(totals, totals.coupon?.status === "applied" ? totals.coupon.code : null, 0, hasShipment, locale, messages),
    issues,
    blockingIssues: issues.filter((i) => i.blocking),
    checkoutAllowed: totals.checkoutAllowed,
    paymentMethod: totals.paymentMethod,
    paymentMethods: totals.paymentMethods.map((pm) => {
      // Hidden: methods switched off, deferred for buyers without terms, and havale while no bank
      // account is set up (a store configuration gap, not something to show shoppers).
      const visible = pm.reason !== "disabled" && pm.reason !== "no_bank_account" && !(pm.method === "deferred" && pm.reason === "not_eligible");
      return {
        method: pm.method,
        label: paymentMethodLabel(pm.method, messages),
        available: pm.available,
        visible,
        ...(pm.reason ? { reason: pm.reason } : {}),
        reasonMessage: pm.reason ? paymentReasonMessage(pm.reason, messages, locale, pm.limit ?? 0) : null,
        discountPercent: pm.discountPercent,
        ...(pm.paymentDays ? { paymentDays: pm.paymentDays } : {}),
        totals: totalsView(pm.totals, locale),
        summary: summaryFor(pm.totals, totals.coupon?.status === "applied" ? totals.coupon.code : null, pm.discountPercent, hasShipment, locale, messages),
      };
    }),
    totalWeightGrams: totals.totalWeightGrams,
    customer: {
      isBusiness: raw.customer.isBusiness,
      showPricesExVat: raw.customer.showPricesExVat,
      deferredDays: raw.customer.allowDeferred ? raw.customer.deferredDays : null,
    },
    subscription: {
      lineCount: totals.subscription.lineCount,
      signInRequired: totals.subscription.signInRequired,
      signInHref: totals.subscription.lineCount > 0 ? signInHref(locale, href(locale, "cart")) : null,
    },
  };
}
