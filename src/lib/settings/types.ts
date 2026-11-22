// Shape + defaults of every settings document (table `settings`, one row per key).
// The panel edits these; the storefront reads them with getSettings(key).
import { z } from "zod";
import type { CouponType } from "@/db/schema/commerce";
import { LOCALES } from "@/i18n/locales";
import { BANK_TRANSFER_PAYMENT_DAYS } from "@/lib/orders/bank-transfer-deadline";

export const localizedText = z.object({
  tr: z.string(),
  en: z.string().optional(),
  ar: z.string().optional(),
});
const kurus = z.number().int().min(0);
const mediaId = z.number().int().positive().nullable();

export const generalSettings = z.object({
  siteName: z.string().default("PRESTİJ"),
  legalName: z.string().default("PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ."),
  tagline: localizedText.default({ tr: "Bakım koleksiyonu" }),
  phone: z.string().default("0352 353 30 70"),
  email: z.string().default(""),
  /** Seller identity for the pre-information form and the distance sales agreement (MSY m.5(1)(b)). Shown only when filled. */
  mersisNo: z.string().default(""),
  taxOffice: z.string().default(""),
  taxNumber: z.string().default(""),
  /** Registered e-mail (KEP) address. */
  kep: z.string().default(""),
  /**
   * Go-live CF-9 (e-commerce regulation, RG 32058 m.5): the professional chamber the seller is registered
   * with (e.g. Kayseri Ticaret Odası) and where its professional rules can be read. Shown in the footer's
   * "İletişim" block and the contact section when filled; empty = hidden.
   */
  chamber: z.object({ name: localizedText, rulesUrl: z.string() }).default({ name: { tr: "" }, rulesUrl: "" }),
  /** Registered trademark (TÜRKPATENT), e.g. "PRESTİJ"; empty = hidden. */
  trademark: z.string().default(""),
  address: z
    .object({
      line: z.string(),
      district: z.string(),
      city: z.string(),
      country: z.string(),
    })
    .default({ line: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E", district: "Kocasinan", city: "Kayseri", country: "Türkiye" }),
  mapUrl: z.string().optional(),
  social: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      youtube: z.string().optional(),
      tiktok: z.string().optional(),
      linkedin: z.string().optional(),
    })
    .default({}),
  logo: z
    .object({
      /** Logo for light backgrounds (transparent PNG/SVG). */
      lightId: mediaId.default(null),
      /** Optional logo for dark backgrounds; falls back to lightId. */
      darkId: mediaId.default(null),
    })
    .default({ lightId: null, darkId: null }),
});

export const shippingSettings = z.object({
  /** Standard shipping fee per order. */
  flatFee: kurus.default(9990),
  /** Orders at or above this subtotal ship free. 0 = never free. */
  freeThreshold: kurus.default(150000),
  /** Extra fee for heavy parcels (e.g. 20 L bidon ≈ 21 kg). */
  heavy: z
    .object({
      enabled: z.boolean(),
      /** Total order weight above which the surcharge applies. */
      thresholdGrams: z.number().int().min(0),
      /** Surcharge per started kilogram above the threshold. */
      feePerKg: kurus,
    })
    .default({ enabled: true, thresholdGrams: 10000, feePerKg: 1500 }),
  carriers: z
    .array(z.object({ key: z.string(), name: z.string(), trackingUrl: z.string() }))
    .default([
      { key: "yurtici", name: "Yurtiçi Kargo", trackingUrl: "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code={code}" },
      { key: "aras", name: "Aras Kargo", trackingUrl: "https://www.araskargo.com.tr/trs_gonderi_sorgula.aspx?q={code}" },
      { key: "mng", name: "MNG Kargo", trackingUrl: "https://www.mngkargo.com.tr/gonderi-takip/?code={code}" },
    ]),
  estimatedDays: z.object({ min: z.number().int(), max: z.number().int() }).default({ min: 1, max: 3 }),
});

