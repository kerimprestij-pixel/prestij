// Site-wide seed data: settings, themes, customer groups, categories, subscription plans, menus,
// announcements. All copy is tr/en/ar and editable in the panel afterwards.
// Day 5 (CONTENT-CATALOG): the site description, the category names / SEO / body / FAQ (catalog-copy.ts)
// and the menu links (keyword link texts, Hakkımızda and Blog in the corporate footer column).
import type { LocalizedText, SeoFields } from "@/db/schema/common";
import type { MenuItem, ThemeTokens } from "@/db/schema/site";
import { settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";
import { CATEGORY_COPY, type CategoryFaqSeed } from "./catalog-copy";
import { giftWheelSeedInput } from "./gift-wheel";

type L = LocalizedText;

/** settings.seo texts (day 5: the description names the label claims, incl. "etkili temizlik"). */
export const SEO_SETTINGS_TEXT: { defaultTitle: L; description: L } = {
  defaultTitle: {
    tr: "PRESTİJ — Sıvı El Sabunu ve Duş Jeli",
    en: "PRESTİJ — Liquid Hand Soap & Shower Gel",
    ar: "PRESTİJ — صابون سائل لليدين وجل استحمام",
  },
  description: {
    tr: "PRESTİJ sıvı el sabunu ve duş jeli: etkili temizlik, ferah koku ve yumuşak his. Pompalı şişe, 5 L ve 20 L bidon seçenekleri; evler ve işletmeler için.",
    en: "PRESTİJ liquid hand soap and shower gel: effective cleansing, a fresh scent and a soft feel. Pump bottles, 5 L and 20 L canisters for homes and businesses.",
    ar: "صابون PRESTİJ السائل لليدين وجل الاستحمام: تنظيف فعّال ورائحة منعشة وملمس ناعم. زجاجات بمضخة وعبوات 5 و20 لترًا للمنازل والشركات.",
  },
};

export function buildSettings(ids: { logoLightId: number; logoDarkId: number; ogImageId: number | null }): {
  [K in SettingsKey]: Settings<K>;
} {
  const raw: { [K in SettingsKey]: unknown } = {
    general: {
      siteName: "PRESTİJ",
      legalName: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.",
      tagline: { tr: "Bakım koleksiyonu", en: "Care collection", ar: "مجموعة العناية" },
      phone: "0352 353 30 70",
      email: "",
      address: { line: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E", district: "Kocasinan", city: "Kayseri", country: "Türkiye" },
      social: {},
      logo: { lightId: ids.logoLightId, darkId: ids.logoDarkId },
    },
    shipping: {},
    payments: {
      bankTransfer: {
        enabled: true,
        discountPercent: 0,
        accounts: [],
        instructions: {
          tr: "Açıklama kısmına sipariş numaranızı yazmayı unutmayın.",
          en: "Please write your order number in the transfer description.",
          ar: "يرجى كتابة رقم طلبك في خانة الوصف عند التحويل.",
        },
      },
    },
    seo: {
      defaultTitle: SEO_SETTINGS_TEXT.defaultTitle,
      description: SEO_SETTINGS_TEXT.description,
      ogImageId: ids.ogImageId,
    },
    locales: {},
    b2b: {},
    samples: {},
    newsletter: {
      incentive: {
        tr: "Yeni kokulardan ve kampanyalardan ilk siz haberdar olun.",
        en: "Be the first to hear about new scents and offers.",
        ar: "كن أول من يعرف عن الروائح الجديدة والعروض.",
      },
    },
    emails: {},
    reviews: {},
    subscriptions: {},
    whatsapp: {
      enabled: true,
      phone: "903523533070",
      message: {
        tr: "Merhaba, PRESTİJ ürünleri hakkında bilgi almak istiyorum.",
        en: "Hello, I would like information about PRESTİJ products.",
        ar: "مرحبًا، أود الحصول على معلومات حول منتجات PRESTİJ.",
      },
    },
    // Day 6 (CONTENT): the same live value scripts/content-day6.ts (giftWheelConfig) stores for the
    // client's database, so a fresh database matches it: the wheel on with the six default slices
    // (./gift-wheel.ts). The code default (no row) keeps the wheel off.
    giftWheel: giftWheelSeedInput(),
  };
  // Parse with the shared schemas so the stored documents are complete and valid.
  return Object.fromEntries(
    (Object.keys(settingsSchemas) as SettingsKey[]).map((key) => [key, settingsSchemas[key].parse(raw[key])]),
  ) as { [K in SettingsKey]: Settings<K> };
}

/** Istanbul is UTC+3 all year. */
const ist = (isoLocal: string) => new Date(`${isoLocal}+03:00`);

export const THEMES: {
  slug: string;
  name: string;
  tokens: ThemeTokens;
  isDefault: boolean;
  isScheduled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
}[] = [
  {
    slug: "prestij-klasik",
    name: "PRESTİJ Klasik",
    tokens: {
      colors: { brand: "#03265F", accent: "#DDA82A", background: "#F9F8F5", surface: "#FFFFFF", text: "#14284B" },
      dark: { background: "#0B1324", surface: "#121C30", text: "#F1EEE7" },
      radius: "sm",
    },
    isDefault: true,
    isScheduled: false,
    startsAt: null,
    endsAt: null,
    priority: 0,
  },
  {
    slug: "yilbasi",
    name: "Yılbaşı",
    tokens: {
      colors: { brand: "#0E3B2E", accent: "#B4232C", background: "#FAF7F0", surface: "#FFFFFF", text: "#10261E" },
      dark: { background: "#081C15", surface: "#0E2A20", text: "#F3EFE6" },
      radius: "sm",
      decor: { pattern: "snowflakes", heroOverlay: "#C9A13B" },
    },
    isDefault: false,
    isScheduled: true,
    startsAt: ist("2026-12-15T00:00:00"),
    endsAt: ist("2027-01-02T23:59:59"),
    priority: 20,
  },
  {
    slug: "ramazan",
    name: "Ramazan",
    tokens: {
      colors: { brand: "#0B4F55", accent: "#C9A54C", background: "#F8F6F0", surface: "#FFFFFF", text: "#0E2A2D" },
      dark: { background: "#06262A", surface: "#0C3337", text: "#F2EEE4" },
      radius: "sm",
      decor: { pattern: "geometric" },
    },
    isDefault: false,
    isScheduled: true,
    startsAt: ist("2027-02-07T00:00:00"),
    endsAt: ist("2027-03-09T23:59:59"),
    priority: 20,
  },
  {
    slug: "yaz",
    name: "Yaz",
    tokens: {
      colors: { brand: "#0B5C8A", accent: "#D2B48C", background: "#FBF8F2", surface: "#FFFFFF", text: "#0D2B3E" },
      dark: { background: "#071C2A", surface: "#0C2738", text: "#F2EEE6" },
      radius: "sm",
      decor: { pattern: "waves" },
    },
    isDefault: false,
    isScheduled: true,
    startsAt: ist("2027-06-01T00:00:00"),
    endsAt: ist("2027-08-31T23:59:59"),
    priority: 10,
  },
];

export const CUSTOMER_GROUPS = [
  { slug: "perakende", name: { tr: "Perakende", en: "Retail", ar: "التجزئة" }, isBusiness: false, discountPercent: 0, showPricesExVat: false },
  { slug: "kurumsal", name: { tr: "Kurumsal", en: "Business", ar: "الشركات" }, isBusiness: true, discountPercent: 15, showPricesExVat: true },
  { slug: "otel-partner", name: { tr: "Otel Partner", en: "Hotel Partner", ar: "شريك فندقي" }, isBusiness: true, discountPercent: 22, showPricesExVat: true },
];

export const CATEGORIES: {
  slug: "el-sabunu" | "dus-jeli" | "hediye-setleri" | "numune";
  name: L;
  description: L;
  accentColor: string | null;
  /** Media stem used as the category image. */
  image: string | null;
  isVisible: boolean;
  /** Day 5: page title / meta description, editorial body below the grid (HTML subset) and FAQ. */
  seo: SeoFields | null;
  body: L | null;
  faq: CategoryFaqSeed[];
}[] = [
  {
    slug: "el-sabunu",
    ...CATEGORY_COPY["el-sabunu"],
    description: {
      tr: "Lavanta Latte, Lavanta ve Portakal sıvı el sabunları; pompalı şişe, 5 L ve 20 L bidon seçenekleriyle.",
      en: "Lavender Latte, Lavender and Orange liquid hand soaps, in pump bottles and 5 L or 20 L canisters.",
      ar: "صابون اليدين السائل لاتيه اللافندر واللافندر والبرتقال، في زجاجات بمضخة وعبوات 5 و20 لترًا.",
    },
    accentColor: null,
    image: "PRESTIJ_Lavanta_Pompali_studyo_fasetli_cam",
    isVisible: true,
  },
  {
    slug: "dus-jeli",
    ...CATEGORY_COPY["dus-jeli"],
    description: {
      tr: "Okyanus duş jeli; pompalı şişe, 5 L ve 20 L bidon seçenekleriyle.",
      en: "Ocean shower gel, in a pump bottle and 5 L or 20 L canisters.",
      ar: "جل الاستحمام المحيط، في زجاجة بمضخة وعبوات 5 و20 لترًا.",
    },
    accentColor: "#329BC0",
    image: "PRESTIJ_Okyanus_Pompali_su_yansimali_studyo",
    isVisible: true,
  },
  {
    slug: "hediye-setleri",
    ...CATEGORY_COPY["hediye-setleri"],
    description: {
      tr: "Dört kokuyu bir araya getiren setler; evler, oteller ve işletmeler için.",
      en: "Sets bringing the four scents together, for homes, hotels and businesses.",
      ar: "مجموعات تجمع الروائح الأربع، للمنازل والفنادق والشركات.",
    },
    accentColor: "#B8974F",
    image: "PRESTIJ_Koleksiyon_5L_dikey_koleksiyon",
    isVisible: true,
  },
  {
    slug: "numune",
    name: { tr: "Numune", en: "Samples", ar: "العينات" },
    description: {
      tr: "Ücretsiz numuneler. Satılmaz.",
      en: "Free samples. Not for sale.",
      ar: "عينات مجانية. ليست للبيع.",
    },
    accentColor: null,
    image: null,
    isVisible: false,
    seo: null,
    body: null,
    faq: [],
  },
];

export const SUBSCRIPTION_PLANS = [
  { name: { tr: "2 haftada bir", en: "Every 2 weeks", ar: "كل أسبوعين" }, interval: "week" as const, intervalCount: 2, discountPercent: 0 },
  { name: { tr: "Her ay", en: "Monthly", ar: "شهريًا" }, interval: "month" as const, intervalCount: 1, discountPercent: 5 },
  { name: { tr: "2 ayda bir", en: "Every 2 months", ar: "كل شهرين" }, interval: "month" as const, intervalCount: 2, discountPercent: 0 },
];

const item = (tr: string, en: string, ar: string, href: string, children?: MenuItem[]): MenuItem => ({
  label: { tr, en, ar },
  href,
  ...(children ? { children } : {}),
});

const CATEGORY_LINKS: MenuItem[] = [
  item("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين", "/kategori/el-sabunu"),
  item("Duş Jeli", "Shower Gel", "جل الاستحمام", "/kategori/dus-jeli"),
  item("Hediye Setleri", "Gift Sets", "مجموعات الهدايا", "/kategori/hediye-setleri"),
];

/** Legal page slugs (/sayfa/<slug>) and the legal_documents key each one shows. */
export const LEGAL_PAGES = [
  { slug: "kvkk", key: "kvkk" },
  { slug: "mesafeli-satis-sozlesmesi", key: "distance_sales" },
  { slug: "on-bilgilendirme-formu", key: "pre_information" },
  { slug: "cerez-politikasi", key: "cookies" },
  { slug: "iade-ve-degisim", key: "returns" },
  // ACCOUNTS (day 4): linked from the register form (/hesap/kayit).
  { slug: "uyelik-sozlesmesi", key: "membership" },
  // CONTENT (day 6): the gift wheel's campaign terms, linked from the wheel dialog (not from the footer).
  // Existing databases get it from scripts/content-day6.ts (wheelTerms).
  { slug: "hediye-carki-kampanya-kosullari", key: "wheel_terms" },
] as const;

export type LegalPageSlug = (typeof LEGAL_PAGES)[number]["slug"];

/**
 * Day 5 (verification): the meta description of each legal page, unique per page and language. The
 * /sayfa route also prints it as the intro under the page title, so it says plainly what the document
 * covers (no promises, no figures). scripts/content-day5.ts (catalogSeo) fills it in on existing
 * databases where a page has no description; scripts/seed.ts stores it with the page via legalPageSeo.
 */
export const LEGAL_PAGE_DESCRIPTIONS: Record<LegalPageSlug, L> = {
  kvkk: {
    tr: "PRESTİJ KVKK aydınlatma metni: hangi kişisel verilerin hangi amaçlarla ve hukuki sebeplerle işlendiği, kimlere aktarıldığı, saklama süresi ve haklarınız.",
    en: "PRESTİJ privacy notice (KVKK): what personal data is processed, why and on what legal basis, who receives it, how long it is kept and what your rights are.",
    ar: "يوضّح إشعار حماية البيانات الشخصية من PRESTİJ ما يُعالَج من بيانات وأغراض معالجتها وأساسها القانوني والجهات التي تُنقل إليها ومدة حفظها وحقوقك.",
  },
  "mesafeli-satis-sozlesmesi": {
    tr: "PRESTİJ mesafeli satış sözleşmesi: sitedeki siparişlerde taraflar, sözleşme konusu ürün, ödeme ve teslimat, cayma hakkı ve uyuşmazlıkların çözümü.",
    en: "PRESTİJ distance sales agreement for orders on this website: the parties, the products, payment and delivery, the right of withdrawal and disputes.",
    ar: "يتناول عقد البيع عن بُعد لدى PRESTİJ الطلبات عبر هذا الموقع: بيانات الطرفين والمنتجات المطلوبة والدفع والتسليم وحق الانسحاب وحل النزاعات.",
  },
  "on-bilgilendirme-formu": {
    tr: "PRESTİJ ön bilgilendirme formu: sipariş öncesi satıcı bilgileri, ürünlerin temel nitelikleri ve fiyatı, ödeme ve teslimat, cayma hakkı ve şikâyet yolları.",
    en: "PRESTİJ preliminary information form: the seller's details, the main features and price of the products, payment and delivery, withdrawal and complaints.",
    ar: "يعرض نموذج المعلومات المسبقة من PRESTİJ قبل الطلب بيانات البائع وخصائص المنتجات الأساسية وسعرها والدفع والتسليم وحق الانسحاب وطرق تقديم الشكوى.",
  },
  "cerez-politikasi": {
    tr: "PRESTİJ çerez politikası: çerezin ne olduğu, sitede kullanılan zorunlu, analitik ve pazarlama çerezleri ve çerez tercihlerinizi nasıl yönetebileceğiniz.",
    en: "PRESTİJ cookie policy: what cookies are, the strictly necessary, analytics and marketing cookies used on this website, and how to manage your choices.",
    ar: "تشرح سياسة ملفات تعريف الارتباط لدى PRESTİJ ماهية هذه الملفات والملفات الضرورية والتحليلية والتسويقية المستخدمة في الموقع وكيف تدير تفضيلاتك.",
  },
  "iade-ve-degisim": {
    tr: "PRESTİJ iade ve değişim koşulları: cayma hakkının kullanımı, iade edilemeyen ürünler, iade süreci, hasarlı veya ayıplı ürünler ve değişim talepleri.",
    en: "PRESTİJ returns and exchanges: using the right of withdrawal, products that cannot be returned, the return process, damaged or faulty items and exchanges.",
    ar: "توضّح شروط الإرجاع والاستبدال لدى PRESTİJ كيفية استخدام حق الانسحاب والمنتجات غير القابلة للإرجاع وخطوات الإرجاع والمنتجات التالفة أو المعيبة والاستبدال.",
  },
  "uyelik-sozlesmesi": {
    tr: "PRESTİJ üyelik sözleşmesi: müşteri hesabının açılması ve güvenliği, tarafların hak ve yükümlülükleri, kişisel veriler, ticari ileti ve hesabın silinmesi.",
    en: "PRESTİJ membership agreement: opening and securing a customer account, both parties' rights and obligations, personal data, marketing emails and deletion.",
    ar: "تتناول اتفاقية العضوية لدى PRESTİJ فتح حساب العميل وأمانه وحقوق الطرفين والتزاماتهما والبيانات الشخصية والرسائل التسويقية الإلكترونية وحذف الحساب.",
  },
  // CONTENT (day 6): stored with the page by scripts/content-day6.ts (wheelTerms) and scripts/seed.ts.
  "hediye-carki-kampanya-kosullari": {
    tr: "PRESTİJ hediye çarkı kampanya koşulları: kimlerin katılabileceği, ödül türleri ve şartları, geçerlilik süresi, kullanım kuralları ve kişisel veriler.",
    en: "PRESTİJ gift wheel campaign terms: who can take part, prize types and their conditions, how long a prize is valid, how it can be used and personal data.",
    ar: "توضّح شروط حملة عجلة الهدايا من PRESTİJ من يحق له المشاركة وأنواع الجوائز وشروطها ومدة صلاحيتها وقواعد استخدامها وكيفية معالجة البيانات الشخصية.",
  },
};

/** The SEO texts of a legal page row: the document title and its description. */
export const legalPageSeo = (slug: LegalPageSlug, title: L): SeoFields => ({ title, description: LEGAL_PAGE_DESCRIPTIONS[slug] });

/** hrefs are canonical Turkish paths without the locale prefix. */
export const MENUS: Record<"header" | "footer_shop" | "footer_corporate" | "footer_legal", MenuItem[]> = {
  header: [
    item("Ürünler", "Products", "المنتجات", "/urunler", CATEGORY_LINKS),
    item("Kurumsal", "Business", "للشركات", "/kurumsal"),
    item("Numune", "Samples", "العينات", "/numune"),
    item("Blog", "Blog", "المدونة", "/blog"),
    item("İletişim", "Contact", "اتصل بنا", "/iletisim"),
  ],
  footer_shop: [item("Tüm Ürünler", "All Products", "جميع المنتجات", "/urunler"), ...CATEGORY_LINKS],
  // Day 5: "Toplu Alım" → "Toptan Sıvı Sabun" and "Numune Talebi" → "Ücretsiz Numune" (same targets), plus
  // Hakkımızda and Blog. The day-4 list is kept in catalog-seo.ts as a previous default.
  footer_corporate: [
    item("Hakkımızda", "About Us", "من نحن", "/sayfa/hakkimizda"),
    item("Kurumsal Satış", "Business Sales", "مبيعات الشركات", "/kurumsal"),
    item("Toptan Sıvı Sabun", "Bulk Liquid Soap", "صابون سائل بالجملة", "/kurumsal#teklif"),
    item("Ücretsiz Numune", "Free Samples", "عيّنات مجانية", "/numune#numune-formu"),
    item("Blog", "Blog", "المدونة", "/blog"),
    item("İletişim", "Contact", "اتصل بنا", "/iletisim"),
  ],
  footer_legal: [
    item("KVKK Aydınlatma Metni", "Privacy Notice (KVKK)", "إشعار الخصوصية (KVKK)", "/sayfa/kvkk"),
    item("Mesafeli Satış Sözleşmesi", "Distance Sales Agreement", "عقد البيع عن بُعد", "/sayfa/mesafeli-satis-sozlesmesi"),
    item("Ön Bilgilendirme Formu", "Preliminary Information Form", "نموذج المعلومات المسبقة", "/sayfa/on-bilgilendirme-formu"),
    item("Çerez Politikası", "Cookie Policy", "سياسة ملفات تعريف الارتباط", "/sayfa/cerez-politikasi"),
    item("İade ve Değişim", "Returns & Exchanges", "الإرجاع والاستبدال", "/sayfa/iade-ve-degisim"),
  ],
};

export const ANNOUNCEMENTS: { text: L; href: string | null; variant: "brand" | "accent" | "neutral" }[] = [
  {
    text: {
      tr: "1.500 TL ve üzeri siparişlerde ücretsiz kargo",
      en: "Free shipping on orders of 1,500 TL and above",
      ar: "شحن مجاني للطلبات بقيمة 1,500 ليرة تركية فأكثر",
    },
    href: null,
    variant: "brand",
  },
  {
    text: {
      tr: "Oteller ve işletmeler için ücretsiz numune",
      en: "Free samples for hotels and businesses",
      ar: "عينات مجانية للفنادق والشركات",
    },
    href: "/numune",
    variant: "accent",
  },
];
