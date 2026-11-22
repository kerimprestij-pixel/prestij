// Order e-mails (NOTIFY): one template per order event, all sharing the same order summary (lines with
// images, the totals exactly as the order page shows them, delivery and billing details, a "view
// order" button). The data is built by src/lib/notifications/order-emails.ts from the stored order;
// texts live in messages.email.orders (panel: Arayüz Metinleri) and the subject/intro overrides in
// settings.emails.templates (panel: Ayarlar → E-posta).
import type { AddressData, PaymentMethod } from "@/db/schema/commerce";
import type { LocalizedText } from "@/i18n/locales";
import { localize } from "@/i18n/localize";
import { addressLines, formatPhone } from "@/components/order/format";
import { summaryRows } from "@/lib/cart/view";
import { defineEmailTemplate } from "../registry";
import type { EmailBlock, EmailBuildContext, EmailOrderLine, EmailPlaceholderValues, EmailTotalsRow } from "../types";

export type OrderEmailLine = {
  name: LocalizedText;
  /** Product subtitle + variant, e.g. "Sıvı El Sabunu · 500 ml". */
  detail: LocalizedText | null;
  quantity: number;
  unitPrice: number;
  /** unitPrice × quantity (the order page's line amount; discounts are in the totals). */
  lineSubtotal: number;
  isSample: boolean;
  /** Absolute (or site-relative) JPEG/PNG/WebP URL, never AVIF. */
  imageUrl: string | null;
  accent: string | null;
};

/** The numbers of the order page's totals table (same rules: summaryRows). */
export type OrderEmailTotals = {
  subtotal: number;
  couponCode: string | null;
  couponDiscount: number;
  bankTransferDiscount: number;
  bankTransferPercent: number;
  shippingFlat: number;
  shippingHeavy: number;
  heavyKg: number;
  freeShipping: boolean;
  freeShippingReason: "threshold" | "coupon" | null;
  paymentFee: number;
  vatTotal: number;
  grandTotal: number;
};

export type OrderEmailData = {
  /** Greeting name (first name of the delivery address). */
  name: string;
  /** Full name on the delivery address (admin mails). */
  fullName: string;
  orderNumber: string;
  /** Absolute token link of the order page (works without signing in). */
  orderUrl: string;
  /** ISO time the order was placed. */
  placedAt: string;
  paymentMethod: PaymentMethod;
  email: string;
  phone: string | null;
  lines: OrderEmailLine[];
  totals: OrderEmailTotals;
  shippingAddress: AddressData;
  invoice: {
    type: "individual" | "corporate";
    /** Company name or the individual's name. */
    name: string;
    taxOffice: string | null;
    /** TCKN / VKN with all but the last two digits masked (customer mails). */
    maskedId: string | null;
    eInvoice: boolean;
    /** Separate billing address, or null when it is the delivery address. */
    address: AddressData | null;
  };
  /** Deferred ("vadeli") orders: the company's payment term in days, when set. */
  deferredDays: number | null;
  /** Havale orders: accounts, panel instructions and the pay-by date (ISO). */
  bankTransfer: { accounts: { bank: string; holder: string; iban: string }[]; instructions: LocalizedText | null; deadline: string } | null;
  /** Shipped orders: carrier name, tracking number and the carrier's tracking link. */
  carrier: { name: string; trackingNumber: string; trackingUrl: string | null } | null;
  /** settings.shipping.estimatedDays (business days). */
  estimatedDays: { min: number; max: number } | null;
  /** Money was received (cancellation mails add the refund note). */
  paid: boolean;
  /** Admin mails only. */
  admin?: {
    panelUrl: string;
    companyName: string | null;
    isMember: boolean;
    customerNote: string | null;
    /** Full TCKN / VKN (the shop needs it for the invoice). */
    taxId: string | null;
    /** Go-live CF-11: paid in test mode or by the local simulator (no money moved). Omitted = false. */
    testPayment?: boolean;
  };
};

