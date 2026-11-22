// Every overridable UI text: the leaves of the built-in dictionaries (src/i18n/messages/*.ts), with
// Turkish group names for the panel. Pure; new message groups added by other features show up
// automatically (under their key until a Turkish name is added here).
import type { Locale } from "@/db/schema/common";
import { flattenMessages } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";

export const UI_STRING_LOCALES = ["tr", "en", "ar"] as const satisfies readonly Locale[];

/** Turkish names of the top-level message groups, in display order. */
export const UI_STRING_GROUP_LABELS: Record<string, string> = {
  common: "Genel",
  nav: "Menü ve gezinme",
  header: "Üst bölüm",
  footer: "Alt bilgi",
  announcement: "Duyuru şeridi",
  theme: "Açık / koyu görünüm",
  language: "Dil seçimi",
  search: "Arama",
  category: "Kategoriler ve listeler",
  product: "Ürün sayfası",
  review: "Ürün değerlendirmeleri",
  cart: "Sepet",
  campaign: "Kampanya fiyatları",
  wheel: "Hediye çarkı",
  checkout: "Ödeme adımları",
  order: "Sipariş sayfası",
  account: "Hesabım",
  auth: "Giriş ve üyelik",
  email: "E-posta metinleri",
  b2b: "Kurumsal",
  sample: "Numune",
  requests: "Teklif ve numune formları",
  newsletter: "E-bülten",
  contact: "İletişim",
  blog: "Blog",
  whatsapp: "WhatsApp",
  subscriptions: "Abonelik",
  errors: "Hata sayfaları ve uyarılar",
};

/** Turkish names of nested groups (second level), shown as sub-headings. */
export const UI_STRING_SUBGROUP_LABELS: Record<string, string> = {
  "footer.seller": "Satıcı bilgileri (alt bilgi ve iletişim bölümü)",
  // PayTR-fix IMPL-B (S7): {company} is the link to www.paytr.com and must stay in the text.
  "footer.paytr": "PayTR (kart ödeme sayfası ve, kart PayTR ile canlıyken, alt bilgi): “ödeme hizmetleri … tarafından sağlanmaktadır” yazısı",
  "product.claims": "Ürün iddiaları",
  "wheel.teaser": "Hediye çarkı düğmesi",
  "wheel.chip": "Hediye hatırlatıcısı (site geneli)",
  "wheel.dialog": "Çark penceresi",
  "wheel.result": "Çark sonucu",
  "wheel.claim": "Hediyeyi alma",
  "wheel.banner": "Üyelik ve giriş sayfası bilgi şeridi",
  "wheel.cart": "Sepette çark hediyesi",
  "wheel.account": "Hesabım: çark hediyesi kartı",
  "wheel.countdown": "Geri sayım",
  "wheel.prize": "Hediye adları (çevirisi olmayan dilimler için)",
  "wheel.errors": "Hediye çarkı uyarıları",
  "cart.summary": "Sepet özeti",
  "cart.samplesUnavailable": "Numune uyarıları",
  "cart.errors": "Sepet hataları",
  "cart.issues": "Sepet sorunları",
  "cart.notices": "Sepet bildirimleri",
  "checkout.paymentUnavailable": "Kullanılamayan ödeme yöntemleri",
  "checkout.errors": "Ödeme hataları",
  "checkout.legal": "Yasal onaylar",
  "checkout.page": "Sayfa başlıkları",
  "checkout.form": "Form alanları",
  "checkout.summary": "Sipariş özeti",
  "checkout.legalModal": "Yasal metin penceresi",
  "checkout.simulator": "Ödeme simülatörü",
  "checkout.cardPayment": "Kartla ödeme sayfası (PayTR)",
  "account.status": "Hesap durumları",
  "account.nav": "Hesap menüsü",
  "account.overview": "Hesabım ana sayfası",
  "account.orderList": "Siparişlerim",
  "account.addressBook": "Adreslerim",
  "account.profilePage": "Üyelik bilgilerim",
  "account.favoritesPage": "Favorilerim",
  "account.favorite": "Favori düğmesi",
  "account.createAccount": "Sipariş sonrası hesap oluşturma",
  "account.checkout": "Ödeme adımında hesap",
  "account.errors": "Hesap hataları",
  "auth.verify": "E-posta doğrulama sayfası",
  "auth.errors": "Giriş ve üyelik hataları",
  "auth.layout": "Giriş ve üyelik sayfaları (tanıtım alanı)",
  "auth.password": "Şifre alanı",
  "auth.signIn": "Giriş sayfası",
  "auth.register": "Üyelik sayfası",
  "auth.forgot": "Şifremi unuttum sayfası",
  "auth.reset": "Yeni şifre sayfası",
  "email.accounts": "Hesap e-postaları (hoş geldiniz, şifre değişti)",
  "email.layout": "E-posta alt bilgisi",
  "email.common": "Ortak e-posta metinleri",
  "email.accountVerify": "Hesap doğrulama e-postası",
  "email.passwordReset": "Şifre sıfırlama e-postası",
  "email.reviewRequest": "Değerlendirme isteği e-postası",
  "review.errors": "Değerlendirme formu hataları",
  "email.requests": "Teklif, numune ve mesaj e-postaları",
  "email.orders": "Sipariş e-postaları",
  "email.newsletter": "E-bülten e-postaları",
  "email.subscriptions": "Abonelik e-postaları",
  "email.wheel": "Hediye çarkı e-postaları",
  "subscriptions.choice": "Ürün sayfası: abonelik seçeneği",
  "subscriptions.cart": "Sepette abonelik",
  "subscriptions.account": "Aboneliklerim sayfası",
  "newsletter.confirmPage": "E-bülten onay sayfası",
  "newsletter.unsubscribePage": "E-bültenden ayrılma sayfası",
  "b2b.sectors": "Sektörler",
  "requests.sectors": "Sektörler",
  "requests.errors": "Form hataları",
  "requests.quote": "Teklif talep formu",
  "requests.sample": "Numune talep formu",
  "b2b.account": "Kurumsal hesap başvurusu",
  "b2b.price": "Kurumsal fiyat etiketi",
  "b2b.band": "Kurumsal hesap şeridi (/kurumsal)",
  "email.business": "Kurumsal hesap e-postaları",
  "order.hero": "Sipariş başlığı",
  "order.status": "Sipariş durumları",
  "order.statusInfo": "Durum açıklamaları",
  "order.timeline": "Sipariş geçmişi",
  "order.payment": "Ödeme bilgileri",
  "order.shipment": "Kargo bilgileri",
  "order.items": "Sipariş kalemleri",
  "order.details": "Sipariş ayrıntıları",
  "order.legal": "Yasal belgeler",
  "order.help": "Yardım",
  "order.notFound": "Sipariş bulunamadı",
  "order.lookup": "Sipariş sorgulama",
};

