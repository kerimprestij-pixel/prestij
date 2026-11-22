// STORE-UI (day 5): a category's editorial text and FAQ below the grid (CategoryContent): sanitized,
// in the visitor's own language, internal links localized, the FAQ in the Faq section's look with
// exactly one FAQPage block, nothing at all when the category has neither.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CategoryContent, { categoryBodyHtml, categoryFaqHeading, categoryFaqItems } from "@/components/store/CategoryContent";
import { defaultMessages } from "@/i18n/messages";

const t = (tr: string, en?: string, ar?: string) => ({ tr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) });

const BODY = t(
  '<h2>Nasıl seçilir?</h2><p>Pompalı şişe ya da <a href="/kategori/el-sabunu">5 L bidon</a>.</p><script>alert(1)</script><ul><li>Ev</li><li>Otel</li></ul>',
  '<h2>How to choose</h2><p>A pump bottle or a <a href="/urunler/lavanta">5 L canister</a>.</p>',
);

const FAQ = [
  { question: t("Bidon nasıl doldurulur?", "How do I refill?", "كيف أعيد التعبئة؟"), answer: t("Temiz ve kuru şişeye doldurun.", "Fill a clean, dry bottle.", "املأ عبوة نظيفة وجافة.") },
  { question: t("Numune var mı?"), answer: t("Evet, ücretsiz, satılmaz.") },
  { question: t("Boş cevap", "Empty answer"), answer: t("") },
];

describe("categoryBodyHtml", () => {
  test("sanitized (scripts dropped), internal links point to the reader's language", () => {
    const tr = categoryBodyHtml(BODY, "tr");
    assert.ok(tr.startsWith("<h2>Nasıl seçilir?</h2>"));
    assert.ok(!tr.includes("<script") && !tr.includes("alert(1)"));
    assert.ok(tr.includes('<a href="/tr/kategori/el-sabunu">'));
    assert.ok(tr.includes("<ul><li>Ev</li><li>Otel</li></ul>"));
    assert.ok(categoryBodyHtml(BODY, "en").includes('<a href="/en/products/lavanta">'));
  });

  test("only the visitor's own language: no Turkish body on /ar, no body at all → empty", () => {
    assert.equal(categoryBodyHtml(BODY, "ar"), "");
    assert.equal(categoryBodyHtml(null, "tr"), "");
    assert.equal(categoryBodyHtml(t("   "), "tr"), "");
  });

  test("plain text (no tags) becomes paragraphs", () => {
    assert.equal(categoryBodyHtml(t("Birinci paragraf.\n\nİkinci <paragraf>."), "tr"), "<p>Birinci paragraf.</p><p>İkinci &lt;paragraf&gt;.</p>");
  });
});

describe("categoryFaqItems / categoryFaqHeading", () => {
  test("items need a question and an answer in the visitor's language", () => {
    assert.deepEqual(
      categoryFaqItems(FAQ, "tr").map((i) => i.question.tr),
      ["Bidon nasıl doldurulur?", "Numune var mı?"],
    );
    assert.deepEqual(
      categoryFaqItems(FAQ, "en").map((i) => [i.question.tr, i.answer.tr]),
      [["How do I refill?", "Fill a clean, dry bottle."]],
    );
    assert.equal(categoryFaqItems([], "tr").length, 0);
  });

  test("default heading per locale; a dictionary key, once added, takes over", () => {
    assert.deepEqual(categoryFaqHeading("Sıvı El Sabunu", "tr", defaultMessages.tr), { eyebrow: "Sıkça sorulanlar", title: "Sıvı El Sabunu hakkında" });
    assert.deepEqual(categoryFaqHeading("Shower Gel", "en", defaultMessages.en), { eyebrow: "FAQ", title: "About Shower Gel" });
    assert.deepEqual(categoryFaqHeading("جل الاستحمام", "ar", defaultMessages.ar), { eyebrow: "الأسئلة الشائعة", title: "حول جل الاستحمام" });
    const custom = { ...defaultMessages.tr, category: { ...defaultMessages.tr.category, faqEyebrow: "SSS", faqTitle: "{category} için sorular" } };
    assert.deepEqual(categoryFaqHeading("Duş Jeli", "tr", custom), { eyebrow: "SSS", title: "Duş Jeli için sorular" });
  });
});

describe("CategoryContent", () => {
  const render = (props: Partial<Parameters<typeof CategoryContent>[0]> = {}, locale: "tr" | "en" | "ar" = "tr") =>
    renderToStaticMarkup(
      createElement(CategoryContent, {
        categoryName: "Sıvı El Sabunu",
        body: BODY,
        faq: FAQ,
        locale,
        messages: defaultMessages[locale],
        ...props,
      }),
    );

  test("body section, then the FAQ with its heading and exactly one FAQPage block; never an <h1>", () => {
    const html = render();
    assert.ok(html.indexOf("Nasıl seçilir?") < html.indexOf("Bidon nasıl doldurulur?"), "body above the FAQ");
    assert.equal(html.match(/"@type":"FAQPage"/g)?.length, 1);
    assert.equal(html.match(/<details/g)?.length, 2);
    assert.ok(html.includes("Sıkça sorulanlar") && html.includes("<h2") && html.includes("Sıvı El Sabunu hakkında"));
    assert.ok(!/<h1[\s>]/.test(html));
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]);
    assert.deepEqual(
      ld.mainEntity.map((q: { name: string }) => q.name),
      ["Bidon nasıl doldurulur?", "Numune var mı?"],
    );
  });

  test("each block renders on its own; nothing at all without body and FAQ", () => {
    assert.ok(!render({ faq: [] }).includes("FAQPage"));
    assert.ok(!render({ body: null }).includes("Nasıl seçilir?"));
    assert.equal(render({ body: null, faq: [] }), "");
    // /ar: no Arabic body and only one translated question.
    const ar = render({}, "ar");
    assert.ok(!ar.includes("Nasıl seçilir?"));
    assert.equal(ar.match(/<details/g)?.length, 1);
  });
});
