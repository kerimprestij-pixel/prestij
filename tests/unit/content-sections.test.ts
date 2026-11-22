// Page builder (CONTENT): every section type accepts a filled payload built from its own field specs
// (so new types such as contact_info/contact_form are covered automatically), unknown types and unsafe
// links are refused with Turkish messages at the editor's field paths, rich text is sanitized on save,
// and the collapsed-card summary reads the right text.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FieldSpec } from "@/components/sections/field-spec";
import { sectionMeta, sectionTypes, type SectionType } from "@/components/sections/schemas";
import { pageSaveSchema, sectionInput } from "@/lib/panel/content/schemas";
import {
  loadSectionContent,
  newSectionContent,
  normalizeSectionContent,
  rendersOnStorefront,
  sectionRefs,
  sectionSummary,
  stableJson,
} from "@/lib/panel/content/sections";

/** A sample value for every spec type (what an editor would enter); `index` varies selects across repeater items. */
function sampleFor(spec: FieldSpec, index: number): unknown {
  switch (spec.type) {
    case "text":
      return "/media/ornek";
    case "localized":
    case "localizedLong":
      return { tr: `Örnek ${spec.label}`, en: `Sample ${spec.key}`, ar: "نص" };
    case "localizedRich":
      return { tr: "<p>Örnek <strong>metin</strong></p>" };
    case "media":
    case "product":
      return 1;
    case "products":
      return [1, 2];
    case "number":
      return spec.min ?? 1;
    case "percent":
      return spec.min ?? 0;
    case "select":
      return spec.options[index % spec.options.length].value;
    case "switch":
      return true;
    case "link":
      return "/urunler";
    case "cta":
      return { label: { tr: "Keşfet", en: "Discover" }, href: "/urunler" };
    case "localizedList":
      return [{ tr: "Birinci madde" }, { tr: "İkinci madde" }];
    case "repeater":
      return Array.from({ length: Math.min(Math.max(spec.min ?? 0, 2), spec.max ?? 2) }, (_, i) => filled(spec.fields, i));
  }
}

function filled(fields: readonly FieldSpec[], index = 0): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.key, sampleFor(f, index)]));
}

const section = (type: string, content: unknown, extra: Record<string, unknown> = {}) => ({
  id: null,
  type,
  isVisible: true,
  audience: "all",
  schedule: { startsAt: null, endsAt: null },
  content,
  ...extra,
});

describe("every section type validates a filled payload", () => {
  for (const type of sectionTypes) {
    test(`${type}: filled content passes the panel rules and the schema`, () => {
      const content = filled(sectionMeta[type].fields);
      const result = normalizeSectionContent(type, content);
      assert.ok(result.ok, `${type}: ${result.ok ? "" : JSON.stringify(result.issues)}`);
      assert.ok(rendersOnStorefront(type, result.content), `${type}: stored content renders`);
      // Saving the stored content again changes nothing (stable normalization).
      const again = normalizeSectionContent(type, loadSectionContent(type, result.content));
      assert.ok(again.ok);
      assert.equal(stableJson(again.content), stableJson(result.content));
    });

    test(`${type}: a new section starts from the defaults in editor shape`, () => {
      const content = newSectionContent(type);
      assert.equal(typeof content, "object");
      assert.ok(sectionMeta[type].schema.safeParse(content).success, `${type}: defaults parse`);
    });

    test(`${type}: the section payload passes sectionInput`, () => {
      const parsed = sectionInput.safeParse(section(type, filled(sectionMeta[type].fields)));
      assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
      assert.equal(parsed.data.type, type);
      assert.equal(parsed.data.id, null);
    });
  }
});

