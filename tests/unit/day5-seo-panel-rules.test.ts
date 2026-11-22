// Day 5 SEO-PANEL: the SEO Kontrol rules (src/lib/panel/seo/rules.ts). Every check of docs/DAY5-SEO.md
// §5.4 with its boundaries: title 30–60, description 120–160, H1, body words, translations, alt texts,
// GTIN, noindex, share image, duplicates; the status of a row and the report counts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  altFindings,
  bodyFindings,
  buildSeoReport,
  descriptionFindings,
  duplicateFindings,
  gtinFindings,
  h1Findings,
  noIndexFindings,
  pageFindings,
  rowId,
  SEO_LIMITS,
  seoLength,
  seoStatus,
  shareImageFindings,
  titleFindings,
  translationFindings,
  type SeoFinding,
  type SeoPageInput,
} from "@/lib/panel/seo/rules";

const codes = (findings: SeoFinding[]) => findings.map((f) => f.code);
const severities = (findings: SeoFinding[]) => findings.map((f) => f.severity);
const text = (n: number, char = "a") => char.repeat(n);

/** A row that passes every rule; tests change one field at a time. */
function row(overrides: Partial<SeoPageInput> = {}): SeoPageInput {
  return {
    key: "product:1",
    kind: "product",
    label: "Lavanta · Sıvı El Sabunu",
    locale: "tr",
    path: "/tr/urunler/lavanta",
    editHref: "/panel/urunler/1",
    title: "Lavanta Sıvı El Sabunu – 5 L ve 20 L Bidon",
    fullTitle: "Lavanta Sıvı El Sabunu – 5 L ve 20 L Bidon | PRESTİJ",
    description: text(140),
    lowPriority: false,
    h1: "Lavanta Sıvı El Sabunu",
    h1Count: 1,
    body: { words: 120, min: 80, noun: "Ürün açıklaması", shownInTurkish: false },
    untranslated: [],
    imagesWithoutAlt: 0,
    variantsWithoutGtin: [],
    noIndex: false,
    shareImage: "own",
    ...overrides,
  };
}

describe("seoLength", () => {
  test("counts visible characters: trimmed, whitespace collapsed, Turkish and Arabic letters once", () => {
    assert.equal(seoLength("  Duş   jeli \n"), 8);
    assert.equal(seoLength("İĞÜŞÖÇ"), 6);
    assert.equal(seoLength("جل الاستحمام"), 12);
    assert.equal(seoLength(""), 0);
    assert.equal(seoLength(null), 0);
  });
});

describe("title", () => {
  test("missing is an error; 30–60 characters pass; outside is a warning", () => {
    assert.deepEqual(codes(titleFindings("")), ["title_missing"]);
    assert.deepEqual(severities(titleFindings("   ")), ["error"]);
    assert.deepEqual(codes(titleFindings(text(SEO_LIMITS.title.min - 1))), ["title_short"]);
    assert.deepEqual(titleFindings(text(SEO_LIMITS.title.min)), []);
    assert.deepEqual(titleFindings(text(SEO_LIMITS.title.max)), []);
    assert.deepEqual(codes(titleFindings(text(SEO_LIMITS.title.max + 1))), ["title_long"]);
    assert.match(titleFindings(text(29))[0].message, /29 karakter/);
  });

  test("low-priority pages (legal texts) only get a note for the length, never for a missing title", () => {
    assert.deepEqual(severities(titleFindings(text(10), true)), ["info"]);
    assert.deepEqual(severities(titleFindings(text(70), true)), ["info"]);
    assert.deepEqual(severities(titleFindings("", true)), ["error"]);
  });
});

