// Content schemas + panel metadata for every page-builder section. Kept free of React so the panel
// (including client-side editors) and seed scripts can import it without pulling in components.
import { z } from "zod";
import { CONTACT_SUBJECT_LABELS, CONTACT_SUBJECTS } from "@/lib/contact/subjects";
import { HREF_MESSAGE, isSafeHref } from "@/lib/safe-href";
import { localizedText } from "@/lib/settings/types";
import type { FieldSpec } from "./field-spec";

/** Media or product id. Seeded content may carry numeric strings, so coerce. */
const id = z.coerce.number().int().positive();
/** A missing reference (e.g. a deleted image) is null; list items with one are skipped when rendering. */
const optionalId = id.optional().nullable();
/** Id list that silently drops empty/invalid entries instead of failing the whole section. */
const idList = z
  .array(z.unknown())
  .transform((list) => list.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0));
const lt = localizedText;
/**
 * A stored link: /path (canonical Turkish), #anchor, https://, mailto: or tel: (src/lib/safe-href.ts).
 * The panel save and the storefront render both parse with these schemas, so an unsafe href never renders.
 */
const link = z.string().trim().min(1).refine((v) => isSafeHref(v), HREF_MESSAGE);
/** Optional link; "" (a cleared LinkInput) counts as no link. */
const optionalLink = z.union([z.literal(""), link]).optional();
/** Background video: a site path or an https:// URL. */
const videoUrl = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .refine((v) => (v.startsWith("/") || /^https:\/\//i.test(v)) && isSafeHref(v), "Video bağlantısı / veya https:// ile başlamalı."),
]);
const cta = z.object({ label: lt, href: link });
const percent = z.number().min(0).max(90);

export const heroSchema = z.object({
  eyebrow: lt.optional(),
  headline: lt,
  subline: lt.optional(),
  imageId: optionalId,
  /** Optional portrait crop for phones. */
  mobileImageId: optionalId,
  /**
   * Day 6: optional muted, looping background video from the media library (a video row; the save
   * refuses an image here). The image stays the cover and the LCP; this one wins over `videoUrl`.
   */
  videoMediaId: optionalId,
  /** Legacy (before day 6): a background video by URL (mp4/webm); used only when videoMediaId is empty. */
  videoUrl: videoUrl.optional(),
  primaryCta: cta.optional(),
  secondaryCta: cta.optional(),
  /** Darkening overlay strength in percent. */
  overlay: percent.default(35),
  align: z.enum(["start", "center"]).default("start"),
  height: z.enum(["full", "tall"]).default("full"),
  /**
   * "split": the copy sits on the page background, below the image on phones and beside it from
   * tablets up (best for 2:3 portrait sources). "full": the image is full-bleed behind the copy with a
   * contrast overlay (needs ≥1800 px wide images; set mobileImageId to a calm portrait crop).
   */
  layout: z.enum(["split", "full"]).default("split"),
});

export const scentShowcaseSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  intro: lt.optional(),
  ctaLabel: lt.default({ tr: "Keşfet", en: "Discover", ar: "اكتشف" }),
  items: z
    .array(
      z.object({
        productId: optionalId,
        /** Large image shown on the stage; defaults to the product's primary image. */
        imageId: optionalId,
        /** Short mood line under the name, e.g. "Sakin, kremsi, yumuşak". */
        tagline: lt.optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const featuredProductsSchema = z.object({
  eyebrow: lt.optional(),
  title: lt.optional(),
  intro: lt.optional(),
  /** Explicit products in this order; empty = all active products. */
  productIds: idList.default([]),
  limit: z.number().int().min(1).max(24).default(8),
  columns: z.union([z.literal(3), z.literal(4)]).default(4),
  viewAllCta: cta.optional(),
});

export const packagingSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  intro: lt.optional(),
  items: z
    .array(
      z.object({
        title: lt,
        /** Who it is for, e.g. "Ev ve misafir banyosu". */
        audience: lt,
        description: lt.optional(),
        imageId: optionalId,
        cta: cta.optional(),
      }),
    )
    .min(1)
    .max(4),
});

export const lifestyleGallerySchema = z.object({
  eyebrow: lt.optional(),
  title: lt.optional(),
  intro: lt.optional(),
  items: z
    .array(z.object({ imageId: optionalId, caption: lt.optional(), href: optionalLink }))
    .min(1)
    .max(12),
});

export const b2bCtaSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  body: lt.optional(),
  bullets: z.array(lt).max(6).default([]),
  cta: cta,
  secondaryCta: cta.optional(),
  imageId: optionalId,
});

export const sampleCtaSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  body: lt.optional(),
  note: lt.optional(),
  cta: cta,
  imageId: optionalId,
});

