// SEO Kontrol (/panel/seo): the rules that grade one storefront URL (a page in one language).
// Pure (no DB, no Next APIs): unit-tested in tests/unit/day5-seo-panel-rules.test.ts. The inputs are
// built from the database by ./pages.ts (pure) and ./queries.ts (server-only).
//
// Status of a row: any "error" finding → Eksik, else any "warning" → Geliştirilebilir, else İyi.
// "info" findings are notes that never lower the status.
import type { Locale } from "@/i18n/locales";

/** The contract's targets (docs/DAY5-SEO.md §5.4). Titles are counted without the " | PRESTİJ" suffix. */
export const SEO_LIMITS = {
  title: { min: 30, max: 60 },
  description: { min: 120, max: 160 },
  /** Minimum words of the main text per page kind. */
  words: { category: 150, product: 80, post: 400 },
} as const;

export type SeoPageKind = "home" | "products" | "category" | "product" | "page" | "post";
export type SeoSeverity = "error" | "warning" | "info";
export type SeoStatus = "missing" | "improve" | "good";

export type SeoFindingCode =
  | "title_missing"
  | "title_short"
  | "title_long"
  | "title_duplicate"
  | "description_missing"
  | "description_short"
  | "description_long"
  | "description_duplicate"
  | "h1_missing"
  | "h1_multiple"
  | "body_missing"
  | "body_short"
  | "untranslated"
  | "alt_missing"
  | "gtin_missing"
  | "noindex"
  | "share_image_missing"
  | "share_image_default";

export type SeoFinding = { code: SeoFindingCode; severity: SeoSeverity; message: string };

export type SeoBodyInput = {
  /** Words of the text the page shows in this language (the Turkish text when it falls back). */
  words: number;
  min: number;
  /** "Kategori metni", "Ürün açıklaması", "Yazı metni". */
  noun: string;
  /** No text in this language: the page shows the Turkish one (reported as a translation gap instead). */
  shownInTurkish: boolean;
};

/** One storefront URL as the visitor (and a search engine) sees it. */
export type SeoPageInput = {
  /** The entity, e.g. "product:4"; the same for all three languages of one page. */
  key: string;
  kind: SeoPageKind;
  /** Turkish name shown in the panel. */
  label: string;
  locale: Locale;
  /** Public path in this language, e.g. "/en/products/lavanta". */
  path: string;
  /** Panel editor of the entity. */
  editHref: string;
  /** The page's own title, before the site suffix (the home page: the whole title). */
  title: string;
  /** The text of <title> (template applied). */
  fullTitle: string;
  /** The page's own meta description in this language; "" = none (the site default is used). */
  description: string;
  /**
   * Legal texts and similar pages nobody searches for: title/description length and a missing
   * description are notes (info) only.
   */
  lowPriority: boolean;
  /** Text of the page's first <h1> ("" = none). */
  h1: string;
  h1Count: number;
  /** Main text rule, or null when the page kind has none. */
  body: SeoBodyInput | null;
  /** Texts shown in Turkish on an en/ar page because the translation is missing ("başlık", "H1", …). */
  untranslated: string[];
  /** Images on the page without an alternative text in this language. */
  imagesWithoutAlt: number;
  /** SKUs of active variants without a valid EAN-13 barcode; null = not a product page. */
  variantsWithoutGtin: string[] | null;
  noIndex: boolean;
  /** Why the page is noindex when it is not the editor's switch: "business_only" (Yalnızca kurumsal product). */
  noIndexReason?: "business_only";
  /** "own": the page's own share image; "default": the site's default one; "none": no image at all. */
  shareImage: "own" | "default" | "none";
};

export type SeoRow = SeoPageInput & { findings: SeoFinding[]; status: SeoStatus };

export type SeoReport = {
  rows: SeoRow[];
  counts: Record<SeoStatus, number>;
};

const LOCALE_NAMES: Record<Locale, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

/** Visible characters (code points) after trimming and collapsing whitespace. */
export function seoLength(text: string | null | undefined): number {
  return [...(text ?? "").replace(/\s+/g, " ").trim()].length;
}