export type UiStringEntry = {
  /** Dotted key, e.g. "header.cart". */
  key: string;
  /** Top-level group key ("header"). */
  group: string;
  /** Second-level group key ("cart.errors") for nested keys, else null. */
  subgroup: string | null;
  /** Built-in texts per locale. */
  tr: string;
  en: string;
  ar: string;
};

export type UiStringGroup = { key: string; label: string; count: number };

let catalog: { entries: UiStringEntry[]; byKey: Map<string, UiStringEntry>; groups: UiStringGroup[] } | null = null;

function build() {
  const tr = flattenMessages(defaultMessages.tr);
  const en = flattenMessages(defaultMessages.en);
  const ar = flattenMessages(defaultMessages.ar);
  const entries: UiStringEntry[] = Object.keys(tr).map((key) => {
    const parts = key.split(".");
    return {
      key,
      group: parts[0],
      subgroup: parts.length > 2 ? `${parts[0]}.${parts[1]}` : null,
      tr: tr[key],
      en: en[key] ?? tr[key],
      ar: ar[key] ?? tr[key],
    };
  });
  const order = Object.keys(UI_STRING_GROUP_LABELS);
  const rank = (group: string) => {
    const i = order.indexOf(group);
    return i === -1 ? order.length : i;
  };
  // Stable: dictionary order inside a group, groups in the Turkish display order.
  entries.sort((a, b) => rank(a.group) - rank(b.group));
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
  const groups = [...counts].map(([key, count]) => ({ key, label: groupLabel(key), count }));
  return { entries, byKey: new Map(entries.map((e) => [e.key, e])), groups };
}

function getCatalog() {
  catalog ??= build();
  return catalog;
}

export function groupLabel(group: string): string {
  return UI_STRING_GROUP_LABELS[group] ?? group.charAt(0).toLocaleUpperCase("tr-TR") + group.slice(1);
}

export function subgroupLabel(subgroup: string): string {
  return UI_STRING_SUBGROUP_LABELS[subgroup] ?? subgroup.split(".").slice(1).join(" › ");
}

/** All overridable texts, grouped in display order. */
export function listUiStrings(): UiStringEntry[] {
  return getCatalog().entries;
}

export function listUiStringGroups(): UiStringGroup[] {
  return getCatalog().groups;
}

/** The built-in entry for a key, or undefined for unknown keys (and prototype names). */
export function findUiString(key: string): UiStringEntry | undefined {
  return getCatalog().byKey.get(key);
}