declare module "../types" {
  interface EmailTemplateRegistry {
    order_received: OrderEmailData;
    order_awaiting_transfer: OrderEmailData;
    order_paid: OrderEmailData;
    order_payment_failed: OrderEmailData;
    order_shipped: OrderEmailData;
    order_delivered: OrderEmailData;
    order_cancelled: OrderEmailData;
    order_refunded: OrderEmailData;
    admin_new_order: OrderEmailData;
  }
}

// ---------------------------------------------------------------------------------------------
// Sample data (panel preview and test sends): a realistic order with images from public/media.

const SAMPLE_IMAGE = {
  lavantaLatte: "/media/urunler/lavanta_latte/PRESTIJ_Lavanta_Latte_Pompali_studyo_fasetli_cam-480.webp",
  portakal: "/media/urunler/portakal/PRESTIJ_Portakal_5L_amber_gunisigi_studyo-480.webp",
};

export function sampleOrderEmailData(overrides: Partial<OrderEmailData> = {}): OrderEmailData {
  const placedAt = new Date("2026-11-10T09:24:00Z").toISOString();
  const address: AddressData = {
    fullName: "Ayşe Yılmaz",
    phone: "+905321234567",
    city: "Kayseri",
    district: "Talas",
    neighbourhood: "Mevlana Mah.",
    line1: "Gül Sok. No:12 D:4",
    postalCode: "38280",
  };
  return {
    name: "Ayşe",
    fullName: "Ayşe Yılmaz",
    orderNumber: "PR-261001",
    orderUrl: "/tr/siparis/PR-261001?t=ornek",
    placedAt,
    paymentMethod: "card",
    email: "ayse@example.com",
    phone: "+905321234567",
    lines: [
      {
        name: { tr: "Lavanta Latte", en: "Lavender Latte", ar: "لافندر لاتيه" },
        detail: { tr: "Sıvı El Sabunu · 500 ml", en: "Liquid Hand Soap · 500 ml", ar: "صابون يدين سائل · 500 مل" },
        quantity: 2,
        unitPrice: 14990,
        lineSubtotal: 29980,
        isSample: false,
        imageUrl: SAMPLE_IMAGE.lavantaLatte,
        accent: "#C2ADD1",
      },
      {
        name: { tr: "Portakal", en: "Orange", ar: "برتقال" },
        detail: { tr: "Sıvı El Sabunu · 5 L", en: "Liquid Hand Soap · 5 L", ar: "صابون يدين سائل · 5 لتر" },
        quantity: 1,
        unitPrice: 44990,
        lineSubtotal: 44990,
        isSample: false,
        imageUrl: SAMPLE_IMAGE.portakal,
        accent: "#E9952E",
      },
      {
        name: { tr: "Okyanus", en: "Ocean", ar: "أوكيانوس" },
        detail: { tr: "Duş Jeli · Numune", en: "Shower Gel · Sample", ar: "جل استحمام · عيّنة" },
        quantity: 1,
        unitPrice: 0,
        lineSubtotal: 0,
        isSample: true,
        imageUrl: null,
        accent: "#329BC0",
      },
    ],
    totals: {
      subtotal: 74970,
      couponCode: null,
      couponDiscount: 0,
      bankTransferDiscount: 0,
      bankTransferPercent: 0,
      shippingFlat: 9990,
      shippingHeavy: 0,
      heavyKg: 0,
      freeShipping: false,
      freeShippingReason: null,
      paymentFee: 0,
      vatTotal: 14160,
      grandTotal: 84960,
    },
    shippingAddress: address,
    invoice: { type: "individual", name: "Ayşe Yılmaz", taxOffice: null, maskedId: null, eInvoice: false, address: null },
    deferredDays: null,
    bankTransfer: null,
    carrier: null,
    estimatedDays: { min: 1, max: 3 },
    paid: true,
    ...overrides,
  };
}