/** Comparison key for duplicate titles/descriptions: whitespace collapsed, lower case for the language. */
export function duplicateKey(text: string, locale: Locale): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase(locale === "tr" ? "tr-TR" : locale === "ar" ? "ar" : "en-US");
}

const finding = (code: SeoFindingCode, severity: SeoSeverity, message: string): SeoFinding => ({ code, severity, message });

export function titleFindings(title: string, lowPriority = false): SeoFinding[] {
  const n = seoLength(title);
  const { min, max } = SEO_LIMITS.title;
  const soft: SeoSeverity = lowPriority ? "info" : "warning";
  if (n === 0) return [finding("title_missing", "error", "Sayfa başlığı yok.")];
  if (n < min) return [finding("title_short", soft, `Başlık kısa: ${n} karakter (${min}–${max} önerilir).`)];
  if (n > max) return [finding("title_long", soft, `Başlık uzun: ${n} karakter; arama sonuçlarında yaklaşık ${max} karakterden sonrası kesilir.`)];
  return [];
}

export function descriptionFindings(description: string, lowPriority = false): SeoFinding[] {
  const n = seoLength(description);
  const { min, max } = SEO_LIMITS.description;
  const soft: SeoSeverity = lowPriority ? "info" : "warning";
  if (n === 0) {
    return [
      finding(
        "description_missing",
        lowPriority ? "info" : "error",
        "Açıklama yok; sitenin genel açıklaması kullanılıyor ve başka sayfalarla aynı görünüyor.",
      ),
    ];
  }
  if (n < min) return [finding("description_short", soft, `Açıklama kısa: ${n} karakter (${min}–${max} önerilir).`)];
  if (n > max) return [finding("description_long", soft, `Açıklama uzun: ${n} karakter; ${max} karakterden sonrası kesilebilir.`)];
  return [];
}

export function h1Findings(h1: string, count: number): SeoFinding[] {
  if (count <= 0 || seoLength(h1) === 0) return [finding("h1_missing", "error", "Sayfada ana başlık (H1) yok.")];
  if (count > 1) return [finding("h1_multiple", "warning", `Sayfada ${count} ana başlık (H1) var; tek olmalı (birden fazla kapak bölümü olabilir).`)];
  return [];
}

export function bodyFindings(body: SeoBodyInput | null): SeoFinding[] {
  if (!body) return [];
  if (body.words === 0) return [finding("body_missing", "error", `${body.noun} yok.`)];
  // A Turkish fallback is reported once, by translationFindings.
  if (body.shownInTurkish) return [];
  if (body.words < body.min) {
    return [finding("body_short", "warning", `${body.noun} kısa: ${body.words} kelime (en az ${body.min} kelime önerilir).`)];
  }
  return [];
}

export function translationFindings(untranslated: readonly string[], locale: Locale): SeoFinding[] {
  if (locale === "tr" || untranslated.length === 0) return [];
  const list = [...new Set(untranslated)].join(", ");
  return [finding("untranslated", "warning", `${LOCALE_NAMES[locale]} çevirisi eksik, sayfada Türkçesi görünüyor: ${list}.`)];
}

export function altFindings(count: number, locale: Locale): SeoFinding[] {
  if (count <= 0) return [];
  return [finding("alt_missing", "warning", `${count} görselin ${LOCALE_NAMES[locale]} alternatif metni yok (Medya'dan eklenir).`)];
}

export function gtinFindings(skus: readonly string[] | null): SeoFinding[] {
  if (!skus || skus.length === 0) return [];
  const shown = skus.slice(0, 4).join(", ");
  const more = skus.length > 4 ? ` ve ${skus.length - 4} varyant daha` : "";
  return [
    finding(
      "gtin_missing",
      "warning",
      `${skus.length} varyantın geçerli barkodu (GTIN / EAN-13) yok: ${shown}${more}. Etikette barkod varsa varyanta girin.`,
    ),
  ];
}

export function noIndexFindings(noIndex: boolean, reason?: SeoPageInput["noIndexReason"]): SeoFinding[] {
  if (!noIndex) return [];
  if (reason === "business_only") {
    return [
      finding(
        "noindex",
        "info",
        "Yalnızca kurumsal ürün: perakende müşteriler satın alamadığı için arama motorlarından gizli (noindex); site haritasında ve ürün akışında da yok.",
      ),
    ];
  }
  return [finding("noindex", "warning", "Arama motorlarından gizli (noindex). Bilerek yapmadıysanız editörde kapatın.")];
}