export const storySchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  /** Paragraphs separated by a blank line. */
  body: lt,
  imageId: optionalId,
  imagePosition: z.enum(["start", "end"]).default("start"),
  stats: z.array(z.object({ value: lt, label: lt })).max(4).default([]),
  signature: lt.optional(),
  cta: cta.optional(),
});

export const newsletterSchema = z.object({
  eyebrow: lt.optional(),
  /** Overrides messages.newsletter.title when set. */
  title: lt.optional(),
  body: lt.optional(),
  imageId: optionalId,
});

export const richTextSchema = z.object({
  eyebrow: lt.optional(),
  title: lt.optional(),
  /** Simple HTML per locale (p, h2–h4, strong, em, a, ul/ol/li, blockquote, hr); sanitized on render. */
  html: lt,
  width: z.enum(["narrow", "wide"]).default("narrow"),
});

export const imageBannerSchema = z.object({
  imageId: optionalId,
  mobileImageId: optionalId,
  eyebrow: lt.optional(),
  title: lt.optional(),
  body: lt.optional(),
  cta: cta.optional(),
  align: z.enum(["start", "center", "end"]).default("start"),
  overlay: percent.default(30),
  height: z.enum(["md", "lg"]).default("md"),
});

export const faqSchema = z.object({
  eyebrow: lt.optional(),
  title: lt.optional(),
  items: z.array(z.object({ question: lt, answer: lt })).min(1),
});

/** Shows the current version of a legal_documents row (kvkk, distance_sales, …) by key. */
export const legalDocumentSchema = z.object({
  key: z.string().min(1),
});

/**
 * Contact channels. The phone, e-mail, address, map link and WhatsApp number are read from settings
 * (general, whatsapp) at render time; the content only chooses which ones to show.
 */
export const contactInfoSchema = z.object({
  eyebrow: lt.optional(),
  title: lt.optional(),
  intro: lt.optional(),
  showPhone: z.boolean().default(true),
  showWhatsapp: z.boolean().default(true),
  showEmail: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  /** Optional opening hours (blank line = new paragraph); nothing is shown when empty. */
  hours: lt.optional(),
});

/** The contact form. `?konu=teklif|numune|genel|diger` preselects a subject on the client. */
export const contactFormSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  intro: lt.optional(),
  subjects: z
    .array(z.object({ key: z.enum(CONTACT_SUBJECTS), label: lt }))
    .min(1)
    .max(CONTACT_SUBJECTS.length)
    .refine((list) => new Set(list.map((s) => s.key)).size === list.length, "Her konu türü yalnızca bir kez eklenebilir."),
  /** Link of the KVKK notice under the form; "" falls back to the KVKK page. */
  privacyHref: optionalLink,
});

/**
 * Quote request form (REQUESTS; anchor #teklif). Requests land in the panel under Teklif Talepleri.
 * The product lines offer the listed products' variants; the texts beside the form are editable.
 */
export const quoteFormSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  intro: lt.optional(),
  /** Short "what happens next" points beside the form. */
  points: z.array(lt).max(5).default([]),
  /** Products offered in the product lines, in this order; empty = every active product. */
  productIds: idList.default([]),
  /** Visitors may add a free-text line for anything that is not in the list. */
  allowCustomLines: z.boolean().default(true),
  successTitle: lt.optional(),
  successText: lt.optional(),
  /** Link of the KVKK notice next to the consent box; "" falls back to the KVKK page. */
  privacyHref: optionalLink,
});

/**
 * Free sample request form (REQUESTS; anchor #numune-formu). Respects settings.samples.requestFormEnabled
 * (closedText is shown instead while it is off). Requests land in the panel under Numune Talepleri.
 */
export const sampleRequestFormSchema = z.object({
  eyebrow: lt.optional(),
  title: lt,
  intro: lt.optional(),
  points: z.array(lt).max(5).default([]),
  /** Products offered as checkboxes, in this order; empty = every active scent. */
  productIds: idList.default([]),
  successTitle: lt.optional(),
  successText: lt.optional(),
  /** Shown instead of the form while the sample request form is switched off in the settings. */
  closedText: lt.optional(),
  privacyHref: optionalLink,
});

/**
 * Day 6: a video from the media library with optional copy. `videoMediaId` is required in the panel
 * (its field spec; the save refuses an empty one) but optional here, so a new section's defaults parse
 * and a section whose video was removed renders nothing instead of failing the page.
 */