export const paymentSettings = z.object({
  card: z
    .object({
      enabled: z.boolean(),
      provider: z.enum(["iyzico", "paytr"]),
      testMode: z.boolean(),
      installments: z.boolean(),
      /** Highest installment count offered at the provider (1 = single payment only). Added on day 4. */
      maxInstallments: z.number().int().min(1).max(12).default(1),
    })
    .default({ enabled: true, provider: "iyzico", testMode: true, installments: true, maxInstallments: 1 }),
  bankTransfer: z
    .object({
      enabled: z.boolean(),
      discountPercent: z.number().int().min(0).max(50),
      accounts: z.array(z.object({ bank: z.string(), holder: z.string(), iban: z.string() })),
      instructions: localizedText,
      /**
       * Sales-ready SR-2: calendar days the customer has to pay a havale order (1–14). The deadline is the end
       * of the last day in Türkiye time (src/lib/orders/bank-transfer-deadline.ts); shown in the e-mail, on the
       * order page, in the order block of the sales contracts and at checkout; the panel marks orders past it.
       * Nothing cancels them automatically. Rows saved before this field read the default 3; an unusable stored
       * value (only possible by SQL) also reads 3 instead of failing the whole bankTransfer object, which would
       * drop the bank accounts (parseSettings repairs per top-level field only).
       */
      paymentDays: z
        .number()
        .int()
        .min(BANK_TRANSFER_PAYMENT_DAYS.min)
        .max(BANK_TRANSFER_PAYMENT_DAYS.max)
        .default(BANK_TRANSFER_PAYMENT_DAYS.default)
        .catch(BANK_TRANSFER_PAYMENT_DAYS.default),
    })
    .default({
      enabled: true,
      discountPercent: 0,
      accounts: [],
      instructions: { tr: "Açıklama kısmına sipariş numaranızı yazmayı unutmayın." },
      paymentDays: BANK_TRANSFER_PAYMENT_DAYS.default,
    }),
  cashOnDelivery: z
    .object({
      enabled: z.boolean(),
      fee: kurus,
      /** Orders above this total cannot use cash on delivery. 0 = no limit. */
      maxOrderTotal: kurus,
    })
    .default({ enabled: true, fee: 4990, maxOrderTotal: 500000 }),
  /**
   * PayTR-fix IMPL-B (S7, contract Art. 10.2): PayTR's logo, an image the owner uploads to the media library
   * from PayTR's own logo files (PayTR panel, or PayTR_Gorselleri.zip linked from the dev.paytr.com FAQ). Shown next to the "ödeme hizmetleri PAYTR … tarafından
   * sağlanmaktadır" notice (footer.paytr.*) on the card page and in the footer; null = no logo, only the notice.
   * A top-level field, so an unusable stored value never resets the card settings (parseSettings repairs per
   * top-level field). The key ends in "ImageId", so media usage and deletion checks see the reference.
   */
  paytrLogoImageId: mediaId.default(null),
});

// Day 5 (CORE): search engine verification, return policy (structured data + merchant feed) and the
// Google product category. Every new field has a default, so stored rows from before day 5 stay valid.

/** Allowed characters of a verification code: the token only (the `content` of the meta tag), never the tag. */
export const SEO_VERIFICATION_PATTERN = /^[A-Za-z0-9_\-:.=]*$/;
export const SEO_VERIFICATION_MAX_LENGTH = 100;

const verificationCode = z
  .string()
  .trim()
  .max(SEO_VERIFICATION_MAX_LENGTH, `Doğrulama kodu en fazla ${SEO_VERIFICATION_MAX_LENGTH} karakter olabilir.`)
  .regex(SEO_VERIFICATION_PATTERN, "Yalnızca kodu yapıştırın (meta etiketinin content değeri): harf, rakam ve _ - : . = kullanılabilir.");

/** `content` of each engine's site-verification meta tag; "" = no tag. */
export const seoVerificationSettings = z.object({
  /** <meta name="google-site-verification" content="…"> (Metadata `verification.google`). */
  google: verificationCode.default(""),
  /** <meta name="msvalidate.01" content="…"> (Metadata `verification.other["msvalidate.01"]`). */
  bing: verificationCode.default(""),
  /** <meta name="yandex-verification" content="…"> (Metadata `verification.yandex`). */
  yandex: verificationCode.default(""),
});

/** Return policy for MerchantReturnPolicy structured data and the merchant feed. */
export const seoReturnSettings = z.object({
  /** Days the customer has to return an item (Turkish distance sales law: at least 14). 0 = no returns. */
  days: z.number({ error: "Bir sayı girin." }).int("Gün sayısı tam sayı olmalı.").min(0, "Gün sayısı en az 0 olabilir.").max(365, "Gün sayısı en fazla 365 olabilir.").default(14),
  /** true = the shop pays return shipping, false = the customer pays, null = not stated (left out of the markup). */
  freeReturns: z.boolean().nullable().default(null),
});

