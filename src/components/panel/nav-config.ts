// Panel navigation: one source for the sidebar, the command palette and the "coming soon" placeholder
// pages. `minRole` follows the role table in docs/DAY3-PANEL.md; hiding an item is cosmetic, every
// page/action/route handler re-checks the role on the server. Builders flip `ready: true` on their own
// items once the pages exist.
import {
  BellRing,
  BriefcaseBusiness,
  FerrisWheel,
  FileText,
  FlaskConical,
  FolderTree,
  Images,
  Inbox,
  Languages,
  LayoutDashboard,
  ListTree,
  Mail,
  MailCheck,
  Megaphone,
  MessageSquareQuote,
  Newspaper,
  Package,
  Palette,
  PanelsTopLeft,
  Repeat,
  Scale,
  ScrollText,
  SearchCheck,
  Settings,
  ShoppingBag,
  TicketPercent,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { hasRole } from "@/lib/panel/roles";
// Type-only import: erased at build time, so this module stays safe for client components.
import type { StaffRole } from "@/lib/session";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short line shown on the placeholder page until the section is built. */
  summary: string;
  /** Lowest role that may open the section (default: staff). */
  minRole?: StaffRole;
  /** The section has real pages: the "coming soon" placeholder never serves its URLs. */
  ready?: boolean;
  /** Extra words the command palette matches (e.g. "şifre" → Ekip). */
  keywords?: string;
};

export type NavGroup = { title: string | null; items: NavItem[] };

