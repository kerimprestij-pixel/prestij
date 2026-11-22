// Search engine tools in the panel: the public URLs to paste into Search Console / Bing / Yandex /
// Merchant Center, the IndexNow key state, verification-code clean-up and the "Yayına alma adımları"
// checklist on /panel/seo. Pure (no DB, no Next APIs; the caller passes the origin and env value):
// unit-tested in tests/unit/day5-seo-panel-launch.test.ts and tests/unit/day6-content-launch.test.ts.
// Day 6 (CONTENT) adds three go-live steps in front of the search-engine ones: media storage on
// Supabase with a test upload on the live site, the gift wheel slices, the lawyer's review of the wheel
// campaign terms. Go-live (CF-9, CF-10) adds six steps after them: seller identity, approved sales contracts
// (the checkout's draft rule), e-mail sending, the site address, CRON_SECRET and the admin notification
// recipients (only whether each is set, never a value). Sales-ready (SR-6) adds the steps that must be done
// before orders are taken: real prices instead of the Day-1 placeholders (the same matches as the go-live sales
// profile, src/lib/pricing/placeholder-prices.ts), the havale bank account and payment days (only while havale
// is on; never an IBAN, only counts) and a "kontrol et" look at the shipping fees still on their Day-1 values.
// FIX B-F9: the owner goes live only when everything is ready for sales, so every step carries a group: "before"
// (Yayından önce: media storage, seller details, contracts, e-mail, site address, cron, admin mails, prices, havale,
// shipping), "wheel" (Çarkı açmadan önce: the wheel slices and the lawyer's approval of its terms; the wheel stays
// off at go-live, so they do not block it) and "after" (Yayından sonra: the search-engine steps).
import { publicSiteUrlProblem, SITE_URL_PROBLEM_TEXT } from "@/lib/deploy/site-url";
import { isDraftLegalVersion } from "@/lib/panel/legal/draft";
import { formatKurusTl, type PlaceholderPriceCheck } from "@/lib/pricing/placeholder-prices";
import { merchantFeedUrl } from "@/lib/seo/feed-url";

export { isDraftLegalVersion };

// ---------------------------------------------------------------------------------------------------
// Public URLs

export const SITEMAP_PATH = "/sitemap.xml";
export const ROBOTS_PATH = "/robots.txt";
/** Served by src/app/indexnow-key.txt/route.ts (SEO-TECH): the key as text/plain, 404 when unset. */
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

export type SeoToolUrls = {
  /**
   * The domain root (`https://…/`): the Search Console / Bing / Yandex property. A URL-prefix property
   * only covers URLs under its prefix, so it must be the root to include /tr, /en, /ar, the sitemap and
   * the feed. Tag verification follows the root's redirect to /tr, where the meta tags are printed.
   */
  site: string;
  /** The Turkish home page (`https://…/tr`): the address to give visitors (Business Profile, partner links). */
  storefront: string;
  sitemap: string;
  robots: string;
  merchantFeed: string;
  indexNowKey: string;
};

/** Absolute URLs of the files search engines and Merchant Center read, for `origin` (no trailing slash needed). */
export function seoToolUrls(origin: string): SeoToolUrls {
  const base = origin.replace(/\/+$/, "");
  return {
    site: `${base}/`,
    storefront: `${base}/tr`,
    sitemap: `${base}${SITEMAP_PATH}`,
    robots: `${base}${ROBOTS_PATH}`,
    merchantFeed: merchantFeedUrl(base),
    indexNowKey: `${base}${INDEXNOW_KEY_PATH}`,
  };
}

/** True when the origin is a local address (the site is not public yet: search engines cannot reach it). */
export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".test");
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------
// IndexNow key (environment variable INDEXNOW_KEY; the value itself is never shown in the panel)

/** IndexNow key rule (docs/DAY5-SEO.md §5.1): 8–128 characters, letters, digits and hyphens. */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export type IndexNowKeyState = "set" | "invalid" | "missing";

/** "set" / "invalid" / "missing" for the raw env value (whitespace around it ignored). */
export function indexNowKeyState(raw: string | null | undefined): IndexNowKeyState {
  const value = (raw ?? "").trim();
  if (!value) return "missing";
  return INDEXNOW_KEY_PATTERN.test(value) ? "set" : "invalid";
}

// ---------------------------------------------------------------------------------------------------
// Media storage (environment variables STORAGE_DRIVER, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; the
// values themselves are never shown in the panel, only whether they are set)

/**
 * "supabase": uploads go to Supabase Storage (driver and both keys set) · "local": the default disk
 * driver, which keeps files only on the machine that runs the site · "incomplete": the Supabase driver
 * is chosen but a key is missing · "invalid": an unknown driver name.
 */
export type MediaStorageState = "supabase" | "local" | "incomplete" | "invalid";