/**
 * Google product taxonomy (checked 2026-11-10 in taxonomy-with-ids.en-US.txt / .tr-TR.txt, version
 * 2021-09-21). Ids are the same in every language; the feed and structured data may use the id.
 */
export const GOOGLE_PRODUCT_CATEGORIES = {
  /** Health & Beauty > Personal Care > Cosmetics > Bath & Body > Liquid Hand Soap (… > Banyo ve Vücut > Sıvı El Sabunu) */
  liquidHandSoap: "3208",
  /** … > Bath & Body > Body Wash (… > Banyo ve Vücut > Vücut Şampuanları): the shower gel (duş jeli). */
  bodyWash: "2747",
  /** … > Cosmetics > Bath & Body Gift Sets (… > Banyo ve Vücut Bakımı Hediye Setleri): the gift sets / bundles. */
  bathAndBodyGiftSets: "475",
} as const;

/** A Google product category: a numeric taxonomy id (preferred) or the full English path; "" = let Google decide. */
export const merchantCategorySetting = z
  .string()
  .trim()
  .max(250, "En fazla 250 karakter girebilirsiniz.")
  .refine((v) => v === "" || /^\d{1,7}$/.test(v) || (v.includes(" > ") && !/[<\u0000-\u001F\u007F]/.test(v)), {
    message: "Google ürün kategorisinin numarasını (ör. 3208) ya da tam yolunu girin.",
  });

export const seoSettings = z.object({
  titleTemplate: z.string().default("%s | PRESTİJ"),
  defaultTitle: localizedText.default({ tr: "PRESTİJ — Sıvı El Sabunu ve Duş Jeli" }),
  description: localizedText.default({
    tr: "Lavanta Latte, Lavanta, Portakal ve Okyanus. Ev, otel, spa ve ofisler için premium sıvı el sabunu ve duş jeli.",
  }),
  ogImageId: mediaId.default(null),
  verification: seoVerificationSettings.default({ google: "", bing: "", yandex: "" }),
  returns: seoReturnSettings.default({ days: 14, freeReturns: null }),
  /** Store-wide Google product category (feed `g:google_product_category`); default Liquid Hand Soap. */
  merchantCategory: merchantCategorySetting.default(GOOGLE_PRODUCT_CATEGORIES.liquidHandSoap),
});

export const localeSettings = z.object({
  enabled: z.array(z.enum(LOCALES)).default(["tr", "en", "ar"]),
});

export const b2bSettings = z.object({
  enabled: z.boolean().default(true),
  /** Business accounts must be approved in the panel before business prices apply. */
  requireApproval: z.boolean().default(true),
  /** Show business prices to visitors who are not logged in (usually false). */
  showPricesToGuests: z.boolean().default(false),
  minOrderTotal: kurus.default(0),
  defaultGroupSlug: z.string().default("kurumsal"),
});

export const sampleSettings = z.object({
  /** Customers can add free samples to their cart. */
  cartSampleEnabled: z.boolean().default(true),
  maxPerOrder: z.number().int().min(0).default(2),
  /** Minimum cart subtotal before samples can be added. 0 = always. */
  minOrderTotal: kurus.default(0),
  /** Businesses can request samples with the form on /numune. */
  requestFormEnabled: z.boolean().default(true),
});

export const newsletterSettings = z.object({
  enabled: z.boolean().default(true),
  popupEnabled: z.boolean().default(false),
  popupDelaySeconds: z.number().int().min(0).default(20),
  incentive: localizedText.default({ tr: "Yeni kokulardan ve kampanyalardan ilk siz haberdar olun." }),
});

export const whatsappSettings = z.object({
  enabled: z.boolean().default(true),
  /** International format without spaces, e.g. 903523533070. */
  phone: z.string().default("903523533070"),
  message: localizedText.default({ tr: "Merhaba, PRESTİJ ürünleri hakkında bilgi almak istiyorum." }),
});

// ---------------------------------------------------------------------------------------------------
// Day 4: e-mails, reviews, subscriptions

