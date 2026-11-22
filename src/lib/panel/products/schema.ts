// Zod schemas for the product actions. Pure (zod + pure helpers): the editor runs the same schema on
// the client before sending, the action runs it again on the server. Rules that need the database
// (SKU/barcode uniqueness across products, ids that belong to the product, references) live in the
// service. Messages are Turkish and land next to the field (dotted paths such as "variants.2.price").
import { z } from "zod";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { isValidEan13 } from "@/lib/panel/format";
import {
  idInput,
  kurusInput,
  localizedTextOf,
  mediaIdInput,
  optionalHexColorInput,
  optionalLocalizedTextOf,
  percentInputRange,
  positiveKurusInput,
  slugInput,
  textInput,
  updatedAtInput,
} from "@/lib/panel/schemas";
import { comboId, VAT_RATES } from "./types";

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export const PRODUCT_TYPES = ["standard", "bundle", "sample"] as const;
export const MEDIA_ROLES = ["gallery", "lifestyle", "hero", "packshot"] as const;
export const OPTION_DISPLAYS = ["buttons", "swatches", "select"] as const;

export const MAX_VARIANTS = 100;
export const MAX_OPTIONS = 4;
export const MAX_OPTION_VALUES = 30;

const keyInput = z
  .string({ error: "Geçersiz satır." })
  .min(1, "Geçersiz satır.")
  .max(64, "Geçersiz satır.")
  .regex(/^[A-Za-z0-9_-]+$/, "Geçersiz satır.");

const nullableId = z.union([z.null(), idInput]);

/** Whole number in [min, max]; `nullable` turns null into an allowed value. */
function intIn(min: number, max: number, label: string) {
  return z
    .number({ error: `${label} girin.` })
    .int(`${label} tam sayı olmalı.`)
    .min(min, `${label} en az ${min.toLocaleString("tr-TR")} olmalı.`)
    .max(max, `${label} en fazla ${max.toLocaleString("tr-TR")} olabilir.`);
}
const nullableInt = (min: number, max: number, label: string) =>
  z.union([z.null(), intIn(min, max, label)]).optional().transform((v) => v ?? null);

const nullableKurus = z
  .union([z.null(), z.literal(""), kurusInput])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/** Rich text per locale, sanitized with the storefront's sanitizer; empty → null. */
const optionalRichText = z
  .union([z.object({ tr: z.string().optional(), en: z.string().optional(), ar: z.string().optional() }), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const clean = (s: string | undefined) => {
      const html = sanitizeHtml(s ?? "").trim();
      // An editor that was emptied leaves "<p></p>" or "<p><br></p>" behind.
      return html.replace(/<p>(\s|<br\s*\/?>|&nbsp;)*<\/p>/gi, "").trim() ? html : "";
    };
    const tr = clean(v.tr);
    const en = clean(v.en);
    const ar = clean(v.ar);
    for (const [locale, html] of [["tr", tr], ["en", en], ["ar", ar]] as const) {
      if (html.length > 50_000) {
        ctx.addIssue({ code: "custom", message: "Açıklama çok uzun (en fazla 50.000 karakter).", path: [locale] });
        return z.NEVER;
      }
    }
    if (!tr && !en && !ar) return null;
    if (!tr) {
      ctx.addIssue({ code: "custom", message: "Önce Türkçe metni girin.", path: ["tr"] });
      return z.NEVER;
    }
    return { tr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) };
  });

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

export const skuInput = z
  .string({ error: "SKU girin." })
  .trim()
  .toUpperCase()
  .min(2, "SKU en az 2 karakter olmalı.")
  .max(40, "SKU en fazla 40 karakter olabilir.")
  .regex(SKU_PATTERN, "SKU yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.");

export const barcodeInput = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? v.replace(/\s+/g, "") : ""))
  .refine((v) => v === "" || isValidEan13(v), "Barkod geçerli bir EAN-13 değil (13 hane, son hane kontrol hanesi).")
  .transform((v) => (v === "" ? null : v));