const sampleBank = (): OrderEmailData["bankTransfer"] => ({
  accounts: [{ bank: "Örnek Bankası", holder: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.", iban: "TR330006100519786457841326" }],
  instructions: { tr: "Açıklama kısmına sipariş numaranızı yazmayı unutmayın." },
  deadline: new Date("2026-11-13T20:59:00Z").toISOString(),
});

// ---------------------------------------------------------------------------------------------
// Shared pieces

type Ctx = EmailBuildContext;
type OrderMessages = Ctx["messages"]["email"]["orders"];

const om = (ctx: Ctx): OrderMessages => ctx.messages.email.orders;

/** Placeholder values every order template can use (subject, intro and body copy). */
function orderVariables(data: OrderEmailData, ctx: Ctx): EmailPlaceholderValues {
  const m = om(ctx);
  return {
    name: data.name || data.fullName,
    orderNumber: data.orderNumber,
    amount: ctx.formatPrice(data.totals.grandTotal),
    fee: ctx.formatPrice(data.totals.paymentFee),
    phone: ctx.settings.general.phone,
    method: m.methods[data.paymentMethod] ?? data.paymentMethod,
    customer: data.fullName,
    days: data.deferredDays ?? "",
    deadline: data.bankTransfer ? ctx.formatDate(data.bankTransfer.deadline, { time: false }) : "",
    carrier: data.carrier?.name ?? "",
    trackingNumber: data.carrier?.trackingNumber ?? "",
    min: data.estimatedDays?.min ?? "",
    max: data.estimatedDays?.max ?? "",
  };
}

function emailLines(data: OrderEmailData, ctx: Ctx): EmailOrderLine[] {
  const m = om(ctx);
  return data.lines.map((line) => ({
    name: localize(line.name, ctx.locale),
    detail: line.detail ? localize(line.detail, ctx.locale) || null : null,
    quantity: line.quantity,
    unitPrice: line.isSample ? null : ctx.formatPrice(line.unitPrice),
    total: line.isSample && line.lineSubtotal === 0 ? m.free : ctx.formatPrice(line.lineSubtotal),
    imageUrl: line.imageUrl,
    accent: line.accent,
    badge: line.isSample ? m.sample : null,
  }));
}

/** The order page's totals table, row for row (labels from cart.summary, the same rounding). */
function totalsRows(data: OrderEmailData, ctx: Ctx): EmailTotalsRow[] {
  const t = data.totals;
  const rows = summaryRows(
    {
      subtotal: t.subtotal,
      couponDiscount: t.couponDiscount,
      couponCode: t.couponCode,
      bankTransferDiscount: t.bankTransferDiscount,
      bankTransferPercent: t.bankTransferPercent,
      shippingFlat: t.shippingFlat,
      shippingHeavy: t.shippingHeavy,
      heavyKg: t.heavyKg,
      freeShipping: t.freeShipping,
      freeShippingCoupon: t.freeShippingReason === "coupon" ? t.couponCode : null,
      hasShipment: true,
      paymentFee: t.paymentFee,
      vatTotal: t.vatTotal,
      grandTotal: t.grandTotal,
    },
    ctx.locale,
    ctx.messages,
  );
  return rows.map((r) => ({
    label: r.label,
    value: r.amountLabel,
    kind: r.kind === "free" ? "default" : r.kind,
  }));
}

function addressText(a: AddressData, withPhone: boolean): string {
  const phone = withPhone && a.phone ? formatPhone(a.phone) : "";
  return [a.fullName, ...addressLines(a), phone].filter(Boolean).join("\n");
}

function invoiceText(data: OrderEmailData, ctx: Ctx, admin: boolean): string {
  const m = om(ctx);
  const inv = data.invoice;
  const corporate = inv.type === "corporate";
  const id = admin ? (data.admin?.taxId ?? null) : inv.maskedId;
  const lines = [
    inv.name,
    corporate ? m.invoiceCorporate : m.invoiceIndividual,
    corporate && inv.taxOffice ? `${m.taxOffice}: ${inv.taxOffice}` : null,
    id ? `${corporate ? m.taxNumber : m.nationalId}: ${id}` : null,
    corporate && inv.eInvoice ? m.eInvoice : null,
    inv.address ? addressText(inv.address, false) : m.sameAsDelivery,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Lines, totals, details and addresses: the part every order e-mail shares. */
function orderSummaryBlocks(data: OrderEmailData, ctx: Ctx, options: { admin?: boolean } = {}): EmailBlock[] {
  const m = om(ctx);
  const details: { label: string; value: string }[] = [
    { label: m.orderNumber, value: data.orderNumber },
    { label: m.orderDate, value: ctx.formatDate(data.placedAt) },
    { label: m.paymentMethod, value: m.methods[data.paymentMethod] ?? data.paymentMethod },
  ];
  return [
    { type: "orderLines", title: m.itemsTitle, lines: emailLines(data, ctx) },
    { type: "totals", rows: totalsRows(data, ctx) },
    { type: "keyValue", title: m.detailsTitle, rows: details },
    {
      type: "keyValue",
      rows: [
        { label: m.delivery, value: addressText(data.shippingAddress, true) },
        { label: m.invoice, value: invoiceText(data, ctx, Boolean(options.admin)) },
      ],
    },
  ];
}

function viewOrderButton(data: OrderEmailData, ctx: Ctx, variant: "primary" | "secondary" = "primary"): EmailBlock {
  return { type: "button", label: om(ctx).viewOrder, url: data.orderUrl, variant };
}

const helpBlock = (ctx: Ctx): EmailBlock => ({ type: "paragraph", text: om(ctx).help, tone: "muted", size: "sm" });

/** Kapıda ödeme / vadeli: what the customer pays and when. */
function methodNotice(data: OrderEmailData, ctx: Ctx): EmailBlock[] {
  const m = om(ctx).received;
  if (data.paymentMethod === "cash_on_delivery") {
    const text = data.totals.paymentFee > 0 ? `${m.codText} ${m.codFee}` : m.codText;
    return [{ type: "notice", title: m.codTitle, text, tone: "info" }];
  }
  if (data.paymentMethod === "deferred") {
    return [{ type: "notice", title: m.deferredTitle, text: data.deferredDays ? m.deferredText : m.deferredTextNoDays, tone: "info" }];
  }
  return [];
}

const ORDER_PLACEHOLDERS = ["name", "orderNumber", "amount"] as const;

// ---------------------------------------------------------------------------------------------
// Templates

export const orderReceivedEmail = defineEmailTemplate({
  key: "order_received",
  audience: "customer",
  label: "Sipariş alındı",
  description: "Kapıda ödemeli ve vadeli siparişler verildiğinde müşteriye gönderilir (ödeme ve teslimat bilgileriyle).",
  placeholders: ORDER_PLACEHOLDERS,
  sample: () => sampleOrderEmailData({ paymentMethod: "cash_on_delivery", paid: false, totals: { ...sampleOrderEmailData().totals, paymentFee: 4990, grandTotal: 89950 } }),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).received;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        ...methodNotice(data, ctx),
        viewOrderButton(data, ctx),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderAwaitingTransferEmail = defineEmailTemplate({
  key: "order_awaiting_transfer",
  audience: "customer",
  label: "Havale/EFT bilgileri",
  description: "Havale/EFT ile verilen siparişlerde banka hesapları, tutar, açıklama ve son ödeme tarihiyle gönderilir.",
  placeholders: [...ORDER_PLACEHOLDERS, "deadline"],
  sample: () => sampleOrderEmailData({ paymentMethod: "bank_transfer", paid: false, bankTransfer: sampleBank() }),
  variables: orderVariables,
  build: (data, ctx) => {
    const orders = om(ctx);
    const m = orders.awaitingTransfer;
    const bank = data.bankTransfer;
    const instructions = bank?.instructions ? localize(bank.instructions, ctx.locale) : "";
    const accounts: EmailBlock[] =
      bank && bank.accounts.length > 0
        ? [
            {
              type: "bankAccounts",
              title: m.accountsTitle,
              accounts: bank.accounts,
              reference: { label: m.reference, value: data.orderNumber },
              note: m.note,
              labels: { holder: m.holder, iban: m.iban },
            },
          ]
        : [{ type: "notice", text: m.noAccounts, tone: "warning" }];
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        {
          type: "keyValue",
          rows: [
            { label: m.amount, value: ctx.formatPrice(data.totals.grandTotal) },
            ...(bank ? [{ label: m.deadline, value: ctx.formatDate(bank.deadline, { time: false }) }] : []),
          ],
        },
        ...accounts,
        // Panel text (Ayarlar → Ödeme → havale açıklaması): admin-authored, shown as written.
        ...(instructions ? [{ type: "notice" as const, text: instructions, tone: "info" as const }] : []),
        { type: "paragraph", text: m.next, tone: "muted", size: "sm" },
        viewOrderButton(data, ctx, "secondary"),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderPaidEmail = defineEmailTemplate({
  key: "order_paid",
  audience: "customer",
  label: "Ödeme alındı / sipariş onaylandı",
  description: "Kart ödemesi başarılı olduğunda veya havale/EFT ödemesi panelde onaylandığında gönderilir.",
  placeholders: ORDER_PLACEHOLDERS,
  sample: () => sampleOrderEmailData(),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).paid;
    const methodLine = data.paymentMethod === "card" ? m.card : data.paymentMethod === "bank_transfer" ? m.bankTransfer : null;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        ...(methodLine ? [{ type: "notice" as const, text: methodLine, tone: "success" as const }] : []),
        { type: "paragraph", text: m.next, tone: "muted", size: "sm" },
        viewOrderButton(data, ctx),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderPaymentFailedEmail = defineEmailTemplate({
  key: "order_payment_failed",
  audience: "customer",
  label: "Ödeme tamamlanamadı",
  description: "Kart ödemesi onaylanmadığında, siparişi tamamlama bağlantısıyla bir kez gönderilir.",
  placeholders: ORDER_PLACEHOLDERS,
  sample: () => sampleOrderEmailData({ paid: false }),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).paymentFailed;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "button", label: m.button, url: data.orderUrl },
        { type: "paragraph", text: m.reasons, tone: "muted", size: "sm" },
        { type: "notice", text: m.note, tone: "warning" },
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderShippedEmail = defineEmailTemplate({
  key: "order_shipped",
  audience: "customer",
  label: "Kargoya verildi",
  description: "Sipariş kargoya verildiğinde kargo firması, takip numarası ve takip bağlantısıyla gönderilir.",
  placeholders: [...ORDER_PLACEHOLDERS, "carrier", "trackingNumber"],
  sample: () =>
    sampleOrderEmailData({
      carrier: {
        name: "Yurtiçi Kargo",
        trackingNumber: "YK123456789",
        trackingUrl: "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=YK123456789",
      },
    }),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).shipped;
    const rows = data.carrier
      ? [
          { label: m.carrier, value: data.carrier.name },
          { label: m.trackingNumber, value: data.carrier.trackingNumber },
          ...(data.estimatedDays ? [{ label: m.estimate, value: ctx.format(m.estimateValue, { min: data.estimatedDays.min, max: data.estimatedDays.max }) }] : []),
        ]
      : [];
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        ...(rows.length ? [{ type: "keyValue" as const, rows }] : []),
        ...(data.carrier?.trackingUrl
          ? [
              { type: "button" as const, label: m.track, url: data.carrier.trackingUrl },
              { type: "paragraph" as const, text: m.trackHint, tone: "muted" as const, size: "sm" as const },
              viewOrderButton(data, ctx, "secondary"),
            ]
          : [viewOrderButton(data, ctx)]),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderDeliveredEmail = defineEmailTemplate({
  key: "order_delivered",
  audience: "customer",
  label: "Teslim edildi",
  description: "Sipariş teslim edildi olarak işaretlendiğinde gönderilir.",
  placeholders: ORDER_PLACEHOLDERS,
  sample: () => sampleOrderEmailData(),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).delivered;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "paragraph", text: m.care },
        viewOrderButton(data, ctx),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderCancelledEmail = defineEmailTemplate({
  key: "order_cancelled",
  audience: "customer",
  label: "Sipariş iptal edildi",
  description: "Sipariş iptal edildiğinde gönderilir; ödeme alınmışsa iade bilgisini de içerir.",
  placeholders: ORDER_PLACEHOLDERS,
  sample: () => sampleOrderEmailData(),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).cancelled;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        data.paid ? { type: "notice", text: m.refundNote, tone: "info" } : { type: "notice", text: m.noCharge, tone: "info" },
        { type: "paragraph", text: m.question, tone: "muted", size: "sm" },
        viewOrderButton(data, ctx, "secondary"),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const orderRefundedEmail = defineEmailTemplate({
  key: "order_refunded",
  audience: "customer",
  label: "İade yapıldı",
  description: "Siparişin iadesi yapıldığında (panelde “İade edildi”) gönderilir.",
  placeholders: ORDER_PLACEHOLDERS,
  sample: () => sampleOrderEmailData(),
  variables: orderVariables,
  build: (data, ctx) => {
    const m = om(ctx).refunded;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "notice", text: data.paymentMethod === "card" ? m.card : m.other, tone: "success" },
        viewOrderButton(data, ctx, "secondary"),
        ...orderSummaryBlocks(data, ctx),
        helpBlock(ctx),
      ],
    };
  },
});

export const adminNewOrderEmail = defineEmailTemplate({
  key: "admin_new_order",
  audience: "admin",
  label: "Yeni sipariş (yönetici)",
  description:
    "Sipariş işlem gerektirdiğinde yönetici alıcılarına gider: kart ödemesi alındığında, havale/EFT, kapıda ödeme veya vadeli sipariş verildiğinde.",
  placeholders: [...ORDER_PLACEHOLDERS, "customer", "method"],
  sample: () =>
    sampleOrderEmailData({
      admin: { panelUrl: "/panel/siparisler/1", companyName: null, isMember: true, customerNote: "Lütfen zile basmayın.", taxId: null },
    }),
  variables: orderVariables,
  build: (data, ctx) => {
    const orders = om(ctx);
    const m = orders.adminNew;
    const a = data.admin;
    const rows = [
      { label: m.customer, value: data.fullName },
      { label: m.email, value: data.email },
      ...(data.phone ? [{ label: m.phone, value: formatPhone(data.phone) }] : []),
      ...(a?.companyName ? [{ label: m.company, value: a.companyName }] : []),
      { label: m.account, value: a?.isMember ? m.member : m.guest },
    ];
    return {
      subject: a?.testPayment ? `${m.testPaymentTitle} · ${m.subject}` : m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        // Go-live CF-11: a test payment is flagged first, in red, instead of "card payment received".
        ...(a?.testPayment ? [{ type: "notice" as const, title: m.testPaymentTitle, text: m.testPayment, tone: "danger" as const }] : []),
        { type: "paragraph", text: m.intro },
        ...(a?.testPayment
          ? []
          : [{ type: "notice" as const, text: m.next[data.paymentMethod] ?? "", tone: data.paymentMethod === "bank_transfer" ? ("warning" as const) : ("info" as const) }]),
        ...(a?.panelUrl ? [{ type: "button" as const, label: m.button, url: a.panelUrl }] : []),
        { type: "keyValue", rows },
        ...(a?.customerNote ? [{ type: "keyValue" as const, rows: [{ label: m.note, value: a.customerNote }] }] : []),
        ...orderSummaryBlocks(data, ctx, { admin: true }),
      ],
    };
  },
});