/** Registry keys of e-mail templates (src/lib/email/templates): lower-case snake_case, e.g. "order_paid". */
export const EMAIL_TEMPLATE_KEY = /^[a-z][a-z0-9_]{1,63}$/;

/** Panel override of one template. Missing subject/intro = the built-in text; missing entry = enabled. */
export const emailTemplateOverride = z.object({
  enabled: z.boolean().default(true),
  subject: localizedText.optional(),
  intro: localizedText.optional(),
});

export const emailSettings = z.object({
  /** Display name in the From header (the address itself is EMAIL_FROM, an environment variable). */
  fromName: z.string().default("PRESTİJ"),
  /** Reply-To address; empty = general.email. */
  replyTo: z.string().default(""),
  /** Who gets admin notifications (new order, quote, sample, business application…); empty = general.email. */
  adminRecipients: z.array(z.string()).default([]),
  /** Extra line in every e-mail footer (e.g. customer service hours). */
  footerNote: localizedText.default({ tr: "" }),
  /** Per template key: on/off and the panel's subject / intro text per locale. */
  templates: z.record(z.string().regex(EMAIL_TEMPLATE_KEY), emailTemplateOverride).default({}),
});

export const reviewSettings = z.object({
  /** Reviews shown on product pages and the review request e-mail. Moderation is always on. */
  enabled: z.boolean().default(true),
  /** Guests may review through the signed link in the review request e-mail. */
  allowGuestLinks: z.boolean().default(true),
  /** Days after delivery before the review request e-mail goes out. */
  requestDaysAfterDelivery: z.number().int().min(1).max(60).default(7),
  /** Minimum review text length (characters). */
  minLength: z.number().int().min(0).max(500).default(10),
});

export const SUBSCRIPTION_PAYMENT_METHODS = ["card", "bank_transfer", "cash_on_delivery"] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const subscriptionSettings = z.object({
  /** "Abone ol ve kazan" on eligible products (products.allowSubscription) with an active plan. */
  enabled: z.boolean().default(true),
  /** Days before a renewal the reminder e-mail (skip / manage links) goes out. */
  reminderDaysBefore: z.number().int().min(1).max(14).default(3),
  /** Payment methods a subscription may use (card renewals send a pay link). */
  allowedMethods: z.array(z.enum(SUBSCRIPTION_PAYMENT_METHODS)).default(["card", "bank_transfer"]),
  /** How long a card renewal order waits for payment before it expires. */
  cardPaymentWindowHours: z.number().int().min(1).max(336).default(72),
});

// ---------------------------------------------------------------------------------------------------
// Day 6: gift wheel (Hediye Çarkı). Contract docs/DAY6-WHEEL-VIDEO.md §1.1; API docs/DAY6-CORE-API.md §3.
// Every slice wins (no "try again" slice) and the server alone picks the result (weights never leave the
// server). No object-level refinements here: parseSettings repairs a stored document per top-level field,
// so cross-field rules (end after start) live in the panel schema only.

/** Prize types a slice can give (a subset of the coupon types; the prize is issued as a coupon). */
export const WHEEL_PRIZE_TYPES = ["percent", "fixed", "free_shipping"] as const satisfies readonly CouponType[];
export type WheelPrizeType = (typeof WHEEL_PRIZE_TYPES)[number];
/** Slice colours; each maps to theme tokens (readable in light and dark themes). */
export const WHEEL_TONES = ["brand", "gold", "cream", "ink"] as const;
export type WheelTone = (typeof WHEEL_TONES)[number];
/** new_customers: guests and customers without a counted order; everyone: every customer account. Never staff. */
export const WHEEL_AUDIENCES = ["new_customers", "everyone"] as const;
export type WheelAudience = (typeof WHEEL_AUDIENCES)[number];
/** Stable slice id: lower-case a–z, 0–9 and inner hyphens, 1–24 characters (stats and spins refer to it). */
export const WHEEL_SLICE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

/** Every range rule of the wheel settings (the panel schema enforces the same with Turkish messages). */
export const WHEEL_LIMITS = {
  slices: { min: 4, max: 8 },
  labelMax: 40,
  percent: { min: 1, max: 50 },
  /** Fixed prizes: at least 1 TL (kuruş). */
  fixedMin: 100,
  weight: { min: 1, max: 1000 },
  validityHours: { min: 24, max: 720 },
  holdDays: { min: 1, max: 30 },
  teaserDelaySeconds: { min: 0, max: 120 },
  /** 0 = never opens by itself. */
  autoOpenSeconds: { min: 0, max: 300 },
  autoOpenCooldownDays: { min: 1, max: 90 },
  round: { min: 1, max: 1_000_000 },
  /** Panel override lengths of `texts`. */
  text: { title: 80, subtitle: 200, teaser: 60, claimCta: 40, registerCta: 60, signInCta: 60 },
} as const;

