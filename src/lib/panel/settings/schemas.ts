// Panel validation for every settings document (one save per key). Stricter than the storefront's
// `settingsSchemas` (src/lib/settings/types.ts): the output of each schema below is a complete value
// that `settingsSchemas[key]` accepts, so a save can never make the storefront fall back to defaults.
// Pure (zod only): the same schemas run in unit tests and could run on the client.
import { z } from "zod";
import { LOCALES, type LocalizedText } from "@/i18n/locales";
import { isSafeHref } from "@/lib/safe-href";
import {
  dateTimeInput,
  kurusInput,
  localizedTextOf,
  mediaIdInput,
  optionalLocalizedTextOf,
  percentInputRange,
  slugInput,
  textInput,
  updatedAtInput,
} from "@/lib/panel/schemas";
import { BANK_TRANSFER_PAYMENT_DAYS } from "@/lib/orders/bank-transfer-deadline";
import { normalizeVerificationCodes } from "@/lib/panel/seo/launch";
import {
  EMAIL_TEMPLATE_KEY,
  GOOGLE_PRODUCT_CATEGORIES,
  merchantCategorySetting,
  seoReturnSettings,
  seoVerificationSettings,
  SUBSCRIPTION_PAYMENT_METHODS,
  WHEEL_AUDIENCES,
  WHEEL_LIMITS,
  WHEEL_PRIZE_TYPES,
  WHEEL_SLICE_KEY_PATTERN,
  WHEEL_TONES,
  type Settings,
  type SettingsKey,
} from "@/lib/settings/types";
import { isValidIban, isValidVkn } from "@/lib/validation/tr";

// ---------------------------------------------------------------------------------------------------
// Building blocks

/** Optional plain text stored as "" when empty (settings fields are strings, never null). */
function optionalString(max: number, check?: { test: (v: string) => boolean; message: string }) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .pipe(
      z
        .string()
        .max(max, `En fazla ${max} karakter girebilirsiniz.`)
        .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(v), "Metin geçersiz karakterler içeriyor.")
        .refine((v) => v === "" || !check || check.test(v), check?.message ?? ""),
    );
}

/** Localized text that may be empty: stored as { tr: "" } (the storefront hides empty texts). */
export function settingsLocalized(max: number) {
  return optionalLocalizedTextOf({ max }).transform((v): LocalizedText => v ?? { tr: "" });
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:.]{2,}$/;
export const HTTPS_MESSAGE = "Adres https:// ile başlamalı.";
/** A full https:// URL that passes the storefront link rule. */
export const isHttpsUrl = (v: string): boolean => /^https:\/\//i.test(v) && isSafeHref(v);

const PHONE = /^\+?[\d\s().-]{7,25}$/;
export const PHONE_MESSAGE = "Geçerli bir telefon numarası girin (ör. 0352 353 30 70).";

const int = (min: number, max: number, label = "Değer") =>
  z
    .number({ error: "Bir sayı girin." })
    .int(`${label} tam sayı olmalı.`)
    .min(min, `${label} en az ${min} olabilir.`)
    .max(max, `${label} en fazla ${max} olabilir.`);

/** The `updatedAt` of the loaded row; null when the key has no row yet (the save then inserts it). */
export const settingsVersionInput = z.union([updatedAtInput, z.null()]);

// ---------------------------------------------------------------------------------------------------
// general

