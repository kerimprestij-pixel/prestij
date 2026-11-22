// Day 5 FIX: the copy corrections after review (scripts/seed-data/content-fixes.ts and the records in
// blog.ts, catalog-copy.ts, site-pages.ts, products.ts). Every record must undo cleanly to a different
// earlier version (the text content-day5.ts or days 1–4 wrote to the live database), and the corrected seed
// texts must say what the review (round 1) and the verification after it (round 2) asked for.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { plainTextOf, wordCount } from "@/lib/panel/blog/reading";
import { BLOG_BODY_FIXES, BLOG_POSTS, earlierBodies, firstWrittenBody } from "../../scripts/seed-data/blog";
import { CATEGORY_COPY, CATEGORY_COPY_FIXES, PRODUCT_SEO, PRODUCT_SEO_FIXES } from "../../scripts/seed-data/catalog-copy";
import { earlierVersions, fixRounds, undoFixes, undoLocalizedFixes, type LocaleFixes } from "../../scripts/seed-data/content-fixes";
import { homePageMeta } from "../../scripts/seed-data/home-page";
import { HAND_SOAP_WARNINGS_FIXES, SCENTS } from "../../scripts/seed-data/products";
import { LEGAL_PAGE_DESCRIPTIONS, LEGAL_PAGES, legalPageSeo, SEO_SETTINGS_TEXT } from "../../scripts/seed-data/site";
import { ABOUT_STORY_BODY_FIXES, SECTION_COPY_FIXES, SITE_PAGES } from "../../scripts/seed-data/site-pages";

const LOCALES = ["tr", "en", "ar"] as const;
const post = (slug: string) => {
  const found = BLOG_POSTS.find((p) => p.slug === slug);
  assert.ok(found, slug);
  return found;
};
const aboutStory = () => (SITE_PAGES.find((p) => p.slug === "hakkimizda")!.sections.find((s) => s.type === "story")!.content as { body: Record<string, string> }).body;

describe("undoFixes", () => {
  test("undoes corrections in reverse order; each `after` must be found exactly once", () => {
    assert.equal(undoFixes("a B c", [{ before: "b", after: "B" }]), "a b c");
    assert.equal(undoFixes("x2", [{ before: "x0", after: "x1" }, { before: "x1", after: "x2" }]), "x0");
    assert.equal(undoFixes("same", []), "same");
    assert.throws(() => undoFixes("a c", [{ before: "b", after: "B" }]), /not found exactly once/);
    assert.throws(() => undoFixes("B B", [{ before: "b", after: "B" }]), /not found exactly once/);
    assert.throws(() => undoFixes("abc", [{ before: "x", after: "" }]), /empty/);
  });

  test("undoLocalizedFixes touches only the languages with fixes; a fix for a missing language throws", () => {
    assert.deepEqual(undoLocalizedFixes({ tr: "A", en: "E" }, { tr: [{ before: "a", after: "A" }] }), { tr: "a", en: "E" });
    assert.deepEqual(undoLocalizedFixes({ tr: "A" }, undefined), { tr: "A" });
    assert.throws(() => undoLocalizedFixes({ tr: "A" }, { ar: [{ before: "x", after: "y" }] }), /no ar version/);
  });

  test("rounds: `fromRound` undoes only that round and the later ones; records must be listed in round order", () => {
    const fixes = [{ before: "a", after: "b" }, { round: 2, before: "b", after: "c" }];
    assert.equal(undoFixes("c", fixes), "a", "everything undone: the first version");
    assert.equal(undoFixes("c", fixes, 2), "b", "the version before round 2");
    assert.equal(undoFixes("c", fixes, 3), "c");
    assert.deepEqual(undoLocalizedFixes({ tr: "c", en: "E" }, { tr: fixes }, 2), { tr: "b", en: "E" });
    assert.throws(() => undoFixes("x", [{ round: 2, before: "w", after: "x" }, { before: "v", after: "w" }]), /listed after/);
    assert.deepEqual(fixRounds({ tr: fixes, en: [{ round: 3, before: "p", after: "q" }] }), [3, 2, 1]);
    assert.deepEqual(fixRounds(undefined), []);
  });

  test("earlierVersions: the value before each round (newest first), every path of a round at once", () => {
    const value = { title: { tr: "T2" }, items: [{ answer: { tr: "A1", en: "E" } }] };
    const versions = earlierVersions(value, [
      { path: ["title"], fixes: { tr: [{ before: "T0", after: "T1" }, { round: 2, before: "T1", after: "T2" }] } },
      { path: ["items", 0, "answer"], fixes: { tr: [{ before: "A0", after: "A1" }] } },
    ]);
    assert.deepEqual(versions, [
      { title: { tr: "T1" }, items: [{ answer: { tr: "A1", en: "E" } }] },
      { title: { tr: "T0" }, items: [{ answer: { tr: "A0", en: "E" } }] },
    ]);
    assert.deepEqual(value.title, { tr: "T2" }, "the input is not modified");
    assert.deepEqual(earlierVersions({ tr: "x" }, [{ path: [], fixes: undefined }]), [], "never corrected: no earlier version");
    assert.throws(() => earlierVersions({ a: 1 }, [{ path: ["b"], fixes: { tr: [{ before: "x", after: "y" }] } }]), /not a localized text/);
  });
});