export const PANEL_NAV: NavGroup[] = [
  {
    title: null,
    items: [
      {
        label: "Genel Bakış",
        href: "/panel",
        icon: LayoutDashboard,
        summary: "Mağazanızın günlük özeti.",
        minRole: "staff",
      },
    ],
  },
  {
    title: "Satış",
    items: [
      {
        label: "Siparişler",
        href: "/panel/siparisler",
        icon: ShoppingBag,
        summary: "Siparişleri görüntüleyin, durumlarını güncelleyin, kargo ve fatura bilgilerini girin.",
        minRole: "staff",
        ready: true,
      },
      {
        label: "Abonelikler",
        href: "/panel/abonelikler",
        icon: Repeat,
        summary: "Abone ol ve kazan abonelikleri, yenileme siparişleri ve teslimat planları.",
        minRole: "staff",
        ready: true,
        keywords: "abonelik abone düzenli sipariş yenileme plan",
      },
      {
        label: "Mesajlar",
        href: "/panel/mesajlar",
        icon: Inbox,
        summary: "İletişim formundan gelen mesajları okuyun ve yanıtlayın.",
        minRole: "staff",
        ready: true,
      },
      {
        label: "Müşteriler",
        href: "/panel/musteriler",
        icon: Users,
        summary: "Müşteri hesapları, adresler, sipariş geçmişi ve müşteri grupları.",
        minRole: "staff",
        ready: true,
        keywords: "üye kullanıcı hesap kvkk anonim veri dışa aktar",
      },
      {
        label: "Kurumsal Hesaplar",
        href: "/panel/kurumsal-hesaplar",
        icon: BriefcaseBusiness,
        summary: "Otel, spa ve ofis başvurularını onaylayın; grup fiyatı ve ödeme koşullarını atayın.",
        minRole: "staff",
        ready: true,
        keywords: "firma şirket başvuru onay vadeli müşteri grupları grup fiyat b2b",
      },
      {
        label: "Teklif Talepleri",
        href: "/panel/teklifler",
        icon: FileText,
        summary: "İşletmelerden gelen toplu alım taleplerini yanıtlayın ve teklif hazırlayın.",
        minRole: "staff",
        ready: true,
        keywords: "teklif fiyat toplu alım kurumsal talep",
      },
      {
        label: "Numune Talepleri",
        href: "/panel/numune-talepleri",
        icon: FlaskConical,
        summary: "Ücretsiz numune başvurularını onaylayın ve gönderimleri takip edin.",
        minRole: "staff",
        ready: true,
        keywords: "numune ücretsiz kargo takip",
      },
    ],
  },
  {
    title: "Katalog",
    items: [
      {
        label: "Ürünler",
        href: "/panel/urunler",
        icon: Package,
        summary: "Ürünler, varyantlar, fiyatlar ve stok.",
        // The list and quick stock edits are staff+; creating/editing products is editor+ (checked per action).
        minRole: "staff",
        ready: true,
      },
      {
        label: "Kategoriler",
        href: "/panel/kategoriler",
        icon: FolderTree,
        summary: "Kategori adları, sıralaması, görselleri ve renkleri.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Yorumlar",
        href: "/panel/yorumlar",
        icon: MessageSquareQuote,
        summary: "Müşteri yorumlarını onaylayın, yanıtlayın veya gizleyin.",
        minRole: "editor",
        ready: true,
        keywords: "değerlendirme puan yıldız onay moderasyon",
      },
    ],
  },
  {
    title: "Pazarlama",
    items: [
      {
        label: "Kampanyalar",
        href: "/panel/kampanyalar",
        icon: Megaphone,
        summary: "Zamanlanmış indirimler ve sepet kampanyaları.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Kuponlar",
        href: "/panel/kuponlar",
        icon: TicketPercent,
        summary: "İndirim kodları, kullanım limitleri ve geçerlilik tarihleri.",
        minRole: "editor",
        ready: true,
      },
      // Day 6 (WHEEL-PANEL): overview, settings and winners editor+; the winners CSV (personal data) is admin only.
      {
        label: "Hediye Çarkı",
        href: "/panel/hediye-carki",
        icon: FerrisWheel,
        summary: "Çevir-kazan çarkı: dilimler ve olasılıklar, zamanlama, kazananlar, üyelik ve satış sonuçları.",
        minRole: "editor",
        ready: true,
        keywords: "çark hediye çevir kazan spin wheel kupon indirim üyelik kayıt açılır pencere popup kazanan",
      },
      {
        label: "E-bülten",
        href: "/panel/e-bulten",
        icon: Mail,
        // The list is editor+; the CSV export (personal data) is admin only (checked in its route handler).
        summary: "Abone listesi ve e-posta kampanyaları.",
        minRole: "editor",
        ready: true,
      },
      { label: "SEO Kontrol", href: "/panel/seo", icon: SearchCheck, summary: "Her sayfanın her dilde arama motorlarına hazır olup olmadığı ve yayına çıkış listesi.", minRole: "admin", ready: true, keywords: "seo google arama motoru başlık açıklama h1 alternatif metin barkod gtin search console merchant" },
    ],
  },
  {
    title: "İçerik ve Görünüm",
    items: [
      {
        label: "Sayfalar & Bölümler",
        href: "/panel/sayfalar",
        icon: PanelsTopLeft,
        summary: "Ana sayfa ve diğer sayfaların bölümlerini sürükleyip bırakarak düzenleyin.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Tema & Renkler",
        href: "/panel/tema",
        icon: Palette,
        summary: "Marka renkleri, yazı tipleri ve dönemsel temalar.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Menüler",
        href: "/panel/menuler",
        icon: ListTree,
        summary: "Üst menü ve alt bilgi bağlantıları.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Duyurular",
        href: "/panel/duyurular",
        icon: BellRing,
        summary: "Sitenin üstünde görünen duyuru şeridi ve zamanlaması.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Arayüz Metinleri",
        href: "/panel/metinler",
        icon: Languages,
        summary: "Butonlar, etiketler ve uyarılar gibi site metinlerini üç dilde düzenleyin.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Blog",
        href: "/panel/blog",
        icon: Newspaper,
        summary: "Blog yazıları, taslaklar ve yayın takvimi.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Medya",
        href: "/panel/medya",
        icon: Images,
        summary: "Görsel kütüphanesi: yükleme, alternatif metin ve klasörler.",
        minRole: "editor",
        ready: true,
      },
      {
        label: "Yasal Metinler",
        href: "/panel/yasal",
        icon: Scale,
        summary: "KVKK, mesafeli satış ve diğer yasal metinlerin sürümleri.",
        minRole: "admin",
        ready: true,
      },
    ],
  },
  {
    title: "Sistem",
    items: [
      {
        label: "E-postalar",
        href: "/panel/e-postalar",
        icon: MailCheck,
        summary: "Gönderilen e-postaların kaydı: içerik, durum, yeniden gönderme ve iptal.",
        minRole: "staff",
        ready: true,
        keywords: "e-posta mail gönderim kayıt log sipariş e-postası yeniden gönder",
      },
      {
        label: "Ayarlar",
        href: "/panel/ayarlar",
        icon: Settings,
        summary: "Firma bilgileri, kargo, ödeme yöntemleri, diller ve SEO.",
        minRole: "admin",
        ready: true,
      },
      {
        label: "Ekip",
        href: "/panel/ekip",
        icon: UserCog,
        summary: "Panel kullanıcıları, roller ve erişim.",
        minRole: "admin",
        ready: true,
        keywords: "şifre parola şifre sıfırla kullanıcı personel rol yetki hesap",
      },
      {
        label: "İşlem Kaydı",
        href: "/panel/islem-kaydi",
        icon: ScrollText,
        summary: "Panelde kimin neyi ne zaman değiştirdiğinin kaydı.",
        minRole: "admin",
        ready: true,
      },
    ],
  },
];

export const PANEL_NAV_ITEMS: NavItem[] = PANEL_NAV.flatMap((g) => g.items);

/** The nav item a panel path belongs to (exact match or a sub-path), if any. */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of PANEL_NAV_ITEMS) {
    const matches =
      item.href === "/panel" ? pathname === "/panel" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/** True when `role` may open the item (null role: nothing). */
export function canSeeNavItem(item: NavItem, role: StaffRole | null | undefined): boolean {
  return hasRole(role, item.minRole ?? "staff");
}

/** The nav without the items above `role`; empty groups are dropped. */
export function navForRole(role: StaffRole | null | undefined): NavGroup[] {
  return PANEL_NAV.map((group) => ({ ...group, items: group.items.filter((item) => canSeeNavItem(item, role)) })).filter(
    (group) => group.items.length > 0,
  );
}