describe("refused payloads", () => {
  test("unknown section type → error at sections.N.type", () => {
    const parsed = sectionInput.safeParse(section("marquee", { text: "x" }));
    assert.equal(parsed.success, false);
    const issue = !parsed.success ? parsed.error.issues[0] : null;
    assert.deepEqual(issue?.path, ["type"]);
    assert.match(issue?.message ?? "", /tanınmıyor/);
  });

  test("unsafe CTA, gallery and video links are refused with the Turkish link message", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//evil.example", " JaVaScRiPt:alert(1)"]) {
      const hero = normalizeSectionContent("hero", { headline: { tr: "Başlık" }, primaryCta: { label: { tr: "Git" }, href } });
      assert.equal(hero.ok, false, href);
      assert.deepEqual(!hero.ok && hero.issues.map((i) => i.path.join(".")), ["primaryCta.href"], href);
      assert.match(!hero.ok ? hero.issues[0].message : "", /ile başlamalı/);

      const gallery = normalizeSectionContent("lifestyle_gallery", { items: [{ imageId: 3, href }] });
      assert.equal(gallery.ok, false, href);
      assert.deepEqual(!gallery.ok && gallery.issues.map((i) => i.path.join(".")), ["items.0.href"]);
    }
    const video = normalizeSectionContent("hero", { headline: { tr: "Başlık" }, videoUrl: "javascript:alert(1)" });
    assert.equal(video.ok, false);
  });

  test("panel rules: required texts, buttons, images and products", () => {
    const hero = normalizeSectionContent("hero", { headline: { tr: "  ", en: "Only English" }, secondaryCta: { label: { tr: "" }, href: "" } });
    assert.equal(hero.ok, false);
    const byPath = Object.fromEntries((!hero.ok ? hero.issues : []).map((i) => [i.path.join("."), i.message]));
    assert.equal(byPath["headline.tr"], "Önce Türkçe metni girin.");
    assert.equal(byPath["secondaryCta.label.tr"], "Buton yazısı zorunlu.");
    assert.equal(byPath["secondaryCta.href"], "Bağlantı seçin.");
    assert.equal(byPath.headline, undefined, "no duplicate message on the parent path");

    const showcase = normalizeSectionContent("scent_showcase", { title: { tr: "Kokular" }, items: [{ productId: null, imageId: null }] });
    assert.equal(showcase.ok, false);
    assert.deepEqual(!showcase.ok && showcase.issues, [{ path: ["items", 0, "productId"], message: "Bir ürün seçin." }]);

    const gallery = normalizeSectionContent("lifestyle_gallery", { items: [{ imageId: null }] });
    assert.deepEqual(!gallery.ok && gallery.issues, [{ path: ["items", 0, "imageId"], message: "Bir görsel seçin." }]);
  });

  test("schema limits come back in Turkish", () => {
    const fp = normalizeSectionContent("featured_products", { limit: 30, columns: 5 });
    const byPath = Object.fromEntries((!fp.ok ? fp.issues : []).map((i) => [i.path.join("."), i.message]));
    assert.equal(byPath.limit, "En fazla 24 olabilir.");
    assert.equal(byPath.columns, "Listeden geçerli bir seçenek seçin.");

    const faq = normalizeSectionContent("faq", { items: [] });
    assert.deepEqual(!faq.ok && faq.issues, [{ path: ["items"], message: "En az 1 öğe ekleyin." }]);

    const banner = normalizeSectionContent("image_banner", { overlay: 95, align: "middle" });
    const bannerPaths = Object.fromEntries((!banner.ok ? banner.issues : []).map((i) => [i.path.join("."), i.message]));
    assert.equal(bannerPaths.overlay, "En fazla 90 olabilir.");
    assert.equal(bannerPaths.align, "Listeden geçerli bir seçenek seçin.");
  });

  test("page payload: section errors land at sections.N.content.<field>", () => {
    const parsed = pageSaveSchema.safeParse({
      id: 1,
      title: { tr: "Ana Sayfa" },
      slug: "home",
      isPublished: true,
      seo: { title: null, description: null, ogImageId: null, noIndex: false },
      sections: [section("rich_text", { html: { tr: "<p>ok</p>" } }), section("hero", { headline: { tr: "" } })],
      updatedAt: new Date().toISOString(),
    });
    assert.equal(parsed.success, false);
    const paths = !parsed.success ? parsed.error.issues.map((i) => i.path.join(".")) : [];
    assert.deepEqual(paths, ["sections.1.content.headline.tr"]);
  });

  test("schedule end must be after its start", () => {
    const parsed = sectionInput.safeParse(
      section("rich_text", { html: { tr: "<p>x</p>" } }, { schedule: { startsAt: "2026-12-01T10:00:00.000Z", endsAt: "2026-11-01T10:00:00.000Z" } }),
    );
    assert.equal(parsed.success, false);
    assert.deepEqual(!parsed.success && parsed.error.issues[0].path, ["schedule", "endsAt"]);
  });
});