/** Social profile: a full https:// URL or a bare handle (the footer turns "prestij" into a profile link). */
const socialInput = optionalString(200, {
  test: (v) => (/^https?:\/\//i.test(v) ? isHttpsUrl(v) : /^@?[\w.-]{1,100}$/.test(v)),
  message: "Profil adresini https:// ile ya da yalnızca kullanıcı adı olarak girin (ör. prestij).",
});

export const generalSettingsInput = z.object({
  siteName: textInput({ max: 60, requiredMessage: "Site adını girin." }),
  legalName: textInput({ max: 200, requiredMessage: "Ticari unvanı girin; yasal metinlerde satıcı adı olarak görünür." }),
  tagline: settingsLocalized(160),
  phone: textInput({ max: 25, requiredMessage: "Telefon numarası gerekli; yasal metinlerde ve alt bilgide görünür." }).refine(
    (v) => PHONE.test(v),
    PHONE_MESSAGE,
  ),
  email: optionalString(200, { test: (v) => EMAIL.test(v), message: "Geçerli bir e-posta adresi girin." }),
  mersisNo: optionalString(16, { test: (v) => /^\d{16}$/.test(v), message: "MERSİS numarası 16 haneden oluşur." }),
  taxOffice: optionalString(80),
  taxNumber: optionalString(10, { test: isValidVkn, message: "Geçerli bir vergi kimlik numarası girin (10 hane)." }),
  kep: optionalString(200, { test: (v) => EMAIL.test(v), message: "KEP adresini e-posta biçiminde girin (ör. firma@hs01.kep.tr)." }),
  // Go-live CF-9. A payload without these fields (a form opened before the update) saves them empty.
  chamber: z
    .object({
      name: settingsLocalized(160),
      rulesUrl: optionalString(2000, { test: isHttpsUrl, message: HTTPS_MESSAGE }),
    })
    .default({ name: { tr: "" }, rulesUrl: "" }),
  trademark: optionalString(120),
  address: z.object({
    line: textInput({ max: 200, requiredMessage: "Açık adresi girin." }),
    district: textInput({ max: 80, requiredMessage: "İlçeyi girin." }),
    city: textInput({ max: 80, requiredMessage: "İli seçin." }),
    country: textInput({ max: 80, requiredMessage: "Ülkeyi girin." }),
  }),
  mapUrl: optionalString(2000, { test: isHttpsUrl, message: HTTPS_MESSAGE }).transform((v) => v || undefined),
  social: z
    .object({
      instagram: socialInput,
      facebook: socialInput,
      youtube: socialInput,
      tiktok: socialInput,
      linkedin: socialInput,
    })
    .transform((v) => Object.fromEntries(Object.entries(v).filter(([, value]) => value !== "")) as Settings<"general">["social"]),
  logo: z.object({ lightId: mediaIdInput, darkId: mediaIdInput }),
});

// ---------------------------------------------------------------------------------------------------
// shipping

export const TRACKING_CODE = "{code}";
export const TRACKING_CODE_MESSAGE = "Takip adresi {code} içermeli; kargo takip numarası oraya yerleşir.";
export const CARRIER_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Mesafeli Sözleşmeler Yönetmeliği m.15: delivery within 30 days at the latest. */
export const MAX_DELIVERY_DAYS = 30;

export const carrierInput = z.object({
  key: z
    .string({ error: "Kısa kod girin." })
    .trim()
    .toLowerCase()
    .min(1, "Kısa kod girin.")
    .max(40, "Kısa kod en fazla 40 karakter olabilir.")
    .regex(CARRIER_KEY_PATTERN, "Kısa kod yalnızca küçük harf, rakam ve tire içerebilir (ör. yurtici)."),
  name: textInput({ max: 60, requiredMessage: "Firma adını girin." }),
  trackingUrl: z
    .string({ error: "Takip adresini girin." })
    .trim()
    .min(1, "Takip adresini girin.")
    .max(500, "En fazla 500 karakter girebilirsiniz.")
    .refine(isHttpsUrl, HTTPS_MESSAGE)
    .refine((v) => v.includes(TRACKING_CODE), TRACKING_CODE_MESSAGE),
});

export const shippingSettingsInput = z.object({
  flatFee: kurusInput,
  freeThreshold: kurusInput,
  heavy: z.object({
    enabled: z.boolean(),
    thresholdGrams: int(0, 1_000_000, "Ağırlık sınırı"),
    feePerKg: kurusInput,
  }),
  carriers: z
    .array(carrierInput)
    .max(20, "En fazla 20 kargo firması eklenebilir.")
    .superRefine((list, ctx) => {
      const seen = new Map<string, number>();
      list.forEach((c, i) => {
        if (seen.has(c.key)) ctx.addIssue({ code: "custom", message: "Bu kısa kod başka bir firmada kullanılıyor.", path: [i, "key"] });
        else seen.set(c.key, i);
      });
    }),
  estimatedDays: z
    .object({ min: int(0, MAX_DELIVERY_DAYS, "En kısa süre"), max: int(1, MAX_DELIVERY_DAYS, "En uzun süre") })
    .superRefine((v, ctx) => {
      if (v.max < v.min) ctx.addIssue({ code: "custom", message: "En uzun süre, en kısa süreden az olamaz.", path: ["max"] });
    }),
});

// ---------------------------------------------------------------------------------------------------
// payments

export const IBAN_MESSAGE = "Geçerli bir TR IBAN girin (TR ile başlayan 26 karakter).";
/** Right shape (TR + 24 digits) but the check digits do not match: most likely a mistyped digit. */
export const IBAN_CHECKSUM_MESSAGE = "IBAN'ın kontrol haneleri tutmuyor; bir rakam yanlış yazılmış olabilir.";
/** "tr33 0006 1005…" → "TR330006100519786457841326"; must pass the mod-97 check. */
export const ibanInput = z
  .string({ error: IBAN_MESSAGE })
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .superRefine((v, ctx) => {
    if (isValidIban(v)) return;
    ctx.addIssue({ code: "custom", message: /^TR\d{24}$/.test(v) ? IBAN_CHECKSUM_MESSAGE : IBAN_MESSAGE });
  });

export const bankAccountInput = z.object({
  bank: textInput({ max: 80, requiredMessage: "Banka adını girin." }),
  holder: textInput({ max: 120, requiredMessage: "Hesap sahibini girin." }),
  iban: ibanInput,
});

export const PAYMENT_PROVIDERS = ["iyzico", "paytr"] as const;

export const paymentSettingsInput = z.object({
  card: z.object({
    enabled: z.boolean(),
    provider: z.enum(PAYMENT_PROVIDERS, { error: "Bir ödeme kuruluşu seçin." }),
    testMode: z.boolean(),
    installments: z.boolean(),
    maxInstallments: int(1, 12, "Taksit sayısı"),
  }),
  bankTransfer: z.object({
    enabled: z.boolean(),
    discountPercent: percentInputRange(0, 50),
    accounts: z
      .array(bankAccountInput)
      .max(10, "En fazla 10 banka hesabı eklenebilir.")
      .superRefine((list, ctx) => {
        const seen = new Set<string>();
        list.forEach((a, i) => {
          if (seen.has(a.iban)) ctx.addIssue({ code: "custom", message: "Bu IBAN listede zaten var.", path: [i, "iban"] });
          seen.add(a.iban);
        });
      }),
    instructions: settingsLocalized(500),
    /** SR-2: days to pay a havale order (the deadline in the e-mail, on the order page and in the contracts' order block). */
    paymentDays: int(BANK_TRANSFER_PAYMENT_DAYS.min, BANK_TRANSFER_PAYMENT_DAYS.max, "Ödeme süresi"),
  }),
  cashOnDelivery: z.object({
    enabled: z.boolean(),
    fee: kurusInput,
    maxOrderTotal: kurusInput,
  }),
  /** PayTR-fix IMPL-B (S7): PayTR's logo next to the PayTR notice (an image from the media library, or none). */
  paytrLogoImageId: mediaIdInput,
});

// ---------------------------------------------------------------------------------------------------
// seo

export const TITLE_TOKEN = "%s";
export const TITLE_TEMPLATE_MESSAGE = "Şablon bir kez %s içermeli; sayfanın adı oraya yerleşir (ör. %s | PRESTİJ).";

export const seoSettingsInput = z.object({
  titleTemplate: z
    .string({ error: "Başlık şablonunu girin." })
    .trim()
    .min(1, "Başlık şablonunu girin.")
    .max(80, "En fazla 80 karakter girebilirsiniz.")
    .refine((v) => v.split(TITLE_TOKEN).length === 2, TITLE_TEMPLATE_MESSAGE),
  defaultTitle: localizedTextOf({ max: 120, requiredMessage: "Varsayılan başlığı girin." }),
  description: localizedTextOf({ max: 320, requiredMessage: "Varsayılan açıklamayı girin." }),
  ogImageId: mediaIdInput,
  // Day 5: the storefront rules themselves (Turkish messages); a missing field keeps its default.
  // Verification: a pasted meta tag or DNS TXT value ("google-site-verification=…") is reduced to the
  // code first, so owners can paste whatever the tool shows them.
  verification: z
    .preprocess(normalizeVerificationCodes, seoVerificationSettings)
    .default({ google: "", bing: "", yandex: "" }),
  returns: seoReturnSettings.default({ days: 14, freeReturns: null }),
  merchantCategory: merchantCategorySetting.default(GOOGLE_PRODUCT_CATEGORIES.liquidHandSoap),
});

// ---------------------------------------------------------------------------------------------------
// locales

export const localeSettingsInput = z.object({
  enabled: z
    .array(z.enum(LOCALES, { error: "Geçersiz dil." }))
    .transform((list) => LOCALES.filter((l) => list.includes(l)))
    .refine((list) => list.includes("tr"), "Türkçe her zaman açık kalır; sitenin ana dilidir."),
});

// ---------------------------------------------------------------------------------------------------
// b2b, samples, newsletter, whatsapp

export const b2bSettingsInput = z.object({
  enabled: z.boolean(),
  requireApproval: z.boolean(),
  showPricesToGuests: z.boolean(),
  minOrderTotal: kurusInput,
  defaultGroupSlug: slugInput,
});

export const sampleSettingsInput = z.object({
  cartSampleEnabled: z.boolean(),
  maxPerOrder: int(0, 10, "Numune sayısı"),
  minOrderTotal: kurusInput,
  requestFormEnabled: z.boolean(),
});

export const newsletterSettingsInput = z.object({
  enabled: z.boolean(),
  popupEnabled: z.boolean(),
  popupDelaySeconds: int(0, 600, "Bekleme süresi"),
  incentive: settingsLocalized(300),
});

export const WHATSAPP_MESSAGE = "Numarayı ülke koduyla girin (ör. 90 532 123 45 67).";

/** "0532 123 45 67" / "+90 532…" → "905321234567" (international, digits only). */
export function normalizeWhatsappPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) return `90${digits}`;
  return digits;
}

