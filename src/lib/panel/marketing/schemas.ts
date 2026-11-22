// Zod schemas for the marketing actions (campaigns, coupons, newsletter). Pure: usable on the client
// for pre-checks too. Messages are Turkish.
import { z } from "zod";
import { normalizeCouponCode } from "@/lib/coupons/eligibility";
import { WHEEL_CODE_PREFIX } from "@/lib/wheel/types";
import {
  idInput,
  kurusInput,
  optionalLocalizedTextOf,
  percentInputRange,
  scheduleInput,
  textInput,
  updatedAtInput,
} from "@/lib/panel/schemas";

/** Positive ids, de-duplicated, order kept. */
export function idListInput(max: number, message = `En fazla ${max} kayıt seçebilirsiniz.`) {
  return z
    .array(idInput, { error: "Geçersiz seçim." })
    .max(max, message)
    .transform((ids) => [...new Set(ids)]);
}

const wholeNumber = (message: string) => z.number({ error: message }).int(message);

// ---------------------------------------------------------------------------------------------------
// Campaigns

export const CAMPAIGN_PERCENT_MIN = 1;
export const CAMPAIGN_PERCENT_MAX = 90;
export const CAMPAIGN_LABEL_MAX = 32;
export const PRIORITY_MAX = 100;

const campaignFields = {
  name: textInput({ max: 120, requiredMessage: "Kampanyaya bir ad verin (yalnızca panelde görünür)." }),
  label: optionalLocalizedTextOf({ max: CAMPAIGN_LABEL_MAX }),
  discountPercent: percentInputRange(CAMPAIGN_PERCENT_MIN, CAMPAIGN_PERCENT_MAX),
  productIds: idListInput(500),
  categoryIds: idListInput(100),
  customerGroupIds: idListInput(50),
  schedule: scheduleInput,
  priority: wholeNumber("Öncelik tam sayı olmalı.").min(0, "Öncelik 0 ile 100 arasında olmalı.").max(PRIORITY_MAX, "Öncelik 0 ile 100 arasında olmalı."),
  isActive: z.boolean({ error: "Geçersiz değer." }),
  themeId: idInput.nullable().optional().transform((v) => v ?? null),
};

export const campaignCreateSchema = z.object(campaignFields);
export const campaignUpdateSchema = z.object({ id: idInput, updatedAt: updatedAtInput, ...campaignFields });
export type CampaignCreateInput = z.output<typeof campaignCreateSchema>;
export type CampaignUpdateInput = z.output<typeof campaignUpdateSchema>;

/** The fields the "affected prices" preview needs (the editor's unsaved state). */
export const campaignPreviewSchema = z.object({
  id: idInput.nullable().optional().transform((v) => v ?? null),
  discountPercent: percentInputRange(CAMPAIGN_PERCENT_MIN, CAMPAIGN_PERCENT_MAX),
  productIds: idListInput(500),
  categoryIds: idListInput(100),
  customerGroupIds: idListInput(50),
  schedule: scheduleInput,
  priority: wholeNumber("Öncelik tam sayı olmalı.").min(0).max(PRIORITY_MAX),
});
export type CampaignPreviewInput = z.output<typeof campaignPreviewSchema>;

export const recordRefSchema = z.object({ id: idInput, updatedAt: updatedAtInput.optional() });
export const toggleActiveSchema = z.object({ id: idInput, isActive: z.boolean({ error: "Geçersiz değer." }), updatedAt: updatedAtInput });

// ---------------------------------------------------------------------------------------------------
// Coupons

export const COUPON_TYPES = ["percent", "fixed", "free_shipping"] as const;
export const COUPON_CODE_MIN = 3;
export const COUPON_CODE_MAX = 32;
export const COUPON_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?$/;
export const COUPON_CODE_MESSAGE = "Kod yalnızca İngilizce büyük harf (A–Z), rakam, tire ve alt çizgi içerebilir; harf veya rakamla başlayıp bitmeli.";

