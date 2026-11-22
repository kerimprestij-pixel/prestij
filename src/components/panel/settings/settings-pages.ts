// The settings screens under /panel/ayarlar: one page per settings key, in sub-navigation order.
// Pure (icons + strings): used by the sub-navigation, the overview and each page header.
import {
  Building2,
  CreditCard,
  FlaskConical,
  BriefcaseBusiness,
  Languages,
  Mail,
  MessageCircle,
  MessageSquareQuote,
  Repeat,
  Search,
  Send,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { Settings, SettingsKey } from "@/lib/settings/types";

export type SettingsPageMeta = {
  slug: string;
  key: SettingsKey;
  label: string;
  /** One line under the title and on the overview card. */
  description: string;
  icon: LucideIcon;
  /** Extra words owners search for in the command palette (Turkish, lower case). */
  keywords?: string;
};

export const SETTINGS_BASE = "/panel/ayarlar";

export const SETTINGS_PAGES: SettingsPageMeta[] = [
  {
    slug: "genel",
    key: "general",
    label: "Firma bilgileri",
    description: "Site adı, logolar, ticari unvan, vergi ve iletişim bilgileri, adres ve sosyal medya.",
    icon: Building2,
    keywords: "logo mersis vergi dairesi vergi no kep telefon e-posta adres harita instagram sosyal medya unvan",
  },
  {
    slug: "kargo",
    key: "shipping",
    label: "Kargo",
    description: "Kargo ücreti, ücretsiz kargo sınırı, ağır paket farkı, kargo firmaları ve teslim süresi.",
    icon: Truck,
    keywords: "ücretsiz kargo takip linki teslimat süre desi ağır",
  },
  {
    slug: "odeme",
    key: "payments",
    label: "Ödeme yöntemleri",
    description: "Kartla ödeme, havale/EFT hesapları ve indirimi, kapıda ödeme ücreti ve limiti.",
    icon: CreditCard,
    keywords: "iban banka hesap havale eft kapıda ödeme kredi kartı taksit",
  },
  {
    slug: "seo",
    key: "seo",
    label: "SEO ve paylaşım",
    description:
      "Varsayılan başlık, açıklama ve paylaşım görseli; arama motoru doğrulama kodları, iade politikası, Google ürün kategorisi ve site haritası adresleri.",
    icon: Search,
    keywords: "google başlık açıklama paylaşım görseli search console bing yandex doğrulama kodu merchant center ürün akışı iade site haritası sitemap indexnow",
  },
  {
    slug: "diller",
    key: "locales",
    label: "Diller",
    description: "Dil seçicide ve site haritasında sunulan diller.",
    icon: Languages,
  },
  {
    slug: "kurumsal",
    key: "b2b",
    label: "Kurumsal satış",
    description: "İşletme fiyatları, hesap onayı ve kurumsal müşteri grubu.",
    icon: BriefcaseBusiness,
  },
  {
    slug: "numune",
    key: "samples",
    label: "Numune",
    description: "Sepete eklenen ücretsiz numuneler ve numune talep bağlantıları.",
    icon: FlaskConical,
  },
  {
    slug: "bulten",
    key: "newsletter",
    label: "E-bülten",
    description: "Alt bilgideki abonelik formu ve davet metni.",
    icon: Mail,
  },
  {
    slug: "e-posta",
    key: "emails",
    label: "E-posta",
    description: "Gönderen adı, yanıt adresi, yönetici bildirimleri, alt bilgi notu ve e-posta şablonlarının metinleri.",
    icon: Send,
    keywords: "e-posta mail şablon gönderen yanıt adresi bildirim smtp sipariş e-postası konu test",
  },
  {
    slug: "yorumlar",
    key: "reviews",
    label: "Yorumlar",
    description: "Ürün değerlendirmeleri, teslimattan sonra giden değerlendirme isteği e-postası ve yorum kuralları.",
    icon: MessageSquareQuote,
    keywords: "yorum değerlendirme puan yıldız onay moderasyon inceleme müşteri görüşü",
  },
  {
    slug: "abonelik",
    key: "subscriptions",
    label: "Abonelik",
    description: "Abone ol ve kazan: açık/kapalı, hatırlatma e-postası, izin verilen ödeme yöntemleri ve kartla yenilemelerde ödeme süresi.",
    icon: Repeat,
    keywords: "abonelik abone ol düzenli sipariş yenileme hatırlatma plan indirim",
  },
  {
    slug: "whatsapp",
    key: "whatsapp",
    label: "WhatsApp",
    description: "Sitedeki WhatsApp düğmesi, numara ve hazır mesaj.",
    icon: MessageCircle,
    keywords: "whatsapp mesaj numara destek",
  },
];

export function settingsPage(slug: string): SettingsPageMeta {
  const page = SETTINGS_PAGES.find((p) => p.slug === slug);
  if (!page) throw new Error(`Unknown settings page "${slug}"`);
  return page;
}

export const settingsHref = (slug: string) => `${SETTINGS_BASE}/${slug}`;

/** Editor state of one settings screen: the document plus the row stamp sent back on save. */
export type SettingsState<K extends SettingsKey> = Settings<K> & { updatedAt: string | null };