export const whatsappSettingsInput = z
  .object({
    enabled: z.boolean(),
    phone: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => normalizeWhatsappPhone(v ?? ""))
      .refine((v) => v === "" || /^[1-9]\d{9,14}$/.test(v), WHATSAPP_MESSAGE),
    message: settingsLocalized(500),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.phone) ctx.addIssue({ code: "custom", message: "WhatsApp düğmesi için numara gerekli.", path: ["phone"] });
  });

// ---------------------------------------------------------------------------------------------------
// emails, reviews, subscriptions (day 4; the builders' settings pages refine the copy, not the shape)

export const EMAIL_ADDRESS_MESSAGE = "Geçerli bir e-posta adresi girin.";

/** Panel override of one template: on/off, subject and intro per locale (empty = the built-in text). */
export const emailTemplateOverrideInput = z.object({
  enabled: z.boolean(),
  subject: optionalLocalizedTextOf({ max: 200 }).transform((v) => v ?? undefined),
  intro: optionalLocalizedTextOf({ max: 2000 }).transform((v) => v ?? undefined),
});

export const emailSettingsInput = z.object({
  fromName: textInput({ max: 80, requiredMessage: "Gönderen adını girin (ör. PRESTİJ)." }).refine(
    (v) => !/[<>"@\r\n]/.test(v),
    "Gönderen adında <, >, \" ve @ kullanılamaz.",
  ),
  replyTo: optionalString(200, { test: (v) => EMAIL.test(v), message: EMAIL_ADDRESS_MESSAGE }),
  adminRecipients: z
    .array(
      z
        .string({ error: EMAIL_ADDRESS_MESSAGE })
        .trim()
        .toLowerCase()
        .max(200, "En fazla 200 karakter girebilirsiniz.")
        .refine((v) => EMAIL.test(v), EMAIL_ADDRESS_MESSAGE),
    )
    .max(10, "En fazla 10 alıcı eklenebilir.")
    .transform((list) => [...new Set(list)]),
  footerNote: settingsLocalized(500),
  templates: z
    .record(z.string().regex(EMAIL_TEMPLATE_KEY, "Geçersiz şablon anahtarı."), emailTemplateOverrideInput)
    .refine((v) => Object.keys(v).length <= 100, "Çok fazla şablon ayarı var."),
});

export const reviewSettingsInput = z.object({
  enabled: z.boolean(),
  allowGuestLinks: z.boolean(),
  requestDaysAfterDelivery: int(1, 60, "Gün sayısı"),
  minLength: int(0, 500, "En az karakter sayısı"),
});

export const subscriptionSettingsInput = z
  .object({
    enabled: z.boolean(),
    reminderDaysBefore: int(1, 14, "Hatırlatma günü"),
    allowedMethods: z
      .array(z.enum(SUBSCRIPTION_PAYMENT_METHODS, { error: "Geçersiz ödeme yöntemi." }))
      .transform((list) => SUBSCRIPTION_PAYMENT_METHODS.filter((m) => list.includes(m))),
    cardPaymentWindowHours: int(1, 336, "Ödeme süresi (saat)"),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && v.allowedMethods.length === 0) {
      ctx.addIssue({ code: "custom", message: "Abonelik açıkken en az bir ödeme yöntemi seçin.", path: ["allowedMethods"] });
    }
  });