describe("cleanup on save", () => {
  test("rich text is sanitized and empty locales are dropped", () => {
    const result = normalizeSectionContent("rich_text", {
      html: { tr: `<p onclick="x()">Merhaba<script>alert(1)</script> <a href="javascript:alert(1)">bağlantı</a></p>`, en: "   " },
    });
    assert.ok(result.ok);
    const html = (result.content.html as { tr: string; en?: string }).tr;
    assert.ok(!/script|onclick|javascript/i.test(html), html);
    assert.equal((result.content.html as { en?: string }).en, undefined);
  });

  test("optional texts left empty are removed; empty list lines are dropped", () => {
    const result = normalizeSectionContent("b2b_cta", {
      eyebrow: { tr: "", en: "" },
      title: { tr: "  İşletmeniz için  " },
      bullets: [{ tr: "Birinci" }, { tr: "  " }, { tr: "İkinci" }],
      cta: { label: { tr: "Teklif al" }, href: " /iletisim?konu=teklif " },
    });
    assert.ok(result.ok, JSON.stringify(!result.ok && result.issues));
    assert.equal("eyebrow" in result.content, false);
    assert.deepEqual(result.content.title, { tr: "İşletmeniz için" });
    assert.deepEqual(result.content.bullets, [{ tr: "Birinci" }, { tr: "İkinci" }]);
    assert.deepEqual(result.content.cta, { label: { tr: "Teklif al" }, href: "/iletisim?konu=teklif" });
  });

  test("media and product references are collected with their paths", () => {
    const refs = sectionRefs("scent_showcase", { items: [{ productId: 4, imageId: 9 }, { productId: "5", imageId: null }] });
    assert.deepEqual(refs.products, [
      { id: 4, path: "items.0.productId" },
      { id: 5, path: "items.1.productId" },
    ]);
    assert.deepEqual(refs.media, [{ id: 9, path: "items.0.imageId" }]);
    assert.deepEqual(sectionRefs("featured_products", { productIds: [3, 7] }).products.map((r) => r.path), ["productIds.0", "productIds.1"]);
  });
});

describe("section summary", () => {
  test("type label, first heading and facts", () => {
    const hero = sectionSummary("hero", { eyebrow: { tr: "Üst" }, headline: { tr: "Her dokunuşta prestij." } });
    assert.deepEqual(hero, { label: "Kapak (hero)", heading: "Her dokunuşta prestij.", facts: [], known: true });

    const showcase = sectionSummary("scent_showcase", { title: { tr: "Dört koku" }, items: [{}, {}, {}, {}] });
    assert.equal(showcase.heading, "Dört koku");
    assert.deepEqual(showcase.facts, ["4 koku"]);

    assert.equal(sectionSummary("legal_document", { key: "cookies" }).heading, "Çerez Politikası");
    assert.equal(sectionSummary("rich_text", { html: { tr: "<p>İlk <strong>paragraf</strong></p>" } }).heading, "İlk paragraf");
    assert.deepEqual(sectionSummary("featured_products", { productIds: [] }).facts, ["Tüm ürünler"]);
    assert.equal(sectionSummary("newsletter", {}).heading, null);
  });

  test("unknown types are flagged", () => {
    const summary = sectionSummary("marquee", {});
    assert.equal(summary.known, false);
    assert.match(summary.label, /Bilinmeyen/);
  });

  test("long headings are shortened", () => {
    const heading = sectionSummary("story", { title: { tr: "a".repeat(200) } }).heading ?? "";
    assert.ok(heading.length <= 90 && heading.endsWith("…"));
  });
});

test("section types used by the tests exist", () => {
  const used: SectionType[] = ["hero", "scent_showcase", "featured_products", "lifestyle_gallery", "b2b_cta", "rich_text", "faq", "legal_document", "image_banner", "story"];
  for (const type of used) assert.ok(sectionTypes.includes(type), type);
});