export const videoSectionSchema = z.object({
  eyebrow: lt.optional(),
  title: lt.optional(),
  /** Short text beside or above the video (blank line = new paragraph). */
  text: lt.optional(),
  videoMediaId: optionalId,
  /** Cover shown before the video plays; empty = the video's own cover image. */
  posterImageId: optionalId,
  /** "wide": the copy above a full-width video. "split": the video and the copy side by side from tablets up. */
  layout: z.enum(["wide", "split"]).default("wide"),
  /** "click_to_play": cover + play button, native controls with sound. "autoplay_muted": muted loop when in view, with a pause button. */
  playback: z.enum(["click_to_play", "autoplay_muted"]).default("click_to_play"),
});

export type HeroContent = z.output<typeof heroSchema>;
export type ScentShowcaseContent = z.output<typeof scentShowcaseSchema>;
export type FeaturedProductsContent = z.output<typeof featuredProductsSchema>;
export type PackagingContent = z.output<typeof packagingSchema>;
export type LifestyleGalleryContent = z.output<typeof lifestyleGallerySchema>;
export type B2bCtaContent = z.output<typeof b2bCtaSchema>;
export type SampleCtaContent = z.output<typeof sampleCtaSchema>;
export type StoryContent = z.output<typeof storySchema>;
export type NewsletterContent = z.output<typeof newsletterSchema>;
export type RichTextContent = z.output<typeof richTextSchema>;
export type ImageBannerContent = z.output<typeof imageBannerSchema>;
export type FaqContent = z.output<typeof faqSchema>;
export type LegalDocumentContent = z.output<typeof legalDocumentSchema>;
export type ContactInfoContent = z.output<typeof contactInfoSchema>;
export type ContactFormContent = z.output<typeof contactFormSchema>;
export type QuoteFormContent = z.output<typeof quoteFormSchema>;
export type SampleRequestFormContent = z.output<typeof sampleRequestFormSchema>;
export type VideoSectionContent = z.output<typeof videoSectionSchema>;

type Meta<S extends z.ZodType> = {
  /** Turkish label shown in the panel's section picker. */
  label: string;
  /** One Turkish line under the label in the section picker. */
  description: string;
  schema: S;
  /** Starting content for a newly added section; must parse with `schema` (unit-tested). */
  defaults: z.input<S>;
  /**
   * How the panel edits the content: one spec per top-level schema key, in display order
   * (field-spec.ts; unit-tested: every schema key, nested repeater keys included, has a spec).
   */
  fields: FieldSpec[];
};

const meta = <S extends z.ZodType>(m: Meta<S>): Meta<S> => m;

const sampleText = (tr: string) => ({ tr });

// Field specs reused by several sections (Turkish panel copy).
const eyebrowField: FieldSpec = {
  key: "eyebrow",
  type: "localized",
  label: "Üst başlık",
  help: "Başlığın üstündeki küçük, aralıklı altın yazı. Boş bırakılabilir.",
  maxLength: 60,
};
const titleField = (required: boolean, help?: string): FieldSpec => ({ key: "title", type: "localized", label: "Başlık", required, help, maxLength: 120 });
const introField: FieldSpec = { key: "intro", type: "localizedLong", label: "Giriş metni", help: "Başlığın altında kısa bir paragraf.", rows: 3 };
const imageField = (help?: string, aspect?: string): FieldSpec => ({ key: "imageId", type: "media", label: "Görsel", help, aspect });
const mobileImageField: FieldSpec = {
  key: "mobileImageId",
  type: "media",
  label: "Telefon görseli",
  help: "İsteğe bağlı dikey kırpım; yalnızca telefonlarda ana görselin yerine gösterilir.",
  aspect: "2/3",
};
const overlayField = (help: string): FieldSpec => ({ key: "overlay", type: "percent", label: "Karartma", help, min: 0, max: 90 });

