// Audit log vocabulary for /panel/islem-kaydi: Turkish labels for entities, actions and common fields,
// the panel page each entity lives on, and the before/after diff. Pure (no DB, no React), so the diff
// rules are unit-testable and usable on the server and the client.
import { ORDER_STATUS, PRODUCT_STATUS, PRODUCT_TYPE, ROLE_LABELS, type Tone } from "@/components/panel/labels";

export const ENTITY_LABELS: Record<string, string> = {
  product: "Ürün",
  product_variant: "Varyant",
  category: "Kategori",
  page: "Sayfa",
  page_section: "Sayfa bölümü",
  menu: "Menü",
  announcement: "Duyuru",
  theme: "Tema",
  ui_string: "Arayüz metni",
  settings: "Ayarlar",
  legal_document: "Yasal metin",
  campaign: "Kampanya",
  coupon: "Kupon",
  newsletter: "E-bülten",
  newsletter_subscriber: "E-bülten abonesi",
  media: "Medya",
  blog_post: "Blog yazısı",
  contact_message: "Mesaj",
  order: "Sipariş",
  // Team members and customers (B2B, accounts) share the Better Auth user table.
  user: "Kullanıcı",
  redirect: "Yönlendirme",
  // Day 4
  company: "Kurumsal hesap",
  customer_group: "Müşteri grubu",
  quote_request: "Teklif talebi",
  sample_request: "Numune talebi",
  review: "Yorum",
  subscription: "Abonelik",
  subscription_plan: "Abonelik planı",
  email_message: "E-posta",
  email_campaign: "E-posta kampanyası",
  job: "Zamanlanmış görev",
  // Day 6 (WHEEL-PANEL): winners CSV export of the gift wheel.
  wheel_spin: "Çark kazananları",
  // PayTR-fix IMPL-A2: refused PayTR notifications (system rows, src/lib/payments/alerts.ts).
  payment_notification: "PayTR bildirimi",
};

export const ACTION_LABELS: Record<string, { label: string; tone: Tone }> = {
  create: { label: "Oluşturdu", tone: "success" },
  update: { label: "Düzenledi", tone: "info" },
  delete: { label: "Sildi", tone: "danger" },
  publish: { label: "Yayınladı", tone: "success" },
  archive: { label: "Arşivledi", tone: "neutral" },
  duplicate: { label: "Kopyaladı", tone: "info" },
  upload: { label: "Yükledi", tone: "success" },
  move: { label: "Taşıdı", tone: "info" },
  reorder: { label: "Sıraladı", tone: "neutral" },
  status: { label: "Durum değiştirdi", tone: "warning" },
  export: { label: "Dışa aktardı", tone: "gold" },
  restore: { label: "Geri yükledi", tone: "info" },
  reset_password: { label: "Şifre sıfırladı", tone: "warning" },
  payment: { label: "Ödeme işlemi", tone: "gold" },
  run: { label: "Çalıştırdı", tone: "info" },
  // Day 6 (WHEEL-PANEL): "Yeni tur başlat" on the gift wheel settings.
  wheel_round: { label: "Yeni çark turu başlattı", tone: "warning" },
  // PayTR-fix IMPL-A2: the notify endpoint refused PayTR notifications (bad hash, missing fields, keys not configured).
  refused: { label: "Reddetti", tone: "danger" },
};

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? humanize(entity);
}

export function actionInfo(action: string): { label: string; tone: Tone } {
  return ACTION_LABELS[action] ?? { label: humanize(action), tone: "neutral" };
}