export function shareImageFindings(state: SeoPageInput["shareImage"]): SeoFinding[] {
  if (state === "none") return [finding("share_image_missing", "warning", "Paylaşım görseli yok; sosyal medyada görselsiz görünür.")];
  if (state === "default") return [finding("share_image_default", "info", "Paylaşımda sitenin varsayılan görseli kullanılıyor.")];
  return [];
}

/** Every single-page rule for one row, in display order (duplicates come from duplicateFindings). */
export function pageFindings(input: SeoPageInput): SeoFinding[] {
  return [
    ...titleFindings(input.title, input.lowPriority),
    ...descriptionFindings(input.description, input.lowPriority),
    ...h1Findings(input.h1, input.h1Count),
    ...bodyFindings(input.body),
    ...translationFindings(input.untranslated, input.locale),
    ...altFindings(input.imagesWithoutAlt, input.locale),
    ...gtinFindings(input.variantsWithoutGtin),
    ...noIndexFindings(input.noIndex, input.noIndexReason),
    ...shareImageFindings(input.shareImage),
  ];
}

export const rowId = (row: Pick<SeoPageInput, "key" | "locale">) => `${row.key}|${row.locale}`;

/**
 * Same <title> or same own description on two indexable pages of one language (search engines then
 * cannot tell them apart). Pages hidden with noindex and empty descriptions are left out (a missing
 * description is already reported). Returns findings keyed by rowId.
 */
export function duplicateFindings(
  rows: readonly Pick<SeoPageInput, "key" | "locale" | "label" | "fullTitle" | "description" | "noIndex">[],
): Map<string, SeoFinding[]> {
  const out = new Map<string, SeoFinding[]>();
  const add = (id: string, f: SeoFinding) => out.set(id, [...(out.get(id) ?? []), f]);
  const groups = (field: "fullTitle" | "description") => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const text = row[field];
      if (row.noIndex || seoLength(text) === 0) continue;
      const key = `${row.locale}|${duplicateKey(text, row.locale)}`;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.values()].filter((group) => new Set(group.map((r) => r.key)).size > 1);
  };
  const others = (group: typeof rows, row: (typeof rows)[number]) => {
    const labels = [...new Set(group.filter((r) => r.key !== row.key).map((r) => r.label))];
    return labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` ve ${labels.length - 3} sayfa daha` : "");
  };
  for (const group of groups("fullTitle")) {
    for (const row of group) add(rowId(row), finding("title_duplicate", "warning", `Başlık şu sayfayla aynı: ${others(group, row)}.`));
  }
  for (const group of groups("description")) {
    for (const row of group) add(rowId(row), finding("description_duplicate", "warning", `Açıklama şu sayfayla aynı: ${others(group, row)}.`));
  }
  return out;
}

export function seoStatus(findings: readonly SeoFinding[]): SeoStatus {
  if (findings.some((f) => f.severity === "error")) return "missing";
  if (findings.some((f) => f.severity === "warning")) return "improve";
  return "good";
}

const SEVERITY_ORDER: Record<SeoSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Grades every row (single-page rules + duplicates) and counts the statuses. Input order is kept. */
export function buildSeoReport(inputs: readonly SeoPageInput[]): SeoReport {
  const duplicates = duplicateFindings(inputs);
  const rows = inputs.map((input): SeoRow => {
    const findings = [...pageFindings(input), ...(duplicates.get(rowId(input)) ?? [])].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    return { ...input, findings, status: seoStatus(findings) };
  });
  const counts: Record<SeoStatus, number> = { missing: 0, improve: 0, good: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { rows, counts };
}

export const SEO_STATUS_LABELS: Record<SeoStatus, string> = { missing: "Eksik", improve: "Geliştirilebilir", good: "İyi" };

export const SEO_KIND_LABELS: Record<SeoPageKind, string> = {
  home: "Ana sayfa",
  products: "Tüm ürünler sayfası",
  category: "Kategoriler",
  product: "Ürünler",
  page: "Sayfalar",
  post: "Blog yazıları",
};
