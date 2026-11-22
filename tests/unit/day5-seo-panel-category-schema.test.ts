// Day 5 SEO-PANEL: the category save schema's editorial body and FAQ (src/lib/panel/categories/schema.ts).
// The body is sanitized like blog bodies; FAQ answers are plain text or the sanitized subset; error
// paths match the editor's fields; leaving the new fields out keeps what is stored.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CATEGORY_LIMITS, categorySaveSchema } from "@/lib/panel/categories/schema";

const base = {
  id: null,
  updatedAt: null,
  slug: "day5-test-kategori",
  name: { tr: "Test" },
  description: null,
  imageId: null,
  accentColor: "",
  isVisible: true,
  seo: { title: null, description: null, ogImageId: null, noIndex: false },
};

const errors = (value: unknown) => {
  const result = categorySaveSchema.safeParse(value);
  assert.equal(result.success, false, "expected a validation error");
  return Object.fromEntries(result.error!.issues.map((i) => [i.path.join("."), i.message]));
};
const parse = (value: unknown) => categorySaveSchema.parse(value);
const item = (question: Record<string, string>, answer: Record<string, string>) => ({ question, answer });

describe("category body", () => {
  test("left out = undefined (keep stored), null/blank = null", () => {
    assert.equal(parse(base).body, undefined);
    assert.equal(parse(base).faq, undefined);
    assert.equal(parse({ ...base, body: null }).body, null);
    assert.equal(parse({ ...base, body: { tr: "<p><br></p>", en: "  ", ar: "" } }).body, null);
  });

  test("sanitized on save (scripts, event handlers and javascript: links removed); empty translations dropped", () => {
    const body = parse({
      ...base,
      body: {
        tr: '<h2 onclick="x()">Seçim</h2><p>Metin <script>alert(1)</script><a href="javascript:alert(1)">kötü</a> <a href="/urunler/lavanta">iyi</a></p>',
        en: "<p><br></p>",
        ar: "<p>نص</p>",
      },
    }).body!;
    assert.ok(!/script|onclick|javascript/i.test(body.tr), body.tr);
    assert.match(body.tr, /<h2>Seçim<\/h2>/);
    assert.match(body.tr, /<a href="\/urunler\/lavanta">iyi<\/a>/);
    assert.equal(body.en, undefined);
    assert.equal(body.ar, "<p>نص</p>");
  });

  test("a translation without Turkish and an over-long text are refused at body.tr", () => {
    assert.match(errors({ ...base, body: { tr: "", en: "<p>Text</p>" } })["body.tr"], /Önce Türkçe/);
    assert.match(errors({ ...base, body: { tr: `<p>${"a".repeat(CATEGORY_LIMITS.body + 1)}</p>` } })["body.tr"], /çok uzun/);
  });
});

describe("category FAQ", () => {
  test("questions trimmed; plain-text answers kept (blank line = paragraph); HTML answers sanitized", () => {
    const faq = parse({
      ...base,
      faq: [
        item({ tr: "  Hangi boyu seçmeliyim? " }, { tr: "Evde pompalı şişe.\n\nİşletmede 5 L bidon." }),
        item({ tr: "Bidon nasıl doldurulur?", en: "How do I refill?" }, { tr: '<p>Temizleyin <a href="/numune" onclick="x">numune</a><img src=x></p>', en: "Clean it first." }),
      ],
    }).faq!;
    assert.equal(faq[0].question.tr, "Hangi boyu seçmeliyim?");
    assert.equal(faq[0].answer.tr, "Evde pompalı şişe.\n\nİşletmede 5 L bidon.");
    assert.equal(faq[1].answer.tr, '<p>Temizleyin <a href="/numune">numune</a></p>');
    assert.equal(faq[1].answer.en, "Clean it first.");
    assert.deepEqual(parse({ ...base, faq: [] }).faq, []);
  });

  test("Turkish question and answer are required; an answer that is only empty HTML counts as missing", () => {
    const e = errors({ ...base, faq: [item({ tr: "" }, { tr: "Cevap" }), item({ tr: "Soru" }, { tr: "" }), item({ tr: "Soru" }, { tr: "<p> </p>" })] });
    assert.match(e["faq.0.question.tr"], /Soruyu Türkçe/);
    assert.match(e["faq.1.answer.tr"], /Cevabı Türkçe/);
    assert.match(e["faq.2.answer.tr"], /Cevabı Türkçe/);
  });

  test("a language with a question but no answer (or the reverse) is refused at that language", () => {
    const e = errors({ ...base, faq: [item({ tr: "S", en: "Q" }, { tr: "C" }), item({ tr: "S" }, { tr: "C", ar: "ج" })] });
    assert.match(e["faq.0.answer.en"], /İngilizce soru var ama İngilizce cevap yok/);
    assert.match(e["faq.1.question.ar"], /Arapça cevap var ama Arapça soru yok/);
  });

  test("limits: at most 20 questions, 200 / 2000 characters; a non-list is refused at faq", () => {
    const many = Array.from({ length: CATEGORY_LIMITS.faqItems + 1 }, (_, i) => item({ tr: `Soru ${i}` }, { tr: "Cevap" }));
    assert.match(errors({ ...base, faq: many }).faq, /En fazla 20 soru/);
    assert.ok(errors({ ...base, faq: [item({ tr: "a".repeat(CATEGORY_LIMITS.question + 1) }, { tr: "C" })] })["faq.0.question.tr"]);
    assert.ok(errors({ ...base, faq: [item({ tr: "S" }, { tr: "a".repeat(CATEGORY_LIMITS.answer + 1) })] })["faq.0.answer.tr"]);
    assert.match(errors({ ...base, faq: "x" }).faq, /Geçersiz soru listesi/);
  });
});