export type MediaStorageEnv = {
  STORAGE_DRIVER?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

/** The media storage state for the env (same rules as getStorage() in src/lib/media/storage.ts). */
export function mediaStorageState(env: MediaStorageEnv): MediaStorageState {
  const driver = (env.STORAGE_DRIVER ?? "").trim().toLowerCase() || "local";
  if (driver === "local") return "local";
  if (driver !== "supabase") return "invalid";
  return (env.SUPABASE_URL ?? "").trim() && (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ? "supabase" : "incomplete";
}

// ---------------------------------------------------------------------------------------------------
// Gift wheel campaign terms (legal document seeded by scripts/content-day6.ts wheelTerms)

/** Legal key of "Hediye Çarkı Kampanya Koşulları" (scripts/seed-data/legal.ts WHEEL_TERMS_KEY). */
export const WHEEL_TERMS_LEGAL_KEY = "wheel_terms";

// isDraftLegalVersion (re-exported above) lives in src/lib/panel/legal/draft.ts: a label starting with
// "taslak" marks a draft. The legal editor suggests a "taslak-N" label only while the draft notice is on and
// an approved-form label ("2026-11 v1") once it is off (legalVersionSuggestions).

// ---------------------------------------------------------------------------------------------------
// Verification codes

const PREFIXES = /^(?:google-site-verification|msvalidate\.01|yandex-verification)\s*[:=]\s*/i;

/**
 * What the owner pasted → the meta tag's content value. Accepts the bare code, the whole meta tag
 * (`<meta name="google-site-verification" content="abc" />`) or the DNS TXT form
 * (`google-site-verification=abc`). Anything else comes back trimmed (the schema then explains the rule).
 */
export function extractVerificationCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(value);
  if (content) return content[2].trim();
  return value.replace(PREFIXES, "").trim();
}

/** extractVerificationCode for each engine of a verification object (other shapes pass through). */
export function normalizeVerificationCodes(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of ["google", "bing", "yandex"] as const) {
    if (typeof out[key] === "string") out[key] = extractVerificationCode(out[key]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// "Yayına alma adımları" checklist (formerly "Yayına çıkınca")

export type LaunchLink = {
  label: string;
  url: string;
  /** Shown with a copy button (a URL to paste somewhere), else an external link. */
  copy?: boolean;
};

/** When a step is done (FIX B-F9): before go-live (with sales), before switching the gift wheel on, after go-live. */
export type LaunchGroup = "before" | "wheel" | "after";

/** The group headings and their short explanation, in display order (LaunchChecklist renders them). */
export const LAUNCH_GROUPS: readonly { key: LaunchGroup; title: string; text: string }[] = [
  {
    key: "before",
    title: "Yayından önce (satışla birlikte açılış)",
    text: "Site, satış için her şey hazır olunca açılır. Bu adımların hepsi açılıştan önce biter. “Kontrol et” işareti engel değildir; bir göz atmanız yeterli.",
  },
  {
    key: "wheel",
    title: "Çarkı açmadan önce",
    text: "Hediye çarkı, avukatın onayı gelene kadar kapalı kalır. Bu adımlar açılışı beklemez; çarkı açmadan önce yapılır.",
  },
  {
    key: "after",
    title: "Yayından sonra",
    text: "Site canlı alan adında açıldıktan sonra bir kez yapılır. Arama sonuçlarındaki sırayı başka sitelerden gelen bağlantılar, müşteri yorumları, alan adının yaşı ve zaman da etkiler; hiçbir ayar belirli bir sırayı garanti etmez.",
  },
];

export type LaunchStep = {
  key: string;
  /** FIX B-F9: before go-live, before the wheel, or after go-live. */
  group: LaunchGroup;
  title: string;
  /** Short plain-Turkish steps. */
  steps: string[];
  links: LaunchLink[];
  /** true / false when the panel can tell, null when it cannot (done outside the site). */
  done: boolean | null;
  /** SR-6: with done null, a "Kontrol et" badge (worth a look, not a blocker). */
  review?: boolean;
  /** Where to fix it in the panel, when relevant. */
  panelHref?: string;
  panelLabel?: string;
};

export type LaunchChecklistInput = {
  origin: string;
  verification: { google: string; bing: string; yandex: string };
  /** Number of filled social profile links in Genel ayarlar. */
  socialLinks: number;
  indexNow: IndexNowKeyState;
  /** "Cırgalan Mah. … Kocasinan / Kayseri" (Genel ayarlar), for the Business Profile step. */
  address: string;
  /** Day 6: mediaStorageState(process.env). Omitted = unknown (no badge). */
  mediaStorage?: MediaStorageState;
  /** Day 6: settings.giftWheel.enabled. Omitted = unknown (no status line). */
  giftWheelEnabled?: boolean;
  /**
   * Day 6: version label of the current "Hediye Çarkı Kampanya Koşulları" (legal key WHEEL_TERMS_LEGAL_KEY),
   * null when the document does not exist. Omitted = unknown (no badge).
   */
  wheelTermsVersion?: string | null;
  /** Go-live CF-9: missingSellerFields(general) (Turkish field names). Omitted = unknown (no badge). */
  sellerMissing?: string[];
  /**
   * Go-live (final): version labels of the current pre-information form and distance sales agreement (null =
   * no current version). The checkout takes orders only when both exist and neither label starts with
   * "taslak" (checkoutLegalReady). Omitted = unknown (no badge).
   */
  checkoutContracts?: { preInformation: string | null; distanceSales: string | null };
  /**
   * Go-live CF-10: the e-mail driver as emailDriverStatus() reports it (driver name, ready, the fixed Turkish
   * problem text; never the SMTP URL). Omitted = unknown (no badge).
   */
  emailDriver?: { driver: "outbox" | "smtp" | "none"; ready: boolean; problem: string | null };
  /** Go-live CF-10: cronSecretState(process.env.CRON_SECRET) (only whether it is set). Omitted = unknown. */
  cronSecret?: CronSecretState;
  /** Go-live CF-10: adminRecipientsState(settings.emails, general.email) (never the addresses). Omitted = unknown. */
  adminRecipients?: AdminRecipientsState;
  /** SR-6: placeholderPriceCheck() over the catalog's variants. Omitted = unknown (no badge). */
  prices?: PlaceholderPriceCheck;
  /**
   * SR-6: the havale settings as counts (never an IBAN): the "Havale: IBAN ve ödeme süresi" step appears only
   * while `enabled`. Omitted = not shown.
   */
  bankTransfer?: { enabled: boolean; accounts: number; usableAccounts: number; paymentDays: number };
  /**
   * SR-6: settings.shipping (kuruş, grams), compared with the Day-1 defaults; `estimatedDays` (Kargoya verme süresi,
   * printed in the contracts) is shown, never judged. Omitted = unknown (no badge).
   */
  shipping?: {
    flatFee: number;
    freeThreshold: number;
    heavy: { enabled: boolean; thresholdGrams: number; feePerKg: number };
    estimatedDays?: { min: number; max: number };
  };
};

/** The Day-1 shipping values (the defaults of shippingSettings in src/lib/settings/types.ts; a unit test pins them). */
export const DAY1_SHIPPING_DEFAULTS = {
  flatFee: 9990,
  freeThreshold: 150000,
  heavy: { enabled: true, thresholdGrams: 10000, feePerKg: 1500 },
} as const;

/** Turkish names of the shipping values still equal to their Day-1 default (empty = all changed). */
export function shippingStillDefault(shipping: NonNullable<LaunchChecklistInput["shipping"]>): string[] {
  const d = DAY1_SHIPPING_DEFAULTS;
  const heavySame =
    shipping.heavy.enabled === d.heavy.enabled && shipping.heavy.thresholdGrams === d.heavy.thresholdGrams && shipping.heavy.feePerKg === d.heavy.feePerKg;
  return [
    shipping.flatFee === d.flatFee ? "kargo ücreti" : null,
    shipping.freeThreshold === d.freeThreshold ? "ücretsiz kargo sınırı" : null,
    heavySame ? "ağır paket farkı" : null,
  ].filter((v): v is string => v !== null);
}

const kg = (grams: number) => String(Math.round(grams / 100) / 10).replace(".", ",");

/**
 * SR-6: what has to be right before the shop takes orders (prices, havale, shipping); all in the "before" group.
 * Prices (FIX F2): "Tamam" only when no variant is on a Day-1 price, "Yapılacak" while the Day-1 set is clearly still
 * there, "Kontrol et" with the SKUs in between (the owner may really keep one of those prices; the go-live script
 * asks about each one separately).
 */
function salesReadySteps(input: LaunchChecklistInput): LaunchStep[] {
  const prices = input.prices;
  const sample = prices ? prices.matches.slice(0, 8).map((m) => m.sku).join(", ") + (prices.matches.length > 8 ? " …" : "") : "";
  const bank = input.bankTransfer;
  const shipping = input.shipping;
  const stillDefault = shipping ? shippingStillDefault(shipping) : [];
  const priceMatches = prices?.matches.length ?? 0;
  const steps: LaunchStep[] = [
    {
      key: "real-prices",
      group: "before",
      title: "Fiyatlar gerçek",
      steps: [
        `İlk kurulumda her ürüne aynı örnek fiyatlar (${[14990, 44990, 149990, 159990].map(formatKurusTl).join(", ")}) ve 100'er adet stok yazıldı. Satışa açmadan önce Ürünler sayfasında her varyantın gerçek fiyatını (KDV dahil) ve gerçek stoğunu girin.`,
        "Örnek fiyatta kalan her varyant burada listelenir. Stok değişmiş olsa da fiyat örnek fiyatsa listede kalır. Fiyat gerçekten doğruysa sorun değil; yayına alırken bu varyantlar için ayrıca onay istenir.",
        ...(prices && priceMatches > 0
          ? [
              prices.placeholder
                ? `Şu an ${priceMatches}/${prices.considered} varyant örnek fiyatta: ${sample}.`
                : `Örnek fiyatta kalan varyant(lar) (${priceMatches}/${prices.considered}): ${sample}. Bu fiyatlar gerçekten doğruysa sorun değil.`,
            ]
          : []),
      ],
      links: [],
      done: prices === undefined ? null : priceMatches === 0 ? true : prices.placeholder ? false : null,
      review: prices !== undefined && priceMatches > 0 && !prices.placeholder,
      panelHref: "/panel/urunler",
      panelLabel: "Ürünler",
    },
  ];
  if (bank?.enabled) {
    steps.push({
      key: "bank-transfer",
      group: "before",
      title: "Havale: IBAN ve ödeme süresi",
      steps: [
        "Havale açık. Ödeme yöntemleri sayfasında en az bir banka hesabının IBAN'ını ve hesap sahibini (şirket unvanı) eksiksiz girin; müşteri ödemeyi bu hesaba gönderir.",
        `Ödeme süresi şu an ${bank.paymentDays} gün. Son ödeme tarihi e-postada, sipariş sayfasında ve sözleşmelerin sipariş bölümünde kendiliğinden yazar. Avukatınızın metninde ayrıca bir süre geçiyorsa aynı gün sayısı olmalı.`,
        "Süre, sipariş verilirken siparişe yazılır: sonradan değiştirirseniz yalnızca yeni siparişler etkilenir.",
        "Süresi dolan havale siparişleri kendiliğinden iptal edilmez: Siparişler › Havale bekleyen sekmesine her gün bakın.",
        ...(bank.usableAccounts === 0
          ? [
              bank.accounts > 0
                ? "Şu an kayıtlı hesapların hiçbirinde geçerli bir IBAN ve hesap sahibi birlikte yok; havale ödeme sayfasında kullanılamaz."
                : "Şu an banka hesabı yok; havale ödeme sayfasında görünmez.",
            ]
          : []),
      ],
      links: [],
      done: bank.usableAccounts > 0,
      panelHref: "/panel/ayarlar/odeme",
      panelLabel: "Ayarlar › Ödeme yöntemleri",
    });
  }
  const lead = shipping?.estimatedDays;
  steps.push({
    key: "shipping-settings",
    group: "before",
    title: "Kargo ayarları",
    steps: [
      `Kargo ücreti, ücretsiz kargo sınırı ve ağır paket farkı ilk kurulumda örnek değerlerle girildi: ${formatKurusTl(DAY1_SHIPPING_DEFAULTS.flatFee)} kargo, ${formatKurusTl(DAY1_SHIPPING_DEFAULTS.freeThreshold)} ve üzeri ücretsiz, ${kg(DAY1_SHIPPING_DEFAULTS.heavy.thresholdGrams)} kg üzerindeki her kg için ${formatKurusTl(DAY1_SHIPPING_DEFAULTS.heavy.feePerKg)}. Kargo firmanızla anlaştığınız ücretlere göre kontrol edin.`,
      `Kargoya verme süresini de kontrol edin${lead ? ` (şu an ${lead.min}–${lead.max} iş günü)` : ""}: ürün sayfasında, sepette ve sözleşmelerin teslim bölümünde bu süre yazar.`,
      "Ücretsiz kargo sınırını değiştirirseniz duyuru çubuğundaki ücretsiz kargo yazısını da güncelleyin.",
      ...(shipping
        ? [
            `Şu an: kargo ${formatKurusTl(shipping.flatFee)}, ücretsiz kargo ${shipping.freeThreshold > 0 ? `${formatKurusTl(shipping.freeThreshold)} ve üzeri` : "yok"}, ağır paket farkı ${shipping.heavy.enabled ? `${kg(shipping.heavy.thresholdGrams)} kg üzerinde kg başına ${formatKurusTl(shipping.heavy.feePerKg)}` : "kapalı"}.${stillDefault.length ? ` İlk kurulumdaki değerinde kalan: ${stillDefault.join(", ")}.` : ""}`,
          ]
        : []),
    ],
    links: [],
    // Not a blocker: the Day-1 values may be the real ones. Changed values count as done, unchanged ones ask for a look.
    done: shipping === undefined || stillDefault.length > 0 ? null : true,
    review: shipping !== undefined && stillDefault.length > 0,
    panelHref: "/panel/ayarlar/kargo",
    panelLabel: "Ayarlar › Kargo",
  });
  return steps;
}

// ---------------------------------------------------------------------------------------------------
// Go-live checks (CF-10): only whether something is set, never a value

/** Same minimum as src/lib/cron/handler.ts MIN_CRON_SECRET_LENGTH (server-only, so not imported here). */
export const CRON_SECRET_MIN_LENGTH = 16;

export type CronSecretState = "set" | "short" | "missing";

/** "set" (16+ characters), "short" (the cron routes refuse it) or "missing". */
export function cronSecretState(raw: string | null | undefined): CronSecretState {
  const value = raw ?? "";
  if (!value) return "missing";
  return value.length >= CRON_SECRET_MIN_LENGTH ? "set" : "short";
}

/**
 * "set": Ayarlar › E-posta › Yönetici bildirimleri lists at least one address · "fallback": the list is empty
 * and admin mails go to the shop e-mail of Firma bilgileri · "missing": nowhere to send them.
 */
export type AdminRecipientsState = "set" | "fallback" | "missing";

const PLAIN_ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/** The same choice as adminRecipients() in src/lib/email/preview.ts, without returning any address. */
export function adminRecipientsState(recipients: readonly string[] | null | undefined, shopEmail: string | null | undefined): AdminRecipientsState {
  if ((recipients ?? []).some((r) => PLAIN_ADDRESS.test(r.trim()))) return "set";
  return PLAIN_ADDRESS.test((shopEmail ?? "").trim()) ? "fallback" : "missing";
}

/** Turkish lines saying which sales contract is still a draft or missing (empty when both are approved). */
function contractNotes(contracts: NonNullable<LaunchChecklistInput["checkoutContracts"]>): string[] {
  const docs = [
    { name: "Ön Bilgilendirme Formu", version: contracts.preInformation },
    { name: "Mesafeli Satış Sözleşmesi", version: contracts.distanceSales },
  ];
  return docs.flatMap(({ name, version }) =>
    version === null
      ? [`${name}: yürürlükte bir sürümü yok.`]
      : isDraftLegalVersion(version)
        ? [`${name}: yürürlükteki sürüm “${version}”, “taslak” ile başladığı için taslak sayılıyor.`]
        : [],
  );
}

/** True when both sales contracts have a current version whose label does not start with "taslak". */
export function checkoutContractsApproved(contracts: NonNullable<LaunchChecklistInput["checkoutContracts"]>): boolean {
  return contractNotes(contracts).length === 0;
}

/**
 * Go-live steps that make the live site complete and able to talk to people: the seller identity the
 * e-commerce rules require, approved sales contracts, e-mail sending, the site address, the scheduled jobs
 * and who gets the admin mails.
 */
function siteReadySteps(input: LaunchChecklistInput): LaunchStep[] {
  const missing = input.sellerMissing;
  const contracts = input.checkoutContracts;
  const contractLines = contracts ? contractNotes(contracts) : [];
  const mail = input.emailDriver;
  const siteProblem = publicSiteUrlProblem(input.origin);
  const cron = input.cronSecret;
  const admins = input.adminRecipients;
  return [
    {
      key: "seller-identity",
      group: "before",
      title: "Satıcı bilgileri eksiksiz",
      steps: [
        "E-ticaret mevzuatı, satıcının ticari unvanını, MERSİS numarasını, açık adresini, telefonunu, e-posta ve KEP adresini, kayıtlı olduğu meslek odasını ve meslek kurallarına nasıl ulaşılacağını sitede göstermesini ister; tescilli markanız varsa o da eklenir.",
        "Bu bilgileri Firma bilgileri sayfasında doldurun. Sitenin alt bilgisindeki “İletişim” bölümünde ve İletişim sayfasında kendiliğinden görünür, boş bırakılanlar gösterilmez. Hangi bilgilerin sizin için zorunlu olduğunu avukatınız veya mali müşavirinizle teyit edin.",
        ...(missing && missing.length > 0 ? [`Eksik: ${missing.join(", ")}.`] : []),
      ],
      links: [],
      done: missing === undefined ? null : missing.length === 0,
      panelHref: "/panel/ayarlar/genel",
      panelLabel: "Firma bilgileri",
    },
    {
      key: "checkout-contracts",
      group: "before",
      title: "Satış sözleşmeleri onaylı",
      steps: [
        "Ödeme sayfası, Ön Bilgilendirme Formu ile Mesafeli Satış Sözleşmesi avukat onaylı olmadan sipariş almaz. Bir ödeme yöntemi açık olsa bile müşteriler “Online siparişler şu an kapalı” notunu görür.",
        "Avukatınızın onayladığı metinleri Yasal Metinler'de yayınlayın: taslak uyarısını kapatın ve sürüm adının “taslak” ile başlamadığından emin olun (ör. “2026-11 v1”). Sürüm adı “taslak” ile başladığı sürece metin taslak sayılır.",
        ...contractLines,
      ],
      links: [],
      done: contracts === undefined ? null : contractLines.length === 0,
      panelHref: "/panel/yasal",
      panelLabel: "Yasal Metinler",
    },
    {
      key: "email-sending",
      group: "before",
      title: "E-posta gönderimi (SMTP)",
      steps: [
        "Üyelik doğrulama, şifre sıfırlama ve sipariş e-postaları ancak gönderim ayarlıyken gider. Barındırma (hosting) ayarlarında EMAIL_DRIVER ortam değişkenini smtp yapın; EMAIL_SMTP_URL ve EMAIL_FROM değerlerini e-posta gönderim hizmetinizden alın. Site yeniden yayınlanınca devreye girer.",
        "E-posta ayarlarından kendinize bir deneme e-postası gönderip geldiğini kontrol edin.",
        ...(mail && !(mail.driver === "smtp" && mail.ready) && mail.problem ? [`Şu an: ${mail.problem}`] : []),
        ...(mail && mail.driver === "outbox" && mail.ready ? ["Şu an e-postalar yalnızca bu bilgisayardaki klasöre yazılıyor (EMAIL_DRIVER=outbox); kimseye gönderilmiyor."] : []),
      ],
      links: [],
      done: mail === undefined ? null : mail.driver === "smtp" && mail.ready,
      panelHref: "/panel/ayarlar/e-posta",
      panelLabel: "E-posta ayarları",
    },
    {
      key: "site-url",
      group: "before",
      title: "Site adresi (NEXT_PUBLIC_SITE_URL)",
      steps: [
        "Barındırma ayarlarındaki NEXT_PUBLIC_SITE_URL, sitenin canlı adresi olmalı: https:// ile başlayan, sonunda / olmayan tam adres (ör. https://www.alanadiniz.com.tr). Arama motorlarına, e-postalardaki bağlantılara ve ödeme kuruluşlarına bu adres verilir.",
        "Değiştirdikten sonra siteyi önbelleksiz yeniden yayınlayın; adres derleme sırasında sayfalara işlenir.",
        ...(siteProblem ? [`Şu an: ${SITE_URL_PROBLEM_TEXT[siteProblem]}`] : []),
      ],
      links: [],
      done: siteProblem === null,
    },
    {
      key: "cron-secret",
      group: "before",
      title: "Zamanlanmış görevler (CRON_SECRET)",
      steps: [
        "Süresi dolan ödemeleri kapatan, bekleyen e-postaları yeniden deneyen ve abonelikleri yenileyen görevler için barındırma ayarlarında CRON_SECRET ortam değişkenine en az 16 karakterlik rastgele bir değer girin ve siteyi yeniden yayınlayın.",
        "Ana paneldeki “Zamanlanmış görevler” kartında görevlerin düzenli çalıştığını kontrol edin.",
        ...(cron === "short" ? ["Şu an CRON_SECRET 16 karakterden kısa; görevler reddediliyor."] : []),
      ],
      links: [],
      done: cron === undefined ? null : cron === "set",
      panelHref: "/panel",
      panelLabel: "Zamanlanmış görevler",
    },
    {
      key: "admin-recipients",
      group: "before",
      title: "Yönetici bildirimleri",
      steps: [
        "Yeni sipariş, iletişim mesajı ve teklif talebi e-postalarının gideceği adresleri E-posta ayarlarındaki “Yönetici bildirimleri” alanına yazın; her gün baktığınız bir gelen kutusu olsun.",
        ...(admins === "fallback" ? ["Şu an liste boş; bildirimler Firma bilgilerindeki e-posta adresine gidiyor."] : []),
        ...(admins === "missing" ? ["Şu an bildirimlerin gideceği bir adres yok; yeni siparişlerden e-postayla haberiniz olmaz."] : []),
      ],
      links: [],
      done: admins === undefined ? null : admins === "set",
      panelHref: "/panel/ayarlar/e-posta",
      panelLabel: "E-posta ayarları",
    },
  ];
}

/**
 * Day 6: the go-live steps of the gift wheel and the video uploads. The storage keys are done before go-live
 * ("before"); the wheel slices and the lawyer's approval of the wheel terms belong to "wheel" (the wheel stays off
 * until the lawyer answers, so they do not block go-live; FIX B-F9).
 */
function goLiveSteps(input: LaunchChecklistInput): LaunchStep[] {
  const storage = input.mediaStorage;
  const storageNote =
    storage === "incomplete"
      ? ["Şu an Supabase seçili ama SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik; bu hâliyle dosya yüklenemez."]
      : storage === "invalid"
        ? ["STORAGE_DRIVER değeri tanınmıyor; local veya supabase olmalı."]
        : [];
  const terms = input.wheelTermsVersion;
  const termsDraft = terms === null || (typeof terms === "string" && isDraftLegalVersion(terms));
  const wheelNote =
    input.giftWheelEnabled === true && termsDraft
      ? ["Çark şu anda sitede açık, ama kampanya koşulları henüz avukat onaylı değil: siteyi yayına almadan önce Ayarlar'daki anahtarla çarkı kapatın ve onay gelene kadar kapalı tutun."]
      : input.giftWheelEnabled === true
        ? ["Çark şu anda sitede açık. Dilimleri gözden geçirene kadar kapatmak isterseniz Ayarlar'daki anahtarı kullanın."]
      : input.giftWheelEnabled === false
        ? ["Çark şu anda kapalı; dilimleri gözden geçirdikten sonra Ayarlar'dan açabilirsiniz."]
        : [];
  const termsNote = terms === null ? ["Kampanya koşulları metni henüz eklenmemiş; çarktaki “Kampanya Koşulları” bağlantısı bu metni açar."] : [];
  return [
    {
      key: "media-storage",
      group: "before",
      title: "Fotoğraf ve video depolama (Supabase)",
      steps: [
        "Barındırma (hosting) ayarlarında STORAGE_DRIVER ortam değişkenini supabase yapın; SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY değerlerini Supabase projenizin ayarlarından kopyalayın, SUPABASE_STORAGE_BUCKET alanına dosyaların duracağı depolama alanının (bucket) adını yazın (boş bırakılırsa “media”). Site yeniden başlatılınca devreye girer.",
        "Bu ayar yapılmazsa yüklenen fotoğraf ve videolar yalnızca siteyi çalıştıran bilgisayarda kalır ve canlı sitede kaybolabilir. Gizli anahtarı (service role) kimseyle paylaşmayın.",
        "Supabase’de bu depolama alanını herkese açık (public) yapın, dosya boyutu sınırını 50 MB olarak girin ve izin verilen dosya türlerine yalnızca image/jpeg, image/png, image/webp, image/avif, video/mp4 ve video/webm yazın.",
        ...storageNote,
        "Canlı sitede Medya sayfasından 4,5 MB’tan büyük bir deneme fotoğrafı ve kısa bir MP4 deneme videosu yükleyin; ayrıntı panelinde fotoğrafın göründüğünü ve videonun oynadığını kontrol edin, sonra iki dosyayı da silin.",
        "Deneme yüklemesi “Depolama dosyayı reddetti (HTTP 401): … API key …” gibi bir hatayla reddedilirse SUPABASE_PUBLISHABLE_KEY değişkenine projenin yayımlanabilir (publishable) anahtarını ekleyin; bu anahtar gizli değildir. “Depolama dosyayı reddetti (HTTP 400)” genellikle dosya türü veya boyut sınırı demektir: yukarıdaki izin verilen türleri ve 50 MB sınırını kontrol edin.",
      ],
      links: [{ label: "Supabase", url: "https://supabase.com/dashboard" }],
      done: storage === undefined ? null : storage === "supabase",
      panelHref: "/panel/medya",
      panelLabel: "Medya",
    },
    {
      key: "gift-wheel-slices",
      group: "wheel",
      title: "Hediye çarkı dilimleri",
      steps: [
        "İlk kurulumda çarka altı örnek dilim konuldu: %5, %10, ücretsiz kargo, %15, 300 TL ve üzeri alışverişte 50 TL, 750 TL ve üzeri alışverişte %20 indirim.",
        "Hediye Çarkı › Ayarlar'da her dilimin ödülünü, alt sepet tutarını ve ödülün kaç saat geçerli olduğunu kârlılığınıza göre kontrol edin; uymayan dilimi değiştirin veya çıkarın.",
        "Önizlemedeki yüzdeler her dilimin gelme olasılığıdır; büyük indirimlerin olasılığını düşük tutun. Her dilim bir ödüldür, boş dilim eklenemez.",
        ...wheelNote,
      ],
      links: [],
      done: null,
      panelHref: "/panel/hediye-carki/ayarlar",
      panelLabel: "Hediye Çarkı ayarları",
    },
    {
      key: "wheel-terms-review",
      group: "wheel",
      title: "Hediye çarkı kampanya koşulları: avukat onayı",
      steps: [
        ...termsNote,
        "“Hediye Çarkı Kampanya Koşulları” bir taslaktır (taslak — avukat onayı bekliyor). Avukat onayı gelene kadar çarkı Hediye Çarkı › Ayarlar'dan kapalı tutun; siteyi çark açıkken yayına almayın.",
        "Kampanya dönemini, e-posta adresini ve köşeli parantez içindeki diğer alanları doldurun.",
        "Metni avukatınıza okutun. Özellikle şunları sorun: kampanyanın izin gerektiren bir çekiliş sayılıp sayılmadığı, hatırlatma e-postasının yalnızca e-bülten onayı vermiş üyelere gönderilmesinin yeterli olup olmadığı, kötüye kullanılarak alınan ödüllerde ne yapılacağı ve çark çerezinin Çerez Politikası'na eklenmesi.",
        "Onaylanan metni Yasal Metinler'de yeni sürüm olarak yayınlayın; sürüm adı “taslak” ile başlamasın (ör. “2026-12 v1”) ve taslak uyarısını kaldırın.",
      ],
      links: [],
      done: terms === undefined ? null : terms !== null && !isDraftLegalVersion(terms),
      panelHref: `/panel/yasal/${WHEEL_TERMS_LEGAL_KEY}`,
      panelLabel: "Kampanya koşulları",
    },
  ];
}

/**
 * Every step in display order, grouped (LAUNCH_GROUPS): before go-live (media storage, seller details, contracts,
 * e-mail, site address, cron, admin mails, prices, havale, shipping), before the wheel (slices, terms), after go-live
 * (the search-engine steps with the exact URLs to paste). Static copy; `done` from settings.
 */
export function launchChecklist(input: LaunchChecklistInput): LaunchStep[] {
  const urls = seoToolUrls(input.origin);
  const day6 = goLiveSteps(input);
  return [
    ...day6.filter((step) => step.group === "before"),
    ...siteReadySteps(input),
    ...salesReadySteps(input),
    ...day6.filter((step) => step.group === "wheel"),
    {
      key: "google-search-console",
      group: "after",
      title: "Google Search Console",
      steps: [
        "“URL öneki” ile mülk ekleyin ve aşağıdaki mülk adresini girin (sonu / ile biten ana adres, /tr olmadan); böylece tüm diller, site haritası ve ürün akışı aynı mülkte olur.",
        "Doğrulama yöntemi olarak “HTML etiketi”ni seçin; content değerini SEO ayarlarındaki Google alanına yapıştırıp kaydedin, sonra Doğrula'ya basın.",
        "“Site haritaları” bölümüne site haritası adresini ekleyin.",
      ],
      links: [
        { label: "Search Console", url: "https://search.google.com/search-console" },
        { label: "Mülk adresi", url: urls.site, copy: true },
        { label: "Site haritası", url: urls.sitemap, copy: true },
      ],
      done: input.verification.google !== "",
      panelHref: "/panel/ayarlar/seo",
      panelLabel: "Doğrulama kodu",
    },
    {
      key: "bing-webmaster",
      group: "after",
      title: "Bing Webmaster Tools",
      steps: [
        "En kolayı: “Google Search Console'dan içe aktar” seçeneğiyle siteyi ve site haritasını tek adımda alın.",
        "Ya da “HTML meta etiketi” ile doğrulayın; kodu SEO ayarlarındaki Bing alanına yapıştırın.",
      ],
      links: [
        { label: "Bing Webmaster Tools", url: "https://www.bing.com/webmasters" },
        { label: "Site haritası", url: urls.sitemap, copy: true },
      ],
      done: input.verification.bing !== "" ? true : null,
      panelHref: "/panel/ayarlar/seo",
      panelLabel: "Doğrulama kodu",
    },
    {
      key: "yandex-webmaster",
      group: "after",
      title: "Yandex Webmaster",
      steps: [
        "Siteyi ekleyin, “Meta etiketi” ile doğrulayın; kodu SEO ayarlarındaki Yandex alanına yapıştırın.",
        "“Site haritası dosyaları” bölümüne site haritası adresini ekleyin.",
      ],
      links: [
        { label: "Yandex Webmaster", url: "https://webmaster.yandex.com" },
        { label: "Site haritası", url: urls.sitemap, copy: true },
      ],
      done: input.verification.yandex !== "",
      panelHref: "/panel/ayarlar/seo",
      panelLabel: "Doğrulama kodu",
    },
    {
      key: "google-business-profile",
      group: "after",
      title: "Google İşletme Profili",
      steps: [
        `Kayseri adresiniz için profil açın veya sahiplenin${input.address ? ` (${input.address})` : ""}; adres, telefon ve site adresi sitedekiyle aynı olsun.`,
        "Çalışma saatlerini ve gerçek fotoğrafları (ürünler, üretim yeri, ekip) ekleyin.",
        "Memnun müşterilerinizden Google'da yorum yazmalarını isteyin; yorumlara yanıt verin.",
      ],
      links: [
        { label: "Google İşletme Profili", url: "https://www.google.com/business/" },
        { label: "Site adresi", url: urls.storefront, copy: true },
      ],
      done: null,
    },
    {
      key: "google-merchant-center",
      group: "after",
      title: "Google Merchant Center",
      steps: [
        "Hesap açın, site adresinizi doğrulayın (Search Console ile bağlamak yeterli).",
        "Ürün kaynağı eklerken “bağlantıdan (URL) dosya getir” seçeneğini seçin, ürün akışı adresini yapıştırın ve getirme sıklığını günlük yapın.",
        "Kargo ayarlarını (Türkiye) ve iade politikasını sitedekiyle aynı girin.",
      ],
      links: [
        { label: "Merchant Center", url: "https://merchants.google.com" },
        { label: "Ürün akışı", url: urls.merchantFeed, copy: true },
      ],
      done: null,
      panelHref: "/panel/ayarlar/seo",
      panelLabel: "İade politikası",
    },
    {
      key: "social-profiles",
      group: "after",
      title: "Sosyal medya profilleri",
      steps: ["Instagram, Facebook, YouTube, TikTok ve LinkedIn hesaplarınızın adreslerini Firma bilgilerine girin; arama motorları markanızın hesaplarını buradan tanır."],
      links: [],
      done: input.socialLinks > 0,
      panelHref: "/panel/ayarlar/genel",
      panelLabel: "Firma bilgileri",
    },
    {
      key: "indexnow",
      group: "after",
      title: "IndexNow (Bing ve Yandex'e hızlı haber)",
      steps: [
        "Barındırma (hosting) ayarlarında INDEXNOW_KEY ortam değişkenine 8–128 karakterlik, harf, rakam ve tireden oluşan bir anahtar girin; site yeniden başlatılınca devreye girer.",
        "Sonrasında değişen sayfalar her gün kendiliğinden bildirilir; bu sayfada bir şey yapmanız gerekmez.",
      ],
      links: [{ label: "Anahtar dosyası", url: urls.indexNowKey, copy: true }],
      done: input.indexNow === "set",
    },
    {
      key: "links",
      group: "after",
      title: "Başka sitelerden bağlantılar",
      steps: [
        "Tedarikçilerinizden, iş ortaklarınızdan, çalıştığınız otel ve işletmelerden sitenize bağlantı vermelerini isteyin.",
        "Kayseri'deki yerel rehberlere ve sektör listelerine firmanızı aynı ad, adres ve telefonla ekleyin.",
      ],
      links: [{ label: "Site adresi", url: urls.storefront, copy: true }],
      done: null,
    },
  ];
}