/** Day 6: gift wheel prize codes ("CARK-XXXXXX") are issued by the wheel; panel codes may not start like them. */
export const WHEEL_CODE_RESERVED_MESSAGE = `“${WHEEL_CODE_PREFIX}” ile başlayan kodlar hediye çarkı ödüllerine ayrılmıştır. Başka bir kod seçin.`;

/** Upper-cased, spaces removed (the same normalisation checkout applies to a typed code). */
export const couponCodeInput = z
  .string({ error: "Kupon kodu girin." })
  .transform((v) => normalizeCouponCode(v))
  .pipe(
    z
      .string()
      .min(COUPON_CODE_MIN, `Kod en az ${COUPON_CODE_MIN} karakter olmalı.`)
      .max(COUPON_CODE_MAX, `Kod en fazla ${COUPON_CODE_MAX} karakter olabilir.`)
      .regex(COUPON_CODE_PATTERN, COUPON_CODE_MESSAGE)
      .refine((v) => !v.startsWith(WHEEL_CODE_PREFIX), WHEEL_CODE_RESERVED_MESSAGE),
  );

const optionalCount = (label: string) =>
  z
    .union([z.number({ error: `${label} tam sayı olmalı.` }), z.null()])
    .optional()
    .transform((v) => v ?? null)
    .pipe(z.number().int(`${label} tam sayı olmalı.`).min(1, `${label} en az 1 olmalı; sınırsız için boş bırakın.`).max(10_000_000, `${label} çok büyük.`).nullable());

const couponFields = {
  code: couponCodeInput,
  description: textInput({ required: false, max: 300 }),
  type: z.enum(COUPON_TYPES, { error: "İndirim türünü seçin." }),
  /** Percent (1–100) for "percent", kuruş for "fixed", ignored (stored as 0) for "free_shipping". */
  value: z.union([z.number(), z.string(), z.null()]).optional(),
  minOrderTotal: kurusInput,
  maxUses: optionalCount("Toplam kullanım limiti"),
  perCustomerLimit: optionalCount("Müşteri başına limit"),
  productIds: idListInput(500),
  categoryIds: idListInput(100),
  customerGroupIds: idListInput(50),
  schedule: scheduleInput,
  isActive: z.boolean({ error: "Geçersiz değer." }),
};

type CouponValueShape = { type: (typeof COUPON_TYPES)[number]; value?: number | string | null };

/** Checks `value` against the type and replaces it with the number to store. */
function refineCouponValue<T extends CouponValueShape>(v: T, ctx: z.RefinementCtx): Omit<T, "value"> & { value: number } {
  if (v.type === "free_shipping") return { ...v, value: 0 };
  if (v.type === "percent") {
    const n = typeof v.value === "number" ? v.value : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "İndirim oranı 1 ile 100 arasında tam sayı olmalı." });
      return z.NEVER;
    }
    return { ...v, value: n };
  }
  const parsed = kurusInput.safeParse(v.value ?? "");
  if (!parsed.success || parsed.data < 1) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "İndirim tutarını girin (sıfırdan büyük)." });
    return z.NEVER;
  }
  return { ...v, value: parsed.data };
}

export const couponCreateSchema = z.object(couponFields).transform(refineCouponValue);
export const couponUpdateSchema = z.object({ id: idInput, updatedAt: updatedAtInput, ...couponFields }).transform(refineCouponValue);
export type CouponCreateInput = z.output<typeof couponCreateSchema>;
export type CouponUpdateInput = z.output<typeof couponUpdateSchema>;

// ---------------------------------------------------------------------------------------------------
// Newsletter

export const SUBSCRIBER_STATUSES = ["pending", "active", "unsubscribed"] as const;
export const SUBSCRIBER_SOURCES = ["footer", "section", "popup", "checkout", "register", "profile", "wheel"] as const;
export const subscriberRefSchema = z.object({ id: idInput });