const wheelInt = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
/** An instant as an ISO string with zone, e.g. "2026-12-01T09:00:00.000Z" (the panel converts Istanbul input). */
const wheelInstant = z.iso.datetime({ offset: true });

export const giftWheelSliceLabel = z.object({
  tr: z.string().trim().min(1).max(WHEEL_LIMITS.labelMax),
  en: z.string().trim().max(WHEEL_LIMITS.labelMax).optional(),
  ar: z.string().trim().max(WHEEL_LIMITS.labelMax).optional(),
});

export const giftWheelSlice = z
  .object({
    key: z.string().regex(WHEEL_SLICE_KEY_PATTERN),
    label: giftWheelSliceLabel,
    type: z.enum(WHEEL_PRIZE_TYPES),
    /** Percent (1–50) for "percent", kuruş (≥ 100) for "fixed", 0 for "free_shipping". */
    value: z.number().int().min(0),
    /** Minimum basket in kuruş for the prize coupon (0 = none). */
    minOrderTotal: kurus.default(0),
    /** Relative chance (1–1000); a slice that can never land must not be shown, so 0 is not allowed. */
    weight: wheelInt(WHEEL_LIMITS.weight),
    tone: z.enum(WHEEL_TONES),
  })
  .superRefine((slice, ctx) => {
    const bad =
      slice.type === "percent"
        ? slice.value < WHEEL_LIMITS.percent.min || slice.value > WHEEL_LIMITS.percent.max
        : slice.type === "fixed"
          ? slice.value < WHEEL_LIMITS.fixedMin
          : slice.value !== 0;
    if (bad) ctx.addIssue({ code: "custom", message: "Ödül değeri, ödül türüne uymuyor.", path: ["value"] });
  });
export type GiftWheelSlice = z.infer<typeof giftWheelSlice>;

/**
 * The six default slices (contract §1.1 "Defaults"). Code defaults keep the wheel switched off; the
 * day-6 content script stores them with `enabled: true` for the client's database. Review before launch.
 */
export const GIFT_WHEEL_DEFAULT_SLICES: readonly GiftWheelSlice[] = Object.freeze([
  { key: "indirim-5", label: { tr: "%5 indirim", en: "5% off", ar: "خصم 5%" }, type: "percent", value: 5, minOrderTotal: 0, weight: 35, tone: "cream" },
  { key: "indirim-10", label: { tr: "%10 indirim", en: "10% off", ar: "خصم 10%" }, type: "percent", value: 10, minOrderTotal: 0, weight: 25, tone: "brand" },
  { key: "ucretsiz-kargo", label: { tr: "Ücretsiz kargo", en: "Free shipping", ar: "شحن مجاني" }, type: "free_shipping", value: 0, minOrderTotal: 0, weight: 20, tone: "gold" },
  { key: "indirim-15", label: { tr: "%15 indirim", en: "15% off", ar: "خصم 15%" }, type: "percent", value: 15, minOrderTotal: 0, weight: 10, tone: "ink" },
  { key: "indirim-50-tl", label: { tr: "50 TL indirim", en: "₺50 off", ar: "خصم 50 ليرة" }, type: "fixed", value: 5000, minOrderTotal: 30000, weight: 7, tone: "cream" },
  { key: "indirim-20", label: { tr: "%20 indirim", en: "20% off", ar: "خصم 20%" }, type: "percent", value: 20, minOrderTotal: 75000, weight: 3, tone: "brand" },
] satisfies GiftWheelSlice[]);

/** A fresh, mutable copy of the default slices (zod defaults and the content script). */
export function defaultGiftWheelSlices(): GiftWheelSlice[] {
  return GIFT_WHEEL_DEFAULT_SLICES.map((s) => ({ ...s, label: { ...s.label } }));
}