// ---------------------------------------------------------------------------------------------------
// giftWheel (day 6, CORE; the Hediye Çarkı page saves it with minRole "editor"). Every range rule of
// contract §1.1, with the numbers from WHEEL_LIMITS so the storefront schema and the panel never disagree.

const L = WHEEL_LIMITS;

/** A localized override that may be left empty (→ undefined: the UI dictionary's default text is used). */
const wheelTextInput = (max: number) => optionalLocalizedTextOf({ max }).transform((v) => v ?? undefined);
/** Datetime-local (read as Istanbul time) or ISO → stored as an ISO string; empty → null. */
const wheelInstantInput = dateTimeInput.transform((d) => (d ? d.toISOString() : null));

export const WHEEL_SLICE_KEY_MESSAGE = "Dilim anahtarı yalnızca küçük harf (a–z), rakam ve tire içerebilir; en fazla 24 karakter.";

type WheelSliceValueShape = { type: (typeof WHEEL_PRIZE_TYPES)[number]; value?: number | string | null };

/** Checks `value` against the prize type and replaces it with the number to store (free shipping → 0). */
function refineWheelSliceValue<T extends WheelSliceValueShape>(v: T, ctx: z.RefinementCtx): Omit<T, "value"> & { value: number } {
  if (v.type === "free_shipping") return { ...v, value: 0 };
  if (v.type === "percent") {
    const n = typeof v.value === "number" ? v.value : typeof v.value === "string" && v.value.trim() ? Number(v.value.trim()) : Number.NaN;
    if (!Number.isInteger(n) || n < L.percent.min || n > L.percent.max) {
      ctx.addIssue({ code: "custom", path: ["value"], message: `İndirim oranı ${L.percent.min} ile ${L.percent.max} arasında tam sayı olmalı.` });
      return z.NEVER;
    }
    return { ...v, value: n };
  }
  const parsed = kurusInput.safeParse(v.value ?? "");
  if (!parsed.success || parsed.data < L.fixedMin) {
    ctx.addIssue({ code: "custom", path: ["value"], message: `İndirim tutarı en az ${L.fixedMin / 100} TL olmalı.` });
    return z.NEVER;
  }
  return { ...v, value: parsed.data };
}