/** Undoes only round 2: the text the live database held before the day-5 verification. */
const beforeRound2 = <T extends Partial<Record<"tr" | "en" | "ar", string>>>(text: T, fixes: LocaleFixes | undefined): T => undoLocalizedFixes(text, fixes, 2);
const sectionOf = (page: string, type: string) => SITE_PAGES.find((p) => p.slug === page)!.sections.find((s) => s.type === type)!.content;
const textAt = (content: unknown, path: readonly (string | number)[]) =>
  path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], content) as Record<"tr" | "en" | "ar", string>;

describe("every correction record applies to the current seed text", () => {
  test("blog bodies", () => {
    for (const [slug, fixes] of Object.entries(BLOG_BODY_FIXES)) {
      const p = post(slug);
      const first = firstWrittenBody(p);
      for (const l of LOCALES) if (fixes[l]) assert.notEqual(first[l], p.body[l], `${slug} ${l}`);
    }
    for (const p of BLOG_POSTS.filter((x) => !BLOG_BODY_FIXES[x.slug])) assert.deepEqual(firstWrittenBody(p), p.body);
  });

  test("category bodies and SEO descriptions, product SEO texts, the hakkımızda story", () => {
    for (const [slug, fixes] of Object.entries(CATEGORY_COPY_FIXES)) {
      const copy = CATEGORY_COPY[slug as keyof typeof CATEGORY_COPY];
      if (fixes?.body) assert.notDeepEqual(undoLocalizedFixes(copy.body, fixes.body), copy.body, slug);
      if (fixes?.seoDescription) assert.notDeepEqual(undoLocalizedFixes(copy.seo.description, fixes.seoDescription), copy.seo.description, slug);
    }
    for (const [slug, fixes] of Object.entries(PRODUCT_SEO_FIXES)) {
      const seo = PRODUCT_SEO[slug as keyof typeof PRODUCT_SEO];
      if (fixes?.title) assert.notDeepEqual(undoLocalizedFixes(seo.title, fixes.title), seo.title, slug);
      if (fixes?.description) assert.notDeepEqual(undoLocalizedFixes(seo.description, fixes.description), seo.description, slug);
    }
    assert.notDeepEqual(undoLocalizedFixes(aboutStory(), ABOUT_STORY_BODY_FIXES), aboutStory());
  });

  test("round 2: category titles and FAQs, section texts, the hand-soap warnings, the blog post", () => {
    for (const [slug, fixes] of Object.entries(CATEGORY_COPY_FIXES)) {
      const copy = CATEGORY_COPY[slug as keyof typeof CATEGORY_COPY];
      if (fixes?.seoTitle) assert.notDeepEqual(beforeRound2(copy.seo.title, fixes.seoTitle), copy.seo.title, slug);
      if (fixes?.faq) {
        const versions = earlierVersions(copy.faq, fixes.faq);
        assert.equal(versions.length, 1, `${slug}: FAQ corrected in one round`);
        assert.notDeepEqual(versions[0], copy.faq, slug);
        assert.equal(versions[0].length, copy.faq.length, `${slug}: same number of FAQ items`);
      }
    }
    for (const fix of SECTION_COPY_FIXES) {
      const where = `${fix.page} ${fix.type} ${fix.path.join(".")}`;
      const next = textAt(sectionOf(fix.page, fix.type), fix.path);
      assert.ok(next && typeof next.tr === "string", `${where}: the seed has the text`);
      const earlier = earlierVersions(next, [{ path: [], fixes: fix.fixes }]);
      assert.ok(earlier.length >= 1, where);
      for (const version of earlier) assert.notDeepEqual(version, next, where);
    }
    assert.ok(SECTION_COPY_FIXES.some((f) => f.page === "hakkimizda" && f.path[0] === "body" && f.fixes === ABOUT_STORY_BODY_FIXES), "the story body record is applied by the section step");
    for (const scent of SCENTS.filter((s) => s.category === "el-sabunu")) {
      assert.deepEqual(beforeRound2(scent.warnings, HAND_SOAP_WARNINGS_FIXES), {
        tr: "Isı ve direkt güneş ışığından uzakta ve çocukların ulaşamayacağı yerde muhafaza edilir.",
        en: "Store away from heat and direct sunlight, out of the reach of children.",
        ar: "يُحفظ بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
      }, `${scent.slug}: the record undoes to the printed label text`);
    }
    const canisters = post("5-litre-20-litre-sivi-sabun-rehberi");
    assert.deepEqual(earlierBodies(canisters), [firstWrittenBody(canisters)], "corrected in round 2 only");
    // Posts corrected in round 1 only: one earlier version, the first written one.
    for (const p of BLOG_POSTS.filter((x) => BLOG_BODY_FIXES[x.slug] && x !== canisters)) assert.deepEqual(earlierBodies(p), [firstWrittenBody(p)], p.slug);
  });
});