export const giftWheelSlices = z
  .array(giftWheelSlice)
  .min(WHEEL_LIMITS.slices.min)
  .max(WHEEL_LIMITS.slices.max)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((slice, i) => {
      if (seen.has(slice.key)) ctx.addIssue({ code: "custom", message: "Bu dilim anahtarı başka bir dilimde de var.", path: [i, "key"] });
      seen.add(slice.key);
    });
  });

/** Panel overrides of the wheel texts (missing = the UI dictionary's `wheel.*` default). */
export const giftWheelTexts = z.object({
  title: localizedText.optional(),
  subtitle: localizedText.optional(),
  teaser: localizedText.optional(),
  claimCta: localizedText.optional(),
  registerCta: localizedText.optional(),
  signInCta: localizedText.optional(),
});
export type GiftWheelTextKey = keyof z.infer<typeof giftWheelTexts>;

export const giftWheelSettings = z.object({
  /** Off by default (safe for a fresh production database). */
  enabled: z.boolean().default(false),
  /** Optional schedule (ISO instants; null = open-ended). The wheel is live while startsAt ≤ now < endsAt. */
  startsAt: wheelInstant.nullable().default(null),
  endsAt: wheelInstant.nullable().default(null),
  audience: z.enum(WHEEL_AUDIENCES).default("new_customers"),
  /** Approved business customers see the wheel only when this is on. */
  showToBusiness: z.boolean().default(false),
  slices: giftWheelSlices.default(defaultGiftWheelSlices),
  /** How long a claimed prize coupon stays valid, from the claim (coupon issue). */
  validityHours: wheelInt(WHEEL_LIMITS.validityHours).default(72),
  /** How long an unclaimed spin is kept for its visitor (also the spin cookie's lifetime). */
  holdDays: wheelInt(WHEEL_LIMITS.holdDays).default(7),
  /** Teaser button delay after the page is idle. */
  teaserDelaySeconds: wheelInt(WHEEL_LIMITS.teaserDelaySeconds).default(6),
  /** Desktop only: open the dialog by itself after this many seconds (0 = never). Phones never auto-open. */
  autoOpenSeconds: wheelInt(WHEEL_LIMITS.autoOpenSeconds).default(25),
  /** Desktop only: open on exit intent. */
  exitIntent: z.boolean().default(true),
  /** At most one automatic open per visitor in this many days. */
  autoOpenCooldownDays: wheelInt(WHEEL_LIMITS.autoOpenCooldownDays).default(7),
  /** "Yeni tur başlat" increments it: one prize per account per round. */
  round: wheelInt(WHEEL_LIMITS.round).default(1),
  texts: giftWheelTexts.default({}),
  /** The "prize expires soon" e-mail (only to confirmed newsletter subscribers; lawyer to confirm). */
  reminderEnabled: z.boolean().default(true),
});

export const settingsSchemas = {
  general: generalSettings,
  shipping: shippingSettings,
  payments: paymentSettings,
  seo: seoSettings,
  locales: localeSettings,
  b2b: b2bSettings,
  samples: sampleSettings,
  newsletter: newsletterSettings,
  whatsapp: whatsappSettings,
  emails: emailSettings,
  reviews: reviewSettings,
  subscriptions: subscriptionSettings,
  giftWheel: giftWheelSettings,
} as const;

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings<K extends SettingsKey> = z.infer<(typeof settingsSchemas)[K]>;

/**
 * Parse a stored value (or nothing) into a complete settings object with defaults filled in. Tolerant
 * of old or partly invalid documents: when the whole value does not parse, each top-level field that
 * is valid on its own is kept and only the broken ones fall back to their defaults (a stored document
 * from before a schema change never wipes the rest, e.g. the bank accounts).
 */
export function parseSettings<K extends SettingsKey>(key: K, value: unknown): Settings<K> {
  const schema = settingsSchemas[key] as unknown as z.ZodObject<Record<string, z.ZodType>>;
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data as Settings<K>;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const kept: Record<string, unknown> = {};
    for (const [field, fieldSchema] of Object.entries(schema.shape)) {
      const stored = (value as Record<string, unknown>)[field];
      if (stored !== undefined && fieldSchema.safeParse(stored).success) kept[field] = stored;
    }
    const repaired = schema.safeParse(kept);
    if (repaired.success) return repaired.data as Settings<K>;
  }
  return schema.parse({}) as Settings<K>;
}