describe("description", () => {
  test("missing is an error; 120–160 pass; outside is a warning", () => {
    assert.deepEqual(codes(descriptionFindings("")), ["description_missing"]);
    assert.deepEqual(severities(descriptionFindings("")), ["error"]);
    assert.deepEqual(codes(descriptionFindings(text(119))), ["description_short"]);
    assert.deepEqual(descriptionFindings(text(120)), []);
    assert.deepEqual(descriptionFindings(text(160)), []);
    assert.deepEqual(codes(descriptionFindings(text(161))), ["description_long"]);
  });

  test("low-priority pages get notes only", () => {
    assert.deepEqual(severities(descriptionFindings("", true)), ["info"]);
    assert.deepEqual(severities(descriptionFindings(text(20), true)), ["info"]);
  });
});

describe("H1, body, translations, images, GTIN, noindex, share image", () => {
  test("H1: missing (no text or no heading) is an error, more than one is a warning", () => {
    assert.deepEqual(codes(h1Findings("", 1)), ["h1_missing"]);
    assert.deepEqual(codes(h1Findings("Başlık", 0)), ["h1_missing"]);
    assert.deepEqual(h1Findings("Başlık", 1), []);
    assert.deepEqual(codes(h1Findings("Başlık", 2)), ["h1_multiple"]);
    assert.match(h1Findings("Başlık", 3)[0].message, /3 ana başlık/);
  });

  test("body: none is an error, under the minimum a warning, a Turkish fallback is left to the translation rule", () => {
    assert.deepEqual(bodyFindings(null), []);
    const body = { min: 150, noun: "Kategori metni", shownInTurkish: false };
    assert.deepEqual(codes(bodyFindings({ ...body, words: 0 })), ["body_missing"]);
    assert.match(bodyFindings({ ...body, words: 0 })[0].message, /^Kategori metni yok/);
    assert.deepEqual(codes(bodyFindings({ ...body, words: 149 })), ["body_short"]);
    assert.match(bodyFindings({ ...body, words: 149 })[0].message, /149 kelime \(en az 150/);
    assert.deepEqual(bodyFindings({ ...body, words: 150 }), []);
    assert.deepEqual(bodyFindings({ ...body, words: 40, shownInTurkish: true }), []);
  });

  test("translations: one warning listing the Turkish fallbacks, never on the Turkish page", () => {
    assert.deepEqual(translationFindings(["başlık"], "tr"), []);
    assert.deepEqual(translationFindings([], "en"), []);
    const [f] = translationFindings(["başlık", "açıklama", "başlık"], "ar");
    assert.equal(f.code, "untranslated");
    assert.equal(f.severity, "warning");
    assert.match(f.message, /^Arapça çevirisi eksik/);
    assert.match(f.message, /başlık, açıklama\.$/);
  });

  test("images without alt text, per language", () => {
    assert.deepEqual(altFindings(0, "tr"), []);
    const [f] = altFindings(2, "en");
    assert.equal(f.code, "alt_missing");
    assert.match(f.message, /2 görselin İngilizce alternatif metni yok/);
  });

  test("variants without a valid GTIN list up to four SKUs", () => {
    assert.deepEqual(gtinFindings(null), []);
    assert.deepEqual(gtinFindings([]), []);
    assert.match(gtinFindings(["A"])[0].message, /^1 varyantın .*: A\./);
    const many = gtinFindings(["A", "B", "C", "D", "E", "F"])[0].message;
    assert.match(many, /^6 varyantın/);
    assert.match(many, /A, B, C, D ve 2 varyant daha/);
  });

  test("noindex is a warning; share image: none is a warning, the site default a note", () => {
    assert.deepEqual(noIndexFindings(false), []);
    assert.deepEqual(codes(noIndexFindings(true)), ["noindex"]);
    assert.deepEqual(shareImageFindings("own"), []);
    assert.deepEqual(severities(shareImageFindings("default")), ["info"]);
    assert.deepEqual(severities(shareImageFindings("none")), ["warning"]);
  });

  test("pageFindings runs every single-page rule", () => {
    assert.deepEqual(pageFindings(row()), []);
    const all = pageFindings(
      row({
        locale: "en",
        title: "",
        description: "",
        h1: "",
        body: { words: 0, min: 80, noun: "Ürün açıklaması", shownInTurkish: false },
        untranslated: ["başlık"],
        imagesWithoutAlt: 1,
        variantsWithoutGtin: ["PR-1"],
        noIndex: true,
        shareImage: "none",
      }),
    );
    assert.deepEqual(codes(all), [
      "title_missing",
      "description_missing",
      "h1_missing",
      "body_missing",
      "untranslated",
      "alt_missing",
      "gtin_missing",
      "noindex",
      "share_image_missing",
    ]);
  });
});

describe("duplicates", () => {
  const a = row({ key: "category:1", label: "El Sabunu", fullTitle: "Sıvı El Sabunu | PRESTİJ", description: "Aynı açıklama." });
  const b = row({ key: "category:2", label: "Duş Jeli", fullTitle: "  sıvı el   SABUNU | PRESTİJ ", description: "Aynı  açıklama." });

  test("same title / description on two pages of one language (case and spacing ignored) → both flagged", () => {
    const found = duplicateFindings([a, b]);
    assert.deepEqual(codes(found.get(rowId(a)) ?? []), ["title_duplicate", "description_duplicate"]);
    assert.deepEqual(codes(found.get(rowId(b)) ?? []), ["title_duplicate", "description_duplicate"]);
    assert.match(found.get(rowId(a))![0].message, /Duş Jeli/);
    assert.match(found.get(rowId(b))![0].message, /El Sabunu/);
  });

  test("different languages, noindex pages, empty descriptions and one page's own rows are not duplicates", () => {
    assert.equal(duplicateFindings([a, { ...b, locale: "en" }]).size, 0);
    assert.equal(duplicateFindings([a, { ...b, noIndex: true }]).size, 0);
    assert.equal(duplicateFindings([{ ...a, fullTitle: "x", description: "" }, { ...b, fullTitle: "y", description: "" }]).size, 0);
    assert.equal(duplicateFindings([a, { ...a }]).size, 0);
  });

  test("lists at most three other pages", () => {
    const rows = ["1", "2", "3", "4", "5"].map((id) => row({ key: `page:${id}`, label: `Sayfa ${id}`, fullTitle: "Aynı | PRESTİJ", description: `d${id}` }));
    const message = duplicateFindings(rows).get(rowId(rows[0]))![0].message;
    assert.match(message, /Sayfa 2, Sayfa 3, Sayfa 4 ve 1 sayfa daha/);
  });
});

describe("status and report", () => {
  test("any error → Eksik, else any warning → Geliştirilebilir, else İyi (notes never lower it)", () => {
    assert.equal(seoStatus([]), "good");
    assert.equal(seoStatus(shareImageFindings("default")), "good");
    assert.equal(seoStatus([...shareImageFindings("default"), ...noIndexFindings(true)]), "improve");
    assert.equal(seoStatus([...noIndexFindings(true), ...titleFindings("")]), "missing");
  });

  test("buildSeoReport grades every row, adds duplicates, sorts findings by severity and counts statuses", () => {
    const good = row({ key: "product:1", description: text(140, "a") });
    const dupe1 = row({ key: "product:2", fullTitle: "Aynı | PRESTİJ", description: text(140, "b"), shareImage: "default" });
    const dupe2 = row({ key: "product:3", fullTitle: "Aynı | PRESTİJ", description: text(140, "c") });
    const broken = row({ key: "product:4", title: "", fullTitle: "", description: text(140, "d"), noIndex: true });
    const report = buildSeoReport([good, dupe1, dupe2, broken]);
    assert.deepEqual(
      report.rows.map((r) => r.key),
      ["product:1", "product:2", "product:3", "product:4"],
    );
    assert.deepEqual(report.rows.map((r) => r.status), ["good", "improve", "improve", "missing"]);
    assert.deepEqual(codes(report.rows[1].findings), ["title_duplicate", "share_image_default"]);
    assert.deepEqual(codes(report.rows[3].findings), ["title_missing", "noindex"]);
    assert.deepEqual(report.counts, { missing: 1, improve: 2, good: 1 });
  });
});