export const giftWheelSliceInput = z
  .object({
    key: z
      .string({ error: WHEEL_SLICE_KEY_MESSAGE })
      .trim()
      .toLowerCase()
      .regex(WHEEL_SLICE_KEY_PATTERN, WHEEL_SLICE_KEY_MESSAGE),
    label: localizedTextOf({ max: L.labelMax, requiredMessage: "Dilimin Türkçe metnini girin (ör. %10 indirim)." }),
    type: z.enum(WHEEL_PRIZE_TYPES, { error: "Ödül türünü seçin." }),
    /** Percent (1–50) for "percent", kuruş (number) or a TL amount ("50,00") for "fixed", ignored for "free_shipping". */
    value: z.union([z.number(), z.string(), z.null()]).optional(),
    minOrderTotal: kurusInput,
    weight: int(L.weight.min, L.weight.max, "Şans ağırlığı"),
    tone: z.enum(WHEEL_TONES, { error: "Dilim rengini seçin." }),
  })
  .transform(refineWheelSliceValue);

export const giftWheelSettingsInput = z
  .object({
    enabled: z.boolean({ error: "Geçersiz değer." }),
    startsAt: wheelInstantInput,
    endsAt: wheelInstantInput,
    audience: z.enum(WHEEL_AUDIENCES, { error: "Çarkı kimlerin göreceğini seçin." }),
    showToBusiness: z.boolean({ error: "Geçersiz değer." }),
    slices: z
      .array(giftWheelSliceInput, { error: "Dilim listesi geçersiz." })
      .min(L.slices.min, `Çarkta en az ${L.slices.min} dilim olmalı.`)
      .max(L.slices.max, `Çarkta en fazla ${L.slices.max} dilim olabilir.`)
      .superRefine((list, ctx) => {
        const seen = new Set<string>();
        list.forEach((slice, i) => {
          if (seen.has(slice.key)) ctx.addIssue({ code: "custom", message: "Bu anahtar başka bir dilimde kullanılıyor.", path: [i, "key"] });
          seen.add(slice.key);
        });
      }),
    validityHours: int(L.validityHours.min, L.validityHours.max, "Geçerlilik süresi (saat)"),
    holdDays: int(L.holdDays.min, L.holdDays.max, "Bekletme süresi (gün)"),
    teaserDelaySeconds: int(L.teaserDelaySeconds.min, L.teaserDelaySeconds.max, "Düğme gecikmesi (saniye)"),
    autoOpenSeconds: int(L.autoOpenSeconds.min, L.autoOpenSeconds.max, "Otomatik açılma süresi (saniye)"),
    exitIntent: z.boolean({ error: "Geçersiz değer." }),
    autoOpenCooldownDays: int(L.autoOpenCooldownDays.min, L.autoOpenCooldownDays.max, "Tekrar açılma aralığı (gün)"),
    round: int(L.round.min, L.round.max, "Tur numarası"),
    texts: z
      .object({
        title: wheelTextInput(L.text.title),
        subtitle: wheelTextInput(L.text.subtitle),
        teaser: wheelTextInput(L.text.teaser),
        claimCta: wheelTextInput(L.text.claimCta),
        registerCta: wheelTextInput(L.text.registerCta),
        signInCta: wheelTextInput(L.text.signInCta),
      })
      .prefault({}),
    reminderEnabled: z.boolean({ error: "Geçersiz değer." }),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) {
      ctx.addIssue({ code: "custom", message: "Bitiş zamanı başlangıçtan sonra olmalı.", path: ["endsAt"] });
    }
  });