const variantSchema = z.object({
  key: keyInput,
  id: nullableId,
  sku: skuInput,
  barcode: barcodeInput,
  price: z.union([z.null(), kurusInput]).transform((v, ctx) => {
    if (v === null) {
      ctx.addIssue({ code: "custom", message: "Fiyat girin." });
      return z.NEVER;
    }
    return v;
  }),
  compareAtPrice: nullableKurus,
  costPrice: nullableKurus,
  vatRate: z
    .number({ error: "KDV oranı seçin." })
    .refine((v) => (VAT_RATES as readonly number[]).includes(v), "KDV oranı %0, %1, %10 veya %20 olabilir."),
  stock: intIn(-1_000_000, 1_000_000, "Stok"),
  stockSeen: z.union([z.null(), z.number().int()]),
  trackStock: z.boolean(),
  allowBackorder: z.boolean(),
  lowStockThreshold: intIn(0, 100_000, "Düşük stok eşiği"),
  volumeMl: nullableInt(1, 1_000_000, "Hacim"),
  weightGrams: nullableInt(1, 1_000_000, "Ağırlık"),
  desi: nullableInt(0, 100_000, "Desi"),
  minQuantity: intIn(1, 10_000, "En az adet"),
  maxQuantity: nullableInt(1, 100_000, "En çok adet"),
  imageId: mediaIdInput,
  isDefault: z.boolean(),
  isActive: z.boolean(),
  optionValueKeys: z.array(keyInput).max(MAX_OPTIONS),
});

const optionValueSchema = z.object({
  key: keyInput,
  id: nullableId,
  value: localizedTextOf({ max: 80, requiredMessage: "Değerin Türkçe adını girin." }),
  swatchColor: optionalHexColorInput,
  swatchMediaId: mediaIdInput,
});

const optionSchema = z.object({
  key: keyInput,
  id: nullableId,
  name: localizedTextOf({ max: 60, requiredMessage: "Seçeneğin Türkçe adını girin (ör. Ambalaj)." }),
  display: z.enum(OPTION_DISPLAYS, { error: "Görünüm seçin." }),
  values: z.array(optionValueSchema).min(1, "En az bir değer ekleyin.").max(MAX_OPTION_VALUES, `En fazla ${MAX_OPTION_VALUES} değer eklenebilir.`),
});

const mediaRowSchema = z.object({
  key: keyInput,
  id: nullableId,
  mediaId: idInput,
  role: z.enum(MEDIA_ROLES, { error: "Görsel rolü seçin." }),
  variantKey: z.union([z.null(), keyInput]),
  /** Day 6: videos only (the service stores false for images); missing = false. */
  autoplay: z.boolean({ error: "Geçersiz değer." }).optional().default(false),
});

const tierSchema = z.object({
  key: keyInput,
  variantKey: z.union([z.null(), keyInput]),
  groupId: nullableId,
  minQuantity: intIn(2, 100_000, "En az adet"),
  discountPercent: percentInputRange(1, 90),
});

const groupPriceSchema = z.object({
  key: keyInput,
  variantKey: keyInput,
  groupId: z.union([z.null(), idInput]).transform((v, ctx) => {
    if (v === null) {
      ctx.addIssue({ code: "custom", message: "Müşteri grubu seçin." });
      return z.NEVER;
    }
    return v;
  }),
  price: z.union([z.null(), positiveKurusInput]).transform((v, ctx) => {
    if (v === null) {
      ctx.addIssue({ code: "custom", message: "Fiyat girin." });
      return z.NEVER;
    }
    return v;
  }),
});

const bundleItemSchema = z.object({
  key: keyInput,
  variantId: z.union([z.null(), idInput]).transform((v, ctx) => {
    if (v === null) {
      ctx.addIssue({ code: "custom", message: "Setteki ürünü seçin." });
      return z.NEVER;
    }
    return v;
  }),
  quantity: intIn(1, 99, "Adet"),
});

const specSchema = z.object({
  label: localizedTextOf({ max: 80, requiredMessage: "Özelliğin Türkçe adını girin." }),
  value: localizedTextOf({ max: 300, requiredMessage: "Özelliğin Türkçe değerini girin." }),
});

const short = optionalLocalizedTextOf({ max: 300 });
const long = optionalLocalizedTextOf({ max: 4000 });