describe("the corrected copy", () => {
  test("CONTENT-1: no colour of the liquid soap per scent (no source supports it)", () => {
    const scents = post("koku-secimi-lavanta-portakal-okyanus");
    assert.ok(!scents.body.tr.includes("Rengi de hesaba katın"));
    assert.ok(!/Lavanta'da mor|fildişi, Portakal'da amber/.test(scents.body.tr));
    assert.ok(!/colour of the liquid soap|purple for Lavender/.test(scents.body.en));
    assert.ok(!scents.body.ar.includes("لون الصابون السائل"));
    // …and it is still a full article (contract §5.6: 700–1200 Turkish words).
    assert.ok(wordCount(scents.body.tr) >= 700, `${wordCount(scents.body.tr)} words`);
    assert.ok(firstWrittenBody(scents).tr.includes("Rengi de hesaba katın"), "the record holds the removed section");
  });

  test("CONTENT-2: 'lif' declined correctly; 'iş yeri' as TDK writes it", () => {
    const all = BLOG_POSTS.map((p) => plainTextOf(p.body.tr)).join("\n");
    assert.ok(!/\blifeye\b|life köpüğü|life kullanmak|işyerinde/.test(all));
    const gel = plainTextOf(post("dus-jeli-mi-kati-sabun-mu").body.tr);
    for (const phrase of ["süngere ya da life alınarak", "sünger ya da lif köpüğü", "süngere ya da life alın.", "Sünger ya da lif kullanmak"]) assert.ok(gel.includes(phrase), phrase);
    assert.ok(post("dogru-el-yikama-adimlari").body.tr.includes("Evde ve iş yerinde"));
  });

  test("CONTENT-3: no 'other gift sets' and no 'all options' in a category that lacks the shower gel", () => {
    const scents = post("koku-secimi-lavanta-portakal-okyanus");
    assert.ok(!scents.body.tr.includes("Diğer seçenekleri"));
    assert.ok(!scents.body.en.includes("other options among our"));
    assert.ok(!scents.body.ar.includes("خيارات أخرى"));
    const refill = post("sivi-sabun-dispenseri-nasil-doldurulur");
    for (const l of LOCALES) assert.ok(refill.body[l].includes('href="/kategori/dus-jeli"'), `refilling ${l} links the shower gel category`);
  });

  test("CONTENT-4: category bodies that mention samples say they are free and not for sale", () => {
    const note = { tr: "numuneler ücretsizdir ve satılmaz", en: "samples are free and not for sale", ar: "مجانية وليست للبيع" };
    for (const [slug, copy] of Object.entries(CATEGORY_COPY)) {
      for (const l of LOCALES) {
        if (copy.body[l]?.includes('href="/numune"')) assert.ok(copy.body[l]!.includes(note[l]), `${slug} body.${l}`);
      }
    }
  });

  test("CONTENT-5/6/7: dus-jeli description leads with the generic term; Arabic product SEO within the limits", () => {
    const desc = CATEGORY_COPY["dus-jeli"].seo.description;
    assert.ok(desc.tr!.startsWith("Duş jeli"), desc.tr);
    assert.ok(desc.en!.startsWith("Shower gel"), desc.en);
    for (const l of LOCALES) {
      const n = [...desc[l]!].length;
      assert.ok(n >= 120 && n <= 155, `dus-jeli description ${l}: ${n}`);
    }
    const okyanus = [...PRODUCT_SEO.okyanus.description.ar!].length;
    assert.ok(okyanus >= 120 && okyanus <= 155, `okyanus ar description: ${okyanus}`);
    const latte = PRODUCT_SEO["lavanta-latte"].title.ar!;
    assert.ok([...latte].length <= 60, `${[...latte].length}`);
    assert.ok(latte.includes("بمضخة"), "a pump bottle, not 'pump' alone");
  });

  test("CONTENT-7: the four label claims are a list of nouns in every language", () => {
    const texts = [
      ...Object.values(CATEGORY_COPY).flatMap((c) => [c.body.en ?? "", c.body.ar ?? ""]),
      ...BLOG_POSTS.flatMap((p) => [p.body.tr, p.body.en, p.body.ar]),
      aboutStory().en,
      aboutStory().ar,
    ].join("\n");
    assert.ok(!/effective cleansing, skin-caring|ويحمي البشرة، ورائحة|cildi koruyan, ferah/.test(texts));
  });

  test("CONTENT-8: the hakkımızda story does not repeat the intro's opening", () => {
    const story = aboutStory();
    assert.ok(!story.tr.startsWith("PRESTİJ, PRESTİJ Buklet"), story.tr.slice(0, 40));
    assert.ok(!story.en.startsWith("PRESTİJ is the brand of"), story.en.slice(0, 40));
    assert.ok(!story.ar.startsWith("PRESTİJ علامة"), story.ar.slice(0, 40));
    assert.ok(story.tr.includes("PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti."), "the legal name stays");
    assert.ok(!story.en.includes("to turn the hand washing and showers repeated"));
  });
});