export const sectionMeta = {
  hero: meta({
    label: "Kapak (hero)",
    description: "Sayfanın en üstünde büyük görsel, başlık ve butonlar.",
    schema: heroSchema,
    defaults: { headline: sampleText("Başlık"), overlay: 35, align: "start", height: "full", layout: "split" },
    fields: [
      eyebrowField,
      { key: "headline", type: "localized", label: "Ana başlık", required: true, help: "Sayfanın en büyük yazısı; kısa ve akılda kalıcı tutun.", maxLength: 120 },
      { key: "subline", type: "localizedLong", label: "Alt metin", help: "Başlığın altında bir iki cümlelik açıklama.", rows: 3 },
      {
        key: "layout",
        type: "select",
        label: "Düzen",
        help: "Yan yana düzen dikey (2:3) görsellerle, tam ekran düzen en az 1800 px genişliğinde yatay görsellerle en iyi sonucu verir.",
        options: [
          { value: "split", label: "Yan yana: görsel ve metin ayrı" },
          { value: "full", label: "Tam ekran: metin görselin üstünde" },
        ],
      },
      imageField("Kapakta gösterilen ana görsel. Video eklerseniz video yüklenirken ve oynatılmadığında bu görsel görünür."),
      mobileImageField,
      {
        key: "videoMediaId",
        type: "media",
        accept: "video",
        label: "Arka plan videosu",
        help: "İsteğe bağlı: medya kütüphanesinden sessiz ve döngülü oynatılacak bir video. Sayfa yüklendikten sonra başlar; hareketi azaltma veya veri tasarrufu tercihi olan ziyaretçilerde başlamaz, yerine görsel görünür.",
        aspect: "16/9",
      },
      {
        key: "videoUrl",
        type: "text",
        label: "Video bağlantısı (eski yöntem)",
        help: "Yukarıda bir video seçtiyseniz kullanılmaz. Yalnızca kütüphane dışındaki bir mp4 veya webm dosyası için.",
        placeholder: "https://…/kapak.mp4",
      },
      { key: "primaryCta", type: "cta", label: "Birincil buton", optional: true },
      { key: "secondaryCta", type: "cta", label: "İkincil buton", optional: true },
      overlayField("Tam ekran düzende yazının okunması için görselin üstüne eklenen karartma."),
      {
        key: "align",
        type: "select",
        label: "Metin hizası",
        help: "Arapça sayfada yön otomatik olarak çevrilir.",
        options: [
          { value: "start", label: "Sola hizalı" },
          { value: "center", label: "Ortalı" },
        ],
      },
      {
        key: "height",
        type: "select",
        label: "Yükseklik",
        options: [
          { value: "full", label: "Tam ekran" },
          { value: "tall", label: "Uzun" },
        ],
      },
    ],
  }),
  scent_showcase: meta({
    label: "Koku vitrini",
    description: "Kokuları tek tek tanıtan, görselli ve etkileşimli vitrin.",
    schema: scentShowcaseSchema,
    defaults: { title: sampleText("Dört koku, tek imza"), items: [{ productId: null, imageId: null }] },
    fields: [
      eyebrowField,
      titleField(true),
      introField,
      {
        key: "ctaLabel",
        type: "localized",
        label: "Buton yazısı",
        help: "Seçili kokunun ürün sayfasına giden bağlantının yazısı, ör. “Keşfet”.",
        maxLength: 40,
      },
      {
        key: "items",
        type: "repeater",
        label: "Kokular",
        help: "Vitrinde sırayla gösterilir; en az 1, en fazla 8 koku.",
        itemLabel: "Koku",
        min: 1,
        max: 8,
        fields: [
          { key: "productId", type: "product", label: "Ürün", required: true, help: "Ürünü olmayan kokular sitede gösterilmez." },
          { key: "imageId", type: "media", label: "Sahne görseli", help: "Boş bırakılırsa ürünün ana görseli kullanılır.", aspect: "4/5" },
          { key: "tagline", type: "localized", label: "Kısa tanım", help: "Ürün adının altında görünen his cümlesi, ör. “Sakin, kremsi, yumuşak”.", maxLength: 80 },
        ],
      },
    ],
  }),
  featured_products: meta({
    label: "Öne çıkan ürünler",
    description: "Seçtiğiniz ürünlerden ya da tüm katalogdan bir ürün ızgarası.",
    schema: featuredProductsSchema,
    defaults: { title: sampleText("Koleksiyon"), productIds: [], limit: 8, columns: 4 },
    fields: [
      eyebrowField,
      titleField(false),
      introField,
      {
        key: "productIds",
        type: "products",
        label: "Ürünler",
        help: "Seçtiğiniz sırayla gösterilir. Boş bırakırsanız yayındaki tüm ürünler gösterilir.",
        max: 24,
      },
      { key: "limit", type: "number", label: "En fazla ürün", help: "Izgarada gösterilecek en fazla ürün sayısı.", min: 1, max: 24, step: 1, suffix: "ürün" },
      {
        key: "columns",
        type: "select",
        label: "Sütun sayısı",
        help: "Geniş ekranlarda bir satırdaki ürün sayısı; telefonda ürünler alt alta dizilir.",
        options: [
          { value: 4, label: "4 sütun" },
          { value: 3, label: "3 sütun" },
        ],
      },
      { key: "viewAllCta", type: "cta", label: "“Tümünü gör” butonu", optional: true },
    ],
  }),
  packaging: meta({
    label: "Ambalaj seçenekleri",
    description: "Ambalaj boylarını ve kimler için uygun olduklarını kartlarla anlatır.",
    schema: packagingSchema,
    defaults: {
      title: sampleText("Her ihtiyaca bir boy"),
      items: [{ title: sampleText("Ambalaj adı"), audience: sampleText("Kimin için") }],
    },
    fields: [
      eyebrowField,
      titleField(true),
      introField,
      {
        key: "items",
        type: "repeater",
        label: "Ambalajlar",
        help: "En az 1, en fazla 4 kart.",
        itemLabel: "Ambalaj",
        min: 1,
        max: 4,
        fields: [
          { key: "title", type: "localized", label: "Ad", required: true, help: "Ambalajın adı veya hacmi.", maxLength: 60 },
          { key: "audience", type: "localized", label: "Kimin için", required: true, help: "Kısa kullanım alanı, ör. “Ev ve misafir banyosu”.", maxLength: 80 },
          { key: "description", type: "localizedLong", label: "Açıklama", rows: 3 },
          { key: "imageId", type: "media", label: "Görsel", aspect: "4/5" },
          { key: "cta", type: "cta", label: "Buton", optional: true },
        ],
      },
    ],
  }),
  lifestyle_gallery: meta({
    label: "Yaşam tarzı galerisi",
    description: "Ürünlerin kullanım anlarını gösteren görsel galerisi.",
    schema: lifestyleGallerySchema,
    defaults: { title: sampleText("Galeri"), items: [{ imageId: null }] },
    fields: [
      eyebrowField,
      titleField(false),
      introField,
      {
        key: "items",
        type: "repeater",
        label: "Görseller",
        help: "En az 1, en fazla 12 görsel. Görseli olmayan öğeler sitede gösterilmez.",
        itemLabel: "Görsel",
        min: 1,
        max: 12,
        fields: [
          { key: "imageId", type: "media", label: "Görsel", required: true },
          { key: "caption", type: "localized", label: "Alt yazı", maxLength: 120 },
          { key: "href", type: "link", label: "Bağlantı", help: "İsteğe bağlı: görsele tıklanınca açılacak sayfa." },
        ],
      },
    ],
  }),
  b2b_cta: meta({
    label: "Kurumsal çağrı",
    description: "Oteller, spa'lar, ofisler ve restoranlar için kurumsal satış çağrısı.",
    schema: b2bCtaSchema,
    defaults: { title: sampleText("İşletmeniz için"), bullets: [], cta: { label: sampleText("Kurumsal"), href: "/kurumsal" } },
    fields: [
      eyebrowField,
      titleField(true),
      { key: "body", type: "localizedLong", label: "Metin", rows: 4 },
      { key: "bullets", type: "localizedList", label: "Öne çıkan maddeler", help: "En fazla 6 kısa madde.", max: 6, itemLabel: "Madde" },
      { key: "cta", type: "cta", label: "Buton", required: true },
      { key: "secondaryCta", type: "cta", label: "İkinci buton", optional: true },
      imageField(undefined, "4/5"),
    ],
  }),
  sample_cta: meta({
    label: "Ücretsiz numune çağrısı",
    description: "Ziyaretçiyi ücretsiz numune istemeye yönlendiren çağrı alanı.",
    schema: sampleCtaSchema,
    defaults: { title: sampleText("Ücretsiz numune"), cta: { label: sampleText("Numune iste"), href: "/numune" } },
    fields: [
      eyebrowField,
      titleField(true),
      { key: "body", type: "localizedLong", label: "Metin", rows: 4 },
      { key: "note", type: "localized", label: "Not", help: "Butonun altında küçük harflerle görünen kısa not.", maxLength: 80 },
      { key: "cta", type: "cta", label: "Buton", required: true },
      imageField(undefined, "4/3"),
    ],
  }),
  story: meta({
    label: "Marka hikâyesi",
    description: "Görsel, metin ve rakamlarla marka hikâyesi.",
    schema: storySchema,
    defaults: { title: sampleText("Hikâyemiz"), body: sampleText("Metin"), imagePosition: "start", stats: [] },
    fields: [
      eyebrowField,
      titleField(true),
      { key: "body", type: "localizedLong", label: "Hikâye metni", required: true, help: "Paragrafları boş bir satırla ayırın.", rows: 8 },
      imageField(undefined, "4/5"),
      {
        key: "imagePosition",
        type: "select",
        label: "Görsel konumu",
        help: "Geniş ekranlarda geçerlidir; Arapça sayfada yön otomatik olarak çevrilir.",
        options: [
          { value: "start", label: "Görsel solda" },
          { value: "end", label: "Görsel sağda" },
        ],
      },
      {
        key: "stats",
        type: "repeater",
        label: "Rakamlar",
        help: "İsteğe bağlı; en fazla 4 rakam, ör. kuruluş yılı.",
        itemLabel: "Rakam",
        min: 0,
        max: 4,
        fields: [
          { key: "value", type: "localized", label: "Değer", required: true, maxLength: 20 },
          { key: "label", type: "localized", label: "Açıklama", required: true, maxLength: 60 },
        ],
      },
      { key: "signature", type: "localized", label: "İmza", help: "Metnin altındaki el yazısı tarzı satır, ör. kurucunun adı.", maxLength: 80 },
      { key: "cta", type: "cta", label: "Buton", optional: true },
    ],
  }),
  newsletter: meta({
    label: "Bülten kaydı",
    description: "Ziyaretçilerin e-bültene abone olduğu kayıt formu.",
    schema: newsletterSchema,
    defaults: {},
    fields: [
      eyebrowField,
      titleField(false, "Boş bırakılırsa Arayüz Metinleri'ndeki bülten başlığı kullanılır."),
      { key: "body", type: "localizedLong", label: "Metin", help: "Boş bırakılırsa Arayüz Metinleri'ndeki bülten açıklaması kullanılır.", rows: 3 },
      imageField(undefined, "4/3"),
    ],
  }),
  rich_text: meta({
    label: "Zengin metin",
    description: "Başlık, paragraf, liste ve alıntılardan oluşan serbest metin.",
    schema: richTextSchema,
    defaults: { html: sampleText("<p>Metin</p>"), width: "narrow" },
    fields: [
      eyebrowField,
      titleField(false),
      { key: "html", type: "localizedRich", label: "İçerik", required: true },
      {
        key: "width",
        type: "select",
        label: "Genişlik",
        options: [
          { value: "narrow", label: "Dar (rahat okunur)" },
          { value: "wide", label: "Geniş" },
        ],
      },
    ],
  }),
  image_banner: meta({
    label: "Görsel bant",
    description: "Üzerinde başlık ve buton olabilen geniş görsel bant.",
    schema: imageBannerSchema,
    defaults: { title: sampleText("Başlık"), align: "start", overlay: 30, height: "md" },
    fields: [
      imageField("Geniş, yatay bir görsel seçin (en az 1800 px).", "21/9"),
      mobileImageField,
      eyebrowField,
      titleField(false),
      { key: "body", type: "localizedLong", label: "Metin", rows: 3 },
      { key: "cta", type: "cta", label: "Buton", optional: true },
      {
        key: "align",
        type: "select",
        label: "Metin hizası",
        help: "Arapça sayfada yön otomatik olarak çevrilir.",
        options: [
          { value: "start", label: "Sola hizalı" },
          { value: "center", label: "Ortalı" },
          { value: "end", label: "Sağa hizalı" },
        ],
      },
      overlayField("Yazının okunması için görselin üstüne eklenen karartma."),
      {
        key: "height",
        type: "select",
        label: "Yükseklik",
        options: [
          { value: "md", label: "Orta" },
          { value: "lg", label: "Yüksek" },
        ],
      },
    ],
  }),
  faq: meta({
    label: "Sıkça sorulan sorular",
    description: "Açılıp kapanan soru–cevap listesi.",
    schema: faqSchema,
    defaults: { title: sampleText("Sıkça sorulanlar"), items: [{ question: sampleText("Soru"), answer: sampleText("Cevap") }] },
    fields: [
      eyebrowField,
      titleField(false),
      {
        key: "items",
        type: "repeater",
        label: "Sorular",
        help: "En az bir soru ekleyin.",
        itemLabel: "Soru",
        min: 1,
        fields: [
          { key: "question", type: "localized", label: "Soru", required: true, maxLength: 160 },
          { key: "answer", type: "localizedLong", label: "Cevap", required: true, help: "Paragrafları boş bir satırla ayırın.", rows: 4 },
        ],
      },
    ],
  }),
  legal_document: meta({
    label: "Yasal metin",
    description: "Bir yasal metnin güncel sürümünü sayfada gösterir.",
    schema: legalDocumentSchema,
    defaults: { key: "kvkk" },
    fields: [
      {
        key: "key",
        type: "select",
        label: "Yasal metin",
        required: true,
        help: "Seçilen metnin güncel sürümü gösterilir. Metinleri Yasal Metinler bölümünden düzenleyin.",
        options: [
          { value: "kvkk", label: "KVKK Aydınlatma Metni" },
          { value: "distance_sales", label: "Mesafeli Satış Sözleşmesi" },
          { value: "pre_information", label: "Ön Bilgilendirme Formu" },
          { value: "cookies", label: "Çerez Politikası" },
          { value: "returns", label: "İade ve Değişim Koşulları" },
          { value: "membership", label: "Üyelik Sözleşmesi" },
          { value: "wheel_terms", label: "Hediye Çarkı Kampanya Koşulları" },
        ],
      },
    ],
  }),
  contact_info: meta({
    label: "İletişim bilgileri",
    description: "Telefon, WhatsApp, e-posta ve adresi Ayarlar'daki güncel bilgilerle gösterir.",
    schema: contactInfoSchema,
    defaults: { showPhone: true, showWhatsapp: true, showEmail: true, showAddress: true },
    fields: [
      eyebrowField,
      titleField(false, "Boş bırakılabilir; sayfa başlığı zaten en üstte görünür."),
      introField,
      { key: "showPhone", type: "switch", label: "Telefonu göster", help: "Numara Ayarlar → Genel'den alınır." },
      {
        key: "showWhatsapp",
        type: "switch",
        label: "WhatsApp'ı göster",
        help: "Numara ve hazır mesaj Ayarlar → WhatsApp'tan alınır; WhatsApp kapalıysa gösterilmez.",
      },
      { key: "showEmail", type: "switch", label: "E-postayı göster", help: "Adres Ayarlar → Genel'den alınır; boşsa gösterilmez." },
      {
        key: "showAddress",
        type: "switch",
        label: "Adresi ve haritayı göster",
        help: "Adres ve harita bağlantısı Ayarlar → Genel'den alınır. Harita bağlantısı yoksa adres Google Haritalar'da açılır.",
      },
      {
        key: "hours",
        type: "localizedLong",
        label: "Çalışma saatleri",
        help: "İsteğe bağlı, ör. “Hafta içi 09.00–18.00”. Boş bırakılırsa gösterilmez.",
        rows: 3,
      },
    ],
  }),
  contact_form: meta({
    label: "İletişim formu",
    description: "Ziyaretçilerin konu seçip mesaj gönderdiği form; mesajlar panelde Mesajlar'a düşer.",
    schema: contactFormSchema,
    defaults: {
      title: sampleText("Bize yazın"),
      subjects: [
        { key: "general", label: sampleText("Genel soru") },
        { key: "quote", label: sampleText("Kurumsal teklif") },
        { key: "sample", label: sampleText("Numune talebi") },
        { key: "other", label: sampleText("Diğer") },
      ],
      privacyHref: "/sayfa/kvkk",
    },
    fields: [
      eyebrowField,
      titleField(true),
      introField,
      {
        key: "subjects",
        type: "repeater",
        label: "Konular",
        help: "Formdaki konu seçenekleri. ?konu=teklif bağlantısı “Teklif”, ?konu=numune bağlantısı “Numune” konusunu seçili açar.",
        itemLabel: "Konu",
        min: 1,
        max: CONTACT_SUBJECTS.length,
        fields: [
          {
            key: "key",
            type: "select",
            label: "Konu türü",
            required: true,
            help: "Mesajlar panelde bu türe göre süzülür. Her tür bir kez kullanılabilir.",
            options: CONTACT_SUBJECTS.map((value) => ({ value, label: CONTACT_SUBJECT_LABELS[value] })),
          },
          { key: "label", type: "localized", label: "Formda görünen ad", required: true, maxLength: 60 },
        ],
      },
      {
        key: "privacyHref",
        type: "link",
        label: "Aydınlatma metni bağlantısı",
        help: "Formun altındaki KVKK notunun bağlantısı. Boş bırakılırsa KVKK sayfası açılır.",
      },
    ],
  }),
  quote_form: meta({
    label: "Teklif talep formu",
    description: "İşletmelerin ürün ve adet seçerek teklif istediği form; talepler panelde Teklif Talepleri'ne düşer.",
    schema: quoteFormSchema,
    defaults: { title: sampleText("Teklif isteyin"), points: [], productIds: [], allowCustomLines: true, privacyHref: "/sayfa/kvkk" },
    fields: [
      eyebrowField,
      titleField(true),
      introField,
      {
        key: "points",
        type: "localizedList",
        label: "Süreç maddeleri",
        help: "Formun yanında onay işaretiyle listelenen kısa maddeler, ör. “Teklifimizi e-postayla göndeririz.” En fazla 5 madde.",
        max: 5,
        itemLabel: "Madde",
      },
      {
        key: "productIds",
        type: "products",
        label: "Listelenen ürünler",
        help: "Ürün satırlarında seçilebilecek ürünler, bu sırayla. Boş bırakırsanız yayındaki tüm ürünler (numuneler hariç) listelenir.",
        max: 24,
      },
      {
        key: "allowCustomLines",
        type: "switch",
        label: "Serbest satıra izin ver",
        help: "Açıkken ziyaretçi listede olmayan bir ürünü ya da ihtiyacı kendi cümlesiyle ve adediyle yazabilir.",
      },
      {
        key: "successTitle",
        type: "localized",
        label: "Gönderim sonrası başlık",
        help: "Talep gönderildikten sonra formun yerinde görünür. Boş bırakılırsa “Talebiniz bize ulaştı” yazar.",
        maxLength: 80,
      },
      {
        key: "successText",
        type: "localizedLong",
        label: "Gönderim sonrası metin",
        help: "Başlığın altındaki teşekkür metni. Boş bırakılırsa varsayılan metin gösterilir.",
        rows: 3,
      },
      {
        key: "privacyHref",
        type: "link",
        label: "Aydınlatma metni bağlantısı",
        help: "Onay kutusundaki KVKK bağlantısı. Boş bırakılırsa KVKK sayfası açılır.",
      },
    ],
  }),
  sample_request_form: meta({
    label: "Numune talep formu",
    description: "İşletmelerin ücretsiz numune istediği form; talepler panelde Numune Talepleri'ne düşer.",
    schema: sampleRequestFormSchema,
    defaults: { title: sampleText("Numune isteyin"), points: [], productIds: [], privacyHref: "/sayfa/kvkk" },
    fields: [
      eyebrowField,
      titleField(true),
      introField,
      {
        key: "points",
        type: "localizedList",
        label: "Süreç maddeleri",
        help: "Formun yanında onay işaretiyle listelenen kısa maddeler, ör. “Talebinizi inceleyip onaylarız.” En fazla 5 madde.",
        max: 5,
        itemLabel: "Madde",
      },
      {
        key: "productIds",
        type: "products",
        label: "Seçilebilecek ürünler",
        help: "Formda onay kutusu olarak gösterilen ürünler, bu sırayla. Boş bırakırsanız yayındaki tüm kokular listelenir; setler ve numune ürünleri listelenmez.",
        max: 12,
      },
      {
        key: "successTitle",
        type: "localized",
        label: "Gönderim sonrası başlık",
        help: "Talep gönderildikten sonra formun yerinde görünür. Boş bırakılırsa “Numune talebiniz alındı” yazar.",
        maxLength: 80,
      },
      {
        key: "successText",
        type: "localizedLong",
        label: "Gönderim sonrası metin",
        help: "Başlığın altındaki teşekkür metni. Boş bırakılırsa varsayılan metin gösterilir.",
        rows: 3,
      },
      {
        key: "closedText",
        type: "localizedLong",
        label: "Form kapalıyken gösterilecek metin",
        help: "Ayarlar → Numune'de numune talep formu kapatıldığında formun yerine bu metin ve iletişim bağlantısı görünür. Boş bırakılırsa varsayılan metin kullanılır.",
        rows: 3,
      },
      {
        key: "privacyHref",
        type: "link",
        label: "Aydınlatma metni bağlantısı",
        help: "Onay kutusundaki KVKK bağlantısı. Boş bırakılırsa KVKK sayfası açılır.",
      },
    ],
  }),
  video: meta({
    label: "Video",
    description: "Medya kütüphanesindeki bir videoyu isteğe bağlı başlık ve kısa metinle gösterir.",
    schema: videoSectionSchema,
    defaults: { layout: "wide", playback: "click_to_play" },
    fields: [
      eyebrowField,
      titleField(false),
      {
        key: "text",
        type: "localizedLong",
        label: "Metin",
        help: "Videonun yanında veya üstünde kısa bir açıklama. Boş bırakılabilir.",
        rows: 3,
      },
      {
        key: "videoMediaId",
        type: "media",
        accept: "video",
        label: "Video",
        required: true,
        help: "Medya kütüphanesindeki MP4 veya WebM videolardan seçin. Otomatik oynatmada video, bölüm ekrana gelince; tıklayınca oynatmada ziyaretçi oynat düğmesine basınca yüklenir.",
        aspect: "16/9",
      },
      {
        key: "posterImageId",
        type: "media",
        label: "Kapak görseli",
        help: "Video oynatılmadan önce görünür. Boş bırakılırsa videonun kendi kapak görseli kullanılır.",
        aspect: "16/9",
      },
      {
        key: "layout",
        type: "select",
        label: "Düzen",
        options: [
          { value: "wide", label: "Geniş: metin üstte, video tam genişlikte" },
          { value: "split", label: "Yan yana: video ve metin ayrı sütunlarda" },
        ],
      },
      {
        key: "playback",
        type: "select",
        label: "Oynatma",
        help: "Otomatik oynatma sessiz ve döngülüdür, ziyaretçi duraklatabilir. Hareketi azaltma veya veri tasarrufu tercihi olan ziyaretçilerde video kendiliğinden başlamaz.",
        options: [
          { value: "click_to_play", label: "Tıklayınca oynat (sesli, oynatma düğmeleriyle)" },
          { value: "autoplay_muted", label: "Otomatik oynat (sessiz, döngülü)" },
        ],
      },
    ],
  }),
} as const;

export type SectionType = keyof typeof sectionMeta;
export const sectionTypes = Object.keys(sectionMeta) as SectionType[];

export function isSectionType(value: string): value is SectionType {
  return Object.prototype.hasOwnProperty.call(sectionMeta, value);
}