export const productSaveSchema = z
  .object({
    id: idInput,
    updatedAt: updatedAtInput,
    slug: slugInput,
    type: z.enum(PRODUCT_TYPES, { error: "Ürün türü seçin." }),
    status: z.enum(PRODUCT_STATUSES, { error: "Durum seçin." }),
    name: localizedTextOf({ max: 120, requiredMessage: "Ürünün Türkçe adını girin." }),
    subtitle: optionalLocalizedTextOf({ max: 120 }),
    shortDescription: short,
    description: optionalRichText,
    categoryId: nullableId,
    isFeatured: z.boolean(),
    businessOnly: z.boolean(),
    allowSubscription: z.boolean(),
    accentColor: optionalHexColorInput,
    tint: optionalHexColorInput,
    tintDark: optionalHexColorInput,
    scentTop: optionalLocalizedTextOf({ max: 200 }),
    scentHeart: optionalLocalizedTextOf({ max: 200 }),
    scentBase: optionalLocalizedTextOf({ max: 200 }),
    usage: long,
    warnings: long,
    ingredients: textInput({ required: false, max: 4000 }),
    claims: z.array(z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, "Geçersiz rozet.")).max(12).transform((v) => [...new Set(v)]),
    specs: z.array(specSchema).max(20, "En fazla 20 özellik satırı eklenebilir."),
    seo: z.object({
      title: optionalLocalizedTextOf({ max: 70 }),
      description: optionalLocalizedTextOf({ max: 170 }),
      ogImageId: mediaIdInput,
      noIndex: z.boolean(),
    }),
    options: z.array(optionSchema).max(MAX_OPTIONS, `En fazla ${MAX_OPTIONS} seçenek eklenebilir.`),
    variants: z.array(variantSchema).min(1, "En az bir varyant gerekli.").max(MAX_VARIANTS, `En fazla ${MAX_VARIANTS} varyant olabilir.`),
    media: z.array(mediaRowSchema).max(60, "En fazla 60 görsel eklenebilir."),
    tiers: z.array(tierSchema).max(50, "En fazla 50 adet indirimi eklenebilir."),
    groupPrices: z.array(groupPriceSchema).max(300),
    bundleItems: z.array(bundleItemSchema).max(30, "Bir sette en fazla 30 ürün olabilir."),
    relatedIds: z.array(idInput).max(12, "En fazla 12 ilişkili ürün seçebilirsiniz.").transform((v) => [...new Set(v)]),
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", message, path });

    // Variants: prices, quantities, SKUs unique (case-insensitive) within the product.
    const skus = new Map<string, number>();
    const barcodes = new Map<string, number>();
    p.variants.forEach((v, i) => {
      if (p.type !== "sample" && v.price <= 0) issue(["variants", i, "price"], "Fiyat sıfırdan büyük olmalı.");
      if (v.maxQuantity !== null && v.maxQuantity < v.minQuantity) issue(["variants", i, "maxQuantity"], "En çok adet, en az adetten küçük olamaz.");
      const sku = v.sku.toUpperCase();
      if (skus.has(sku)) issue(["variants", i, "sku"], "Bu SKU başka bir varyantta da var.");
      else skus.set(sku, i);
      if (v.barcode) {
        if (barcodes.has(v.barcode)) issue(["variants", i, "barcode"], "Bu barkod başka bir varyantta da var.");
        else barcodes.set(v.barcode, i);
      }
    });

    // Exactly one default, and it is active.
    const defaults = p.variants.map((v, i) => (v.isDefault ? i : -1)).filter((i) => i >= 0);
    if (defaults.length !== 1) issue(["variants"], defaults.length === 0 ? "Bir varsayılan varyant seçin." : "Yalnızca bir varyant varsayılan olabilir.");
    else if (!p.variants[defaults[0]].isActive) issue(["variants", defaults[0], "isDefault"], "Varsayılan varyant aktif olmalı.");

    // Option axes and values: unique keys, every active variant has exactly one value per axis.
    const valueOwner = new Map<string, number>();
    const optionKeys = new Set<string>();
    p.options.forEach((o, oi) => {
      if (optionKeys.has(o.key)) issue(["options", oi], "Geçersiz satır.");
      optionKeys.add(o.key);
      const names = new Set<string>();
      o.values.forEach((val, vi) => {
        if (valueOwner.has(val.key)) issue(["options", oi, "values", vi], "Geçersiz satır.");
        valueOwner.set(val.key, oi);
        const n = val.value.tr.toLocaleLowerCase("tr-TR");
        if (names.has(n)) issue(["options", oi, "values", vi, "value", "tr"], "Bu değer bu seçenekte zaten var.");
        names.add(n);
      });
    });
    const optionNames = new Set<string>();
    p.options.forEach((o, oi) => {
      const n = o.name.tr.toLocaleLowerCase("tr-TR");
      if (optionNames.has(n)) issue(["options", oi, "name", "tr"], "Bu adla başka bir seçenek var.");
      optionNames.add(n);
    });

    const activeCount = p.variants.filter((v) => v.isActive).length;
    if (p.options.length === 0 && p.variants.length > 1) {
      issue(["variants"], "Birden fazla varyant için önce bir seçenek ekleyin (ör. Ambalaj: 500 ml, 5 L).");
    }
    if (activeCount === 0) issue(["variants"], "En az bir varyant aktif olmalı.");

    const combos = new Map<string, number>();
    p.variants.forEach((v, i) => {
      const perOption = new Map<number, number>();
      let unknown = false;
      for (const key of v.optionValueKeys) {
        const oi = valueOwner.get(key);
        if (oi === undefined) unknown = true;
        else perOption.set(oi, (perOption.get(oi) ?? 0) + 1);
      }
      const path = ["variants", i, "optionValueKeys"];
      if (unknown) return issue(path, "Bu varyantın seçeneklerinden biri silinmiş. Yeni değer seçin.");
      if ([...perOption.values()].some((n) => n > 1)) return issue(path, "Her seçenekten yalnızca bir değer seçilebilir.");
      if (!v.isActive) return;
      if (perOption.size !== p.options.length) return issue(path, "Her seçenek için bir değer seçin.");
      if (p.options.length === 0) return;
      const id = comboId(v.optionValueKeys);
      if (combos.has(id)) issue(path, "Bu seçenek birleşimi başka bir varyantta da var.");
      else combos.set(id, i);
    });

    // Media rows: one row per image.
    const seenMedia = new Set<number>();
    const variantKeys = new Set(p.variants.map((v) => v.key));
    p.media.forEach((m, i) => {
      if (seenMedia.has(m.mediaId)) issue(["media", i, "mediaId"], "Bu görsel listede zaten var.");
      seenMedia.add(m.mediaId);
      if (m.variantKey && !variantKeys.has(m.variantKey)) issue(["media", i, "variantKey"], "Bağlı varyant artık yok; başka bir varyant seçin.");
    });

    // Tier prices: unique per scope + group + minimum quantity.
    const tierIds = new Set<string>();
    p.tiers.forEach((t, i) => {
      if (t.variantKey && !variantKeys.has(t.variantKey)) issue(["tiers", i, "variantKey"], "Seçilen varyant artık yok.");
      const id = `${t.variantKey ?? "*"}|${t.groupId ?? "*"}|${t.minQuantity}`;
      if (tierIds.has(id)) issue(["tiers", i, "minQuantity"], "Aynı kapsam ve grup için bu adet zaten tanımlı.");
      tierIds.add(id);
    });

    // Group prices: one per variant and group.
    const gpIds = new Set<string>();
    p.groupPrices.forEach((g, i) => {
      if (!variantKeys.has(g.variantKey)) issue(["groupPrices", i, "variantKey"], "Seçilen varyant artık yok.");
      const id = `${g.variantKey}|${g.groupId}`;
      if (gpIds.has(id)) issue(["groupPrices", i, "groupId"], "Bu varyant için bu grubun fiyatı zaten var.");
      gpIds.add(id);
    });

    // Bundles.
    if (p.type === "bundle") {
      const seen = new Set<number>();
      p.bundleItems.forEach((b, i) => {
        if (seen.has(b.variantId)) issue(["bundleItems", i, "variantId"], "Bu ürün sette zaten var; adedi artırın.");
        seen.add(b.variantId);
      });
      if (p.status === "active" && p.bundleItems.length === 0) issue(["bundleItems"], "Yayındaki bir setin en az bir ürünü olmalı.");
    }

    if (p.relatedIds.includes(p.id)) issue(["relatedIds"], "Ürün kendisiyle ilişkilendirilemez.");
  });