describe("the verified copy (round 2, day-5 verification)", () => {
  const LOCAL = { tr: "tr-TR", en: "en-US", ar: "ar" } as const;
  const lower = (s: string, l: (typeof LOCALES)[number]) => s.toLocaleLowerCase(LOCAL[l]);
  const len = (s: string | undefined) => [...(s ?? "")].length;
  const EYE = {
    tr: "Göz ile temasından kaçının; temas hâlinde bol suyla durulayın.",
    en: "Avoid contact with the eyes; in case of contact, rinse with plenty of water.",
    ar: "تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء.",
  };
  /** A Latin word ending in a dot right before Arabic text: the dot jumps to the wrong side in RTL. */
  const LATIN_DOT_BEFORE_ARABIC = /[A-Za-zÇĞİÖŞÜçğıöşü]\.\s+[؀-ۿ]/;
  const SUPERLATIVE = /\ben (iyi|ucuz|kaliteli|avantajlı|ekonomik|güvenilir)\b|\bbest\b|cheapest|number one|الأفضل|أفضل|الأرخص/i;
  type Texts = Record<string, Record<"tr" | "en" | "ar", string>>;
  const kurumsal = sectionOf("kurumsal", "hero") as Texts;
  const kurumsalFaq = sectionOf("kurumsal", "faq") as Texts;
  const numune = sectionOf("numune", "hero") as Texts;

  test("SEO-1: /kurumsal names toptan sıvı sabun in the <h1> line, the first paragraph and a subheading", () => {
    const keyword = { tr: "toptan sıvı sabun", en: "bulk liquid soap", ar: "بالجملة" };
    for (const l of LOCALES) {
      for (const [where, text] of [["hero eyebrow", kurumsal.eyebrow[l]], ["hero subline", kurumsal.subline[l]], ["faq title", kurumsalFaq.title[l]]] as const) {
        assert.ok(lower(text, l).includes(keyword[l]), `${where} ${l}: ${text}`);
      }
      assert.ok(lower(kurumsal.eyebrow[l], l).includes(l === "tr" ? "duş jeli" : l === "en" ? "shower gel" : "جل استحمام"), `eyebrow ${l} names the shower gel`);
      assert.doesNotMatch(kurumsal.subline[l], /\d+\s?(ml|مل)(?![\p{L}])/u, "no pump bottle volume in new copy");
    }
    assert.ok(kurumsal.subline.ar.includes("صابون سائل") && kurumsal.eyebrow.ar.startsWith("صابون سائل"));
    assert.equal(kurumsal.headline.tr, "Her misafire özenli bir dokunuş.", "the hero headline (second <h1> line) is unchanged");
  });

  test("SEO-1: /numune names sıvı sabun numunesi in the hero's first paragraph, without superlatives", () => {
    assert.ok(numune.subline.tr.includes("ücretsiz sıvı sabun numunesi"), numune.subline.tr);
    assert.ok(numune.subline.en.includes("free liquid soap samples"), numune.subline.en);
    assert.ok(numune.subline.ar.includes("عيّنات صابون سائل مجانية"), numune.subline.ar);
    for (const l of LOCALES) assert.doesNotMatch(numune.subline[l], SUPERLATIVE, `${l}: ${numune.subline[l]}`);
  });

  test("SEO-2: each legal page has its own factual description in tr/en/ar", () => {
    assert.deepEqual(Object.keys(LEGAL_PAGE_DESCRIPTIONS).sort(), LEGAL_PAGES.map((p) => p.slug).sort());
    const others = [
      ...Object.values(CATEGORY_COPY).map((c) => c.seo.description),
      ...Object.values(PRODUCT_SEO).map((s) => s.description),
      ...SITE_PAGES.map((p) => p.seo.description!),
      ...BLOG_POSTS.map((p) => p.seo.description),
      homePageMeta.seo.description,
      SEO_SETTINGS_TEXT.description,
    ];
    for (const l of LOCALES) {
      const mine = Object.values(LEGAL_PAGE_DESCRIPTIONS).map((d) => d[l] ?? "");
      assert.equal(new Set(mine).size, mine.length, `unique among the legal pages (${l})`);
      for (const text of mine) {
        const n = len(text);
        assert.ok(l === "ar" ? n >= 100 && n <= 155 : n >= 120 && n <= 155, `${l} ${n}: ${text}`);
        assert.ok(!others.some((o) => o[l] === text), `${l}: not the same as another page's description`);
        assert.ok(text.includes("PRESTİJ"), text);
        assert.doesNotMatch(text, /\d/, "no figures (periods, amounts) a reader could take as a promise");
        assert.doesNotMatch(text, SUPERLATIVE);
        if (l === "ar") {
          assert.doesNotMatch(text, /[,;?]/, "Arabic punctuation");
          assert.doesNotMatch(text, LATIN_DOT_BEFORE_ARABIC);
        }
      }
    }
    const title = { tr: "KVKK Aydınlatma Metni", en: "Privacy Notice (KVKK)", ar: "إشعار حماية البيانات الشخصية (KVKK)" };
    assert.deepEqual(legalPageSeo("kvkk", title), { title, description: LEGAL_PAGE_DESCRIPTIONS.kvkk });
  });

  test("SEO-3: the gift-set copy no longer addresses the search phrase; sabun hediye seti stays in title and description", () => {
    const set = CATEGORY_COPY["hediye-setleri"];
    assert.doesNotMatch(set.body.tr, /arayanlar için/);
    assert.doesNotMatch(set.body.en!, /If you are looking for a soap gift set/);
    assert.doesNotMatch(set.body.ar!, /لمن يبحث عن طقم/);
    for (const item of set.faq) {
      assert.doesNotMatch(item.answer.tr, /hediye arayanlar/);
      assert.doesNotMatch(item.answer.en!, /anyone looking for/);
      assert.doesNotMatch(item.answer.ar!, /كل من يبحث/);
    }
    assert.match(set.body.tr, /sıvı sabun seti/);
    assert.match(set.body.en!, /liquid soap set/);
    assert.match(set.body.ar!, /طقم الصابون السائل/);
    assert.match(set.seo.title.tr, /^Sabun Hediye Seti/);
    assert.match(set.seo.description.tr, /^Sabun hediye seti/);
    assert.match(set.seo.title.tr, /Sıvı Sabun Seti/);
  });

  test("SEO-7: dus-jeli shows the usage text once, in the body, with the eye caution; the FAQ asks something else", () => {
    const gel = CATEGORY_COPY["dus-jeli"];
    const usage = { tr: "Islak cildinize ya da lifinize", en: "to wet skin or a washcloth", ar: "على البشرة المبللة أو على الليفة" };
    for (const l of LOCALES) {
      const body = gel.body[l]!;
      assert.equal(body.split(usage[l]).length - 1, 1, `body ${l}: the usage text once`);
      for (const item of gel.faq) assert.ok(!item.answer[l]!.includes(usage[l]), `faq ${l}: no second copy of the usage text`);
      assert.ok(body.includes(EYE[l]), `body ${l}: eye caution where the usage is`);
    }
    assert.ok(gel.body.tr.includes("Tahriş oluşursa kullanımı bırakın."), "the FAQ's irritation sentence is merged into the body");
    assert.equal(gel.faq.filter((i) => i.question.tr === "Duş jeli nasıl kullanılır?").length, 0);
    assert.match(gel.faq[0].answer.tr, /vücut temizliği içindir/, "the new question is answered from the label");
  });

  test("COPY-1: blog post 5 claims nothing about a production date or serial number on the packaging", () => {
    const canisters = post("5-litre-20-litre-sivi-sabun-rehberi");
    assert.doesNotMatch(canisters.body.tr, /Üretim tarihi|seri numara/i);
    assert.doesNotMatch(canisters.body.en, /production date|serial number/i);
    assert.doesNotMatch(canisters.body.ar, /تاريخ الإنتاج|الرقم التسلسلي/);
    assert.ok(wordCount(canisters.body.tr) >= 700, `${wordCount(canisters.body.tr)} words`);
    assert.ok(firstWrittenBody(canisters).tr.includes("Üretim tarihi ve seri numarası"), "the record holds the removed sentence");
  });

  test("COPY-2: the gift-set canister usage section carries the eye-contact caution", () => {
    const body = CATEGORY_COPY["hediye-setleri"].body;
    const heading = { tr: "<h2>Bidonlar nasıl kullanılır?</h2>", en: "<h2>How to use the canisters</h2>", ar: "<h2>كيف تُستخدم العبوات؟</h2>" };
    for (const l of LOCALES) {
      const html = body[l]!;
      const start = html.indexOf(heading[l]);
      assert.ok(start >= 0, `${l}: section found`);
      const section = html.slice(start, html.indexOf("<h2>", start + 4));
      assert.ok(section.includes(EYE[l]), `${l}: ${section}`);
    }
  });

  test("COPY-3: the hand soaps' warnings panel starts with the eye-contact caution; the shower gel's is unchanged", () => {
    for (const scent of SCENTS) {
      if (scent.category === "el-sabunu") for (const l of LOCALES) assert.ok(scent.warnings[l]!.startsWith(EYE[l]), `${scent.slug} ${l}`);
      else assert.match(scent.warnings.tr, /^Harici kullanım içindir\. Gözle temasından kaçının/, scent.slug);
    }
  });

  test("COPY-4: the /urunler FAQ says the free samples are not for sale", () => {
    const answer = textAt(sectionOf("urunler", "faq"), ["items", 0, "answer"]);
    assert.match(answer.tr, /ücretsiz numune.*satılmaz/);
    assert.match(answer.en, /free sample.*not for sale/);
    assert.match(answer.ar, /عيّنة مجانية.*ليست للبيع/);
  });

  test("COPY-5: the hakkımızda story has a proper subject, says the products are made in Kayseri, and reads right in Arabic", () => {
    const story = aboutStory();
    const content = sectionOf("hakkimizda", "story") as Texts;
    assert.ok(!story.tr.includes("olarak merkezimiz") && !story.tr.includes("burada üretiyoruz"), story.tr.slice(0, 120));
    assert.ok(story.tr.includes("Kayseri'de üretilir"));
    assert.ok(!story.en.includes("here, and our products") && story.en.includes("made in Kayseri, Türkiye"), story.en.slice(0, 160));
    assert.ok(!story.ar.includes("Şti.") && !story.ar.includes("وفيها نصنع"), story.ar.slice(0, 120));
    assert.doesNotMatch(story.ar, LATIN_DOT_BEFORE_ARABIC);
    assert.ok(story.ar.includes("في قيصري"));
    const about = SITE_PAGES.find((p) => p.slug === "hakkimizda")!;
    for (const l of LOCALES) assert.notEqual(content.eyebrow[l], about.title[l], `${l}: the eyebrow does not repeat the <h1>`);
    assert.equal(content.eyebrow.ar, "تعرّف إلينا");
  });

  test("COPY-6: el-sabunu does not call the soap a habit; dus-jeli reads naturally; dus-jeli TR title", () => {
    const soap = CATEGORY_COPY["el-sabunu"].body;
    assert.doesNotMatch(plainTextOf(soap.tr).slice(0, 120), /alışkanlık/);
    assert.doesNotMatch(plainTextOf(soap.en!).slice(0, 120), /habit/);
    assert.doesNotMatch(plainTextOf(soap.ar!).slice(0, 120), /عادة/);
    const gel = CATEGORY_COPY["dus-jeli"];
    assert.doesNotMatch(gel.body.en!, /leave the day behind with the water|come first/);
    assert.doesNotMatch(gel.body.ar!, /تتقدّم العبوات|تترك فيها تعب اليوم مع الماء/);
    assert.equal(gel.seo.title.tr, "Duş Jeli — Evler ve Oteller İçin, 5 L ve 20 L Bidon");
    assert.ok(len(gel.seo.title.tr) <= 60);
  });

  test("every round-2 text keeps the copy rules (no superlatives, prices or pump volume; Arabic punctuation)", () => {
    const texts: Record<"tr" | "en" | "ar", string>[] = [
      ...SECTION_COPY_FIXES.map((f) => textAt(sectionOf(f.page, f.type), f.path)),
      ...SCENTS.map((s) => s.warnings as Record<"tr" | "en" | "ar", string>),
      ...(Object.values(LEGAL_PAGE_DESCRIPTIONS) as Record<"tr" | "en" | "ar", string>[]),
      CATEGORY_COPY["dus-jeli"].faq[0].question as Record<"tr" | "en" | "ar", string>,
      CATEGORY_COPY["dus-jeli"].faq[0].answer as Record<"tr" | "en" | "ar", string>,
    ];
    for (const text of texts) {
      for (const l of LOCALES) {
        const value = plainTextOf(text[l]);
        assert.ok(value.trim(), `complete in ${l}`);
        assert.doesNotMatch(value, SUPERLATIVE, value);
        assert.doesNotMatch(value, /₺|\bTL\b|\d+\s?(ml|مل)(?![\p{L}])/iu, value);
        if (l === "ar") assert.doesNotMatch(value, /[,;?]/, value);
        else assert.doesNotMatch(value, /[،؛؟]/, value);
      }
    }
  });
});