// ---------------------------------------------------------------------------------------------------
// Registry

export const SETTINGS_INPUTS = {
  general: generalSettingsInput,
  shipping: shippingSettingsInput,
  payments: paymentSettingsInput,
  seo: seoSettingsInput,
  locales: localeSettingsInput,
  b2b: b2bSettingsInput,
  samples: sampleSettingsInput,
  newsletter: newsletterSettingsInput,
  whatsapp: whatsappSettingsInput,
  emails: emailSettingsInput,
  reviews: reviewSettingsInput,
  subscriptions: subscriptionSettingsInput,
  giftWheel: giftWheelSettingsInput,
} as const satisfies Record<SettingsKey, z.ZodType>;

export type SettingsInput<K extends SettingsKey> = z.output<(typeof SETTINGS_INPUTS)[K]>;

/** Compile-time guard: every panel schema produces a value of the storefront's settings type. */
type Fits<T extends U, U> = T;
export type SettingsInputsFit = [
  Fits<SettingsInput<"general">, Settings<"general">>,
  Fits<SettingsInput<"shipping">, Settings<"shipping">>,
  Fits<SettingsInput<"payments">, Settings<"payments">>,
  Fits<SettingsInput<"seo">, Settings<"seo">>,
  Fits<SettingsInput<"locales">, Settings<"locales">>,
  Fits<SettingsInput<"b2b">, Settings<"b2b">>,
  Fits<SettingsInput<"samples">, Settings<"samples">>,
  Fits<SettingsInput<"newsletter">, Settings<"newsletter">>,
  Fits<SettingsInput<"whatsapp">, Settings<"whatsapp">>,
  Fits<SettingsInput<"emails">, Settings<"emails">>,
  Fits<SettingsInput<"reviews">, Settings<"reviews">>,
  Fits<SettingsInput<"subscriptions">, Settings<"subscriptions">>,
  Fits<SettingsInput<"giftWheel">, Settings<"giftWheel">>,
];

/** Action payload: the settings fields at the top level (so error paths match the form) plus `updatedAt`. */
export function settingsPayloadSchema<K extends SettingsKey>(key: K) {
  const base = SETTINGS_INPUTS[key] as unknown as z.ZodType<SettingsInput<K>>;
  return z
    .looseObject({ updatedAt: settingsVersionInput })
    .transform(async (raw, ctx) => {
      const { updatedAt: _version, ...fields } = raw as Record<string, unknown>;
      void _version;
      const parsed = await base.safeParseAsync(fields);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
        return z.NEVER;
      }
      return { value: parsed.data, updatedAt: raw.updatedAt };
    });
}