function humanize(key: string): string {
  const text = key.replace(/[_-]+/g, " ").trim();
  // Keys are ASCII identifiers: no Turkish casing (it would turn "id" into "İd" and "Id" into "ıd").
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

/** Turkish names for fields that appear in many audit rows; anything else is shown humanized. */
const FIELD_LABELS: Record<string, string> = {
  name: "Ad",
  title: "Başlık",
  subtitle: "Alt başlık",
  slug: "Kısa ad (URL)",
  status: "Durum",
  type: "Tür",
  role: "Rol",
  active: "Etkin",
  isActive: "Etkin",
  isVisible: "Görünür",
  published: "Yayında",
  isPublished: "Yayında",
  email: "E-posta",
  phone: "Telefon",
  price: "Fiyat",
  compareAtPrice: "Eski fiyat",
  stock: "Stok",
  sku: "SKU",
  barcode: "Barkod",
  position: "Sıra",
  description: "Açıklama",
  shortDescription: "Kısa açıklama",
  body: "Metin",
  content: "İçerik",
  text: "Metin",
  href: "Bağlantı",
  alt: "Alternatif metin",
  folder: "Klasör",
  categoryId: "Kategori",
  imageId: "Görsel",
  mediaIds: "Görseller",
  startsAt: "Başlangıç",
  endsAt: "Bitiş",
  priority: "Öncelik",
  value: "Değer",
  code: "Kod",
  version: "Sürüm",
  featured: "Öne çıkan",
  seo: "SEO",
  sections: "Bölümler",
  items: "Öğeler",
  variants: "Varyantlar",
  signedOutEverywhere: "Tüm oturumlar kapatıldı",
  key: "Anahtar",
  originalName: "Dosya adı",
  url: "Adres",
  rows: "Satır sayısı",
  children: "Alt bağlantılar",
  highlight: "Vurgulu",
  eyebrow: "Üst başlık",
  headline: "Ana başlık",
  subline: "Alt metin",
  cta: "Buton",
  question: "Soru",
  answer: "Cevap",
  audience: "Hedef kitle",
  // Keys written by the day-3 editors (settings, campaigns, coupons, blog, themes, inbox, media).
  id: "Kimlik",
  createdAt: "Oluşturulma",
  order: "Sıralama",
  label: "Etiket",
  locale: "Dil",
  subject: "Konu",
  isRead: "Okundu",
  tr: "Türkçe",
  en: "İngilizce",
  ar: "Arapça",
  excerpt: "Özet",
  authorName: "Yazar",
  coverId: "Kapak görseli",
  publishedAt: "Yayın tarihi",
  tags: "Etiketler",
  relatedProductIds: "İlgili ürünler",
  productIds: "Ürünler",
  categoryIds: "Kategoriler",
  customerGroupIds: "Müşteri grupları",
  discountPercent: "İndirim oranı",
  themeId: "Tema",
  maxUses: "Toplam kullanım sınırı",
  perCustomerLimit: "Müşteri başına sınır",
  usedCount: "Kullanım sayısı",
  minOrderTotal: "En düşük sepet tutarı",
  card: "Kart ile ödeme",
  bankTransfer: "Havale / EFT",
  paymentDays: "Havale ödeme süresi (gün)",
  cashOnDelivery: "Kapıda ödeme",
  paytrLogoImageId: "PayTR logosu",
  flatFee: "Kargo ücreti",
  freeThreshold: "Ücretsiz kargo sınırı",
  heavy: "Ağır gönderi ücreti",
  carriers: "Kargo firmaları",
  estimatedDays: "Tahmini teslim süresi",
  colors: "Renkler",
  dark: "Koyu görünüm",
  fonts: "Yazı tipleri",
  radius: "Köşe yuvarlaklığı",
  width: "Genişlik",
  height: "Yükseklik",
  bytes: "Dosya boyutu",
  // Day 6 (WHEEL-PANEL): the gift wheel settings document (settings key giftWheel) and its export.
  enabled: "Açık",
  showToBusiness: "Kurumsal müşterilere göster",
  slices: "Dilimler",
  weight: "Şans ağırlığı",
  tone: "Renk",
  validityHours: "Kod geçerlilik süresi (saat)",
  holdDays: "Alınmayan hediye bekleme süresi (gün)",
  teaserDelaySeconds: "Düğme gecikmesi (saniye)",
  autoOpenSeconds: "Kendiliğinden açılma (saniye)",
  exitIntent: "Sayfadan çıkarken aç",
  autoOpenCooldownDays: "Tekrar açılma aralığı (gün)",
  round: "Tur",
  texts: "Metinler",
  teaser: "Çark düğmesi",
  claimCta: "Hediyemi al düğmesi",
  registerCta: "Üye ol düğmesi",
  signInCta: "Giriş yap bağlantısı",
  reminderEnabled: "Hatırlatma e-postası",
  filter: "Filtre",
  // Day 6 (video): media rows, product gallery videos and the video section.
  autoplay: "Otomatik oynat (sessiz)",
  mime: "Dosya türü",
  durationMs: "Süre (ms)",
  posterId: "Kapak görseli",
  videoMediaId: "Video",
  posterImageId: "Kapak görseli",
  playback: "Oynatma",
  layout: "Yerleşim",
  kind: "Tür",
  reason: "Neden",
  // PayTR-fix IMPL-A2: refused PayTR notifications.
  count: "Sayı",
  firstAt: "İlk",
  lastAt: "Son",
  merchantOid: "PayTR sipariş no",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanize(key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
}

/**
 * Panel page for an audit row's record. Detail pages exist for products, categories, pages, blog posts,
 * orders and the day-4 records (companies, requests, subscriptions, e-mails, campaigns); other entities
 * link to their list page. Null when the entity has no panel page.
 */
export function entityHref(entity: string, entityId: string | null): string | null {
  const id = entityId && /^\d+$/.test(entityId) ? entityId : null;
  switch (entity) {
    case "product":
      return id ? `/panel/urunler/${id}` : "/panel/urunler";
    case "product_variant":
      return "/panel/urunler";
    case "category":
      return id ? `/panel/kategoriler/${id}` : "/panel/kategoriler";
    case "page":
    case "page_section":
      return entity === "page" && id ? `/panel/sayfalar/${id}` : "/panel/sayfalar";
    case "blog_post":
      return id ? `/panel/blog/${id}` : "/panel/blog";
    case "order":
      return id ? `/panel/siparisler/${id}` : "/panel/siparisler";
    case "menu":
      return "/panel/menuler";
    case "announcement":
      return "/panel/duyurular";
    case "theme":
      return "/panel/tema";
    case "ui_string":
      return "/panel/metinler";
    case "settings":
      // Day 6 (WHEEL-PANEL): the gift wheel has its own editor+ page instead of the admin settings.
      return entityId === "giftWheel" ? "/panel/hediye-carki/ayarlar" : "/panel/ayarlar";
    case "wheel_spin":
      return "/panel/hediye-carki/kazananlar";
    case "legal_document":
      return "/panel/yasal";
    case "campaign":
      return "/panel/kampanyalar";
    case "coupon":
      return "/panel/kuponlar";
    case "newsletter":
    case "newsletter_subscriber":
      return "/panel/e-bulten";
    case "media":
      return "/panel/medya";
    case "contact_message":
      return "/panel/mesajlar";
    case "user":
      return "/panel/ekip";
    case "company":
      return id ? `/panel/kurumsal-hesaplar/${id}` : "/panel/kurumsal-hesaplar";
    case "customer_group":
      return "/panel/kurumsal-hesaplar/gruplar";
    case "quote_request":
      return id ? `/panel/teklifler/${id}` : "/panel/teklifler";
    case "sample_request":
      return id ? `/panel/numune-talepleri/${id}` : "/panel/numune-talepleri";
    case "review":
      return "/panel/yorumlar";
    case "subscription":
      return id ? `/panel/abonelikler/${id}` : "/panel/abonelikler";
    case "subscription_plan":
      return "/panel/abonelikler/planlar";
    case "email_message":
      return id ? `/panel/e-postalar/${id}` : "/panel/e-postalar";
    case "email_campaign":
      return id ? `/panel/e-bulten/kampanyalar/${id}` : "/panel/e-bulten/kampanyalar";
    case "job":
      return "/panel";
    case "payment_notification":
      return "/panel/ayarlar/odeme";
    default:
      return null;
  }
}

/**
 * Turkish wording for well-known enum values (roles, product and order statuses, product types); null
 * when the value is not one of them (it is then shown as stored).
 */
export function enumValueLabel(key: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (key === "role") return ROLE_LABELS[value] ?? null;
  if (key === "status") return (PRODUCT_STATUS as Record<string, { label: string }>)[value]?.label ?? (ORDER_STATUS as Record<string, { label: string }>)[value]?.label ?? null;
  if (key === "type") return (PRODUCT_TYPE as Record<string, string>)[value] ?? null;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Diff

export type DiffKind = "added" | "removed" | "changed" | "same";
export type DiffRow = { key: string; label: string; before: unknown; after: unknown; kind: DiffKind };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Stable JSON (sorted keys) so key order never counts as a change. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

/**
 * Field-by-field comparison of an audit row's before/after (top-level keys). A create has only
 * `after` (every field "added"), a delete only `before` ("removed"). Non-object snapshots compare as one
 * "Değer" row. Changed rows come first, in the order the fields appear; unchanged rows last.
 */
export function diffAudit(before: unknown, after: unknown): DiffRow[] {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (!hasBefore && !hasAfter) return [];
  if ((hasBefore && !isPlainObject(before)) || (hasAfter && !isPlainObject(after))) {
    const kind: DiffKind = !hasBefore ? "added" : !hasAfter ? "removed" : sameValue(before, after) ? "same" : "changed";
    return [{ key: "value", label: "Değer", before: hasBefore ? before : undefined, after: hasAfter ? after : undefined, kind }];
  }
  const b = (hasBefore ? before : {}) as Record<string, unknown>;
  const a = (hasAfter ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const rows = keys.map((key): DiffRow => {
    const inBefore = key in b;
    const inAfter = key in a;
    const kind: DiffKind =
      !hasBefore || (!inBefore && inAfter)
        ? "added"
        : !hasAfter || (inBefore && !inAfter)
          ? "removed"
          : sameValue(b[key], a[key])
            ? "same"
            : "changed";
    return { key, label: fieldLabel(key), before: inBefore ? b[key] : undefined, after: inAfter ? a[key] : undefined, kind };
  });
  return [...rows.filter((r) => r.kind !== "same"), ...rows.filter((r) => r.kind === "same")];
}

export type LeafChange = { path: string; before: unknown; after: unknown };

/** A JSON value that AuditValue would print as raw JSON (objects and arrays that are not simple lists). */
export function isNestedValue(value: unknown): boolean {
  if (Array.isArray(value)) return !value.every((v) => typeof v === "string" || typeof v === "number");
  return isPlainObject(value) && !isLocalizedValue(value);
}

const LEAF_LIMIT = 40;

/**
 * The changed leaves between two nested values (menu items, section content, settings groups), each
 * with a readable Turkish path such as "2. öğe › Etiket › Türkçe". Arrays compare by position. At most
 * LEAF_LIMIT entries; `more` counts the rest.
 */
export function leafChanges(before: unknown, after: unknown): { changes: LeafChange[]; more: number } {
  const changes: LeafChange[] = [];
  let more = 0;
  const walk = (b: unknown, a: unknown, path: string[]) => {
    if (sameValue(b, a)) return;
    const bothArrays = Array.isArray(b) && Array.isArray(a);
    const bothObjects = isPlainObject(b) && isPlainObject(a) && !isLocalizedValue(b) && !isLocalizedValue(a);
    if (bothArrays) {
      const length = Math.max(b.length, a.length);
      for (let i = 0; i < length; i++) walk(b[i], a[i], [...path, `${i + 1}. öğe`]);
      return;
    }
    if (bothObjects || (isLocalizedValue(b) && isLocalizedValue(a))) {
      const bo = b as Record<string, unknown>;
      const ao = a as Record<string, unknown>;
      for (const key of new Set([...Object.keys(bo), ...Object.keys(ao)])) walk(bo[key], ao[key], [...path, fieldLabel(key)]);
      return;
    }
    if (changes.length >= LEAF_LIMIT) {
      more++;
      return;
    }
    changes.push({ path: path.join(" › ") || "Değer", before: b, after: a });
  };
  walk(before, after, []);
  return { changes, more };
}

/** A localized text value ({ tr, en?, ar? } with string values only). */
export function isLocalizedValue(value: unknown): value is { tr?: string; en?: string; ar?: string } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => (k === "tr" || k === "en" || k === "ar") && typeof value[k] === "string");
}

/** Short human name of the record from its snapshot (name, title, e-mail, code…), if any. */
export function auditSubject(before: unknown, after: unknown): string | null {
  for (const snapshot of [after, before]) {
    if (!isPlainObject(snapshot)) continue;
    for (const key of ["name", "title", "orderNumber", "code", "email", "label", "key", "originalName", "sku"]) {
      const v = snapshot[key];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
      if (isLocalizedValue(v) && v.tr?.trim()) return v.tr.trim().slice(0, 120);
    }
  }
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
export function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}