export type ProductSaveInput = z.output<typeof productSaveSchema>;

export const productCreateSchema = z.object({
  name: textInput({ max: 120, requiredMessage: "Ürünün Türkçe adını girin." }),
  type: z.enum(PRODUCT_TYPES, { error: "Ürün türü seçin." }),
  categoryId: nullableId,
});

export type ProductCreateInput = z.output<typeof productCreateSchema>;

export const productIdSchema = z.object({ id: idInput });

/** Delete sends the version the editor loaded: deleting from a stale view is a conflict. */
export const productDeleteSchema = z.object({ id: idInput, updatedAt: updatedAtInput });

export const bulkStatusSchema = z.object({
  ids: z.array(idInput).min(1, "Önce ürün seçin.").max(500).transform((v) => [...new Set(v)]),
  status: z.enum(PRODUCT_STATUSES, { error: "Durum seçin." }),
});

export const reorderSchema = z.object({
  ids: z.array(idInput).min(1).max(2000),
});

export const quickStockSchema = z.object({
  productId: idInput,
  items: z
    .array(
      z.object({
        variantId: idInput,
        seenStock: z.number().int(),
        stock: intIn(0, 1_000_000, "Stok"),
      }),
    )
    .min(1, "Değişiklik yok.")
    .max(MAX_VARIANTS),
});

export type QuickStockInput = z.output<typeof quickStockSchema>;
