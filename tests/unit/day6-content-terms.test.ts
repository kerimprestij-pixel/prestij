// Day 6 CONTENT: "Hediye Çarkı Kampanya Koşulları" (scripts/seed-data/legal.ts WHEEL_TERMS_LEGAL_DOCUMENT,
// page /sayfa/hediye-carki-kampanya-kosullari in scripts/seed-data/site.ts). The draft is stored and
// rendered like the other legal texts (draft-notice aside, sanitizer-safe HTML, locale-less links), is
// marked for the lawyer in every language, covers every topic of contract §5.7 in tr/en/ar, agrees with the
// code it describes (cookie name, purge days) and names no figure the owner can change in the panel.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { localizeBodyLinks } from "@/components/sections/localize-links";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/panel/format";
import { findMissingFields, htmlText, LEGAL_KEY_PATTERN, legalPublishInput, splitDraftNotice, splitLocalizedBody } from "@/lib/panel/legal/schemas";
import { WHEEL_TERMS_LEGAL_KEY } from "@/lib/panel/seo/launch";
import { WHEEL_COOKIE, WHEEL_PURGE_AFTER_DAYS } from "@/lib/wheel/types";
import { LEGAL_DOCUMENTS, LEGAL_VERSION, WHEEL_TERMS_KEY, WHEEL_TERMS_LEGAL_DOCUMENT } from "../../scripts/seed-data/legal";
import { LEGAL_PAGE_DESCRIPTIONS, LEGAL_PAGES, legalPageSeo } from "../../scripts/seed-data/site";

const LOCALES = ["tr", "en", "ar"] as const;
type L = (typeof LOCALES)[number];
const doc = WHEEL_TERMS_LEGAL_DOCUMENT;
const body = (l: L) => doc.body[l] ?? "";
/** The body without the draft notice, as the storefront renders it (LegalDocument.tsx). */
const rest = (l: L) => splitDraftNotice(body(l)).body;
const notice = (l: L) => splitDraftNotice(body(l)).notice;
const text = (l: L) => htmlText(rest(l));
const SLUG = "hediye-carki-kampanya-kosullari";
const COMPANY = "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.";
const ADDRESS = "Cırgalan Mah. Engir Gölü Küme Evler No:5/E, Kocasinan / Kayseri";

describe("wheel terms: stored like the other legal texts", () => {
  test("legal key, page slug, SEO and seed registration", () => {
    assert.equal(doc.key, WHEEL_TERMS_KEY);
    assert.equal(WHEEL_TERMS_KEY, "wheel_terms");
    assert.equal(WHEEL_TERMS_LEGAL_KEY, WHEEL_TERMS_KEY, "the launch checklist links to the same key");
    assert.match(doc.key, LEGAL_KEY_PATTERN, "the panel's /panel/yasal/[key] accepts the key");
    assert.equal(LEGAL_DOCUMENTS.filter((d) => d.key === doc.key).length, 1, "seeded once with the other documents");
    const page = LEGAL_PAGES.find((p) => p.key === doc.key);
    assert.ok(page);
    assert.equal(page.slug, SLUG);
    assert.match(page.slug, SLUG_PATTERN);
    assert.ok(page.slug.length <= SLUG_MAX_LENGTH);
    assert.deepEqual(legalPageSeo(SLUG, doc.title), { title: doc.title, description: LEGAL_PAGE_DESCRIPTIONS[SLUG] });
    assert.deepEqual(doc.title, { tr: "Hediye Çarkı Kampanya Koşulları", en: "Gift Wheel Campaign Terms", ar: "شروط حملة عجلة الهدايا" });
  });

  test("every language opens with the draft notice, marked for the lawyer, then the title", () => {
    const marks: Record<L, RegExp> = {
      tr: /TASLAK METİN \(taslak-1\) — avukat onayı bekliyor\./,
      en: /DRAFT \(taslak-1\) — awaiting legal review\..*The legally binding version is the Turkish text\./,
      ar: /مسودة \(taslak-1\) — بانتظار مراجعة المحامي\..*النسخة الملزمة قانونيًا هي النص التركي\./,
    };
    assert.equal(LEGAL_VERSION, "taslak-1");
    for (const l of LOCALES) {
      assert.ok(body(l).startsWith('<aside class="legal-draft" role="note">'), `${l}: the notice comes first`);
      assert.match(htmlText(notice(l)), marks[l], l);
      assert.ok(rest(l).startsWith(`<h2>${doc.title[l]}</h2>`), `${l}: the document title follows the notice`);
      assert.doesNotMatch(rest(l), /legal-draft/, `${l}: one notice only`);
    }
    const parts = splitLocalizedBody(doc.body);
    assert.ok(parts.hasNotice);
  });

  test("the HTML is exactly what the storefront sanitizer keeps (no tag or attribute is dropped)", () => {
    for (const l of LOCALES) {
      assert.equal(sanitizeHtml(rest(l)), rest(l), `${l} body`);
      assert.equal(sanitizeHtml(notice(l)), notice(l), `${l} notice`);
    }
  });

  test("the panel can publish the lawyer-approved text: the legal editor's schema accepts it unchanged", () => {
    const parts = splitLocalizedBody(doc.body);
    const parsed = legalPublishInput.safeParse({
      key: doc.key,
      baseId: 7,
      baseUpdatedAt: "2026-11-12T10:00:00.000Z",
      version: "2026-12 v1",
      title: doc.title,
      showNotice: false,
      notice: parts.notice,
      body: parts.body,
    });
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.deepEqual(parsed.data.body, { tr: rest("tr"), en: rest("en"), ar: rest("ar") });
  });

  test("the same fourteen numbered sections in tr, en and ar", () => {
    const headings = (l: L) => [...rest(l).matchAll(/<h3>(\d+)\. [^<]+<\/h3>/g)].map((m) => Number(m[1]));
    for (const l of LOCALES) {
      assert.deepEqual(headings(l), Array.from({ length: 14 }, (_, i) => i + 1), l);
      assert.equal((rest(l).match(/<h2>/g) ?? []).length, 1, `${l}: one h2`);
      assert.equal((rest(l).match(/<li>/g) ?? []).length, (rest(l).match(/<\/li>/g) ?? []).length, `${l}: balanced list items`);
    }
  });
});

describe("wheel terms: content (contract §5.7)", () => {
  /** One pattern per topic and language; each must appear in the visible text. */
  const TOPICS: Record<string, Record<L, RegExp>> = {
    organiser: { tr: /Düzenleyen.*PRESTİJ BUKLET/, en: /Organiser.*PRESTİJ BUKLET/, ar: /الجهة المنظِّمة.*PRESTİJ BUKLET/ },
    period: { tr: /\[başlangıç tarihi\].*\[bitiş tarihi\]/, en: /\[start date\].*\[end date\]/, ar: /\[تاريخ البدء\].*\[تاريخ الانتهاء\]/ },
    "who can join": { tr: /18 yaşını doldurmuş/, en: /aged 18 or over/, ar: /بلغوا 18 عامًا/ },
    "staff and business excluded": { tr: /PRESTİJ çalışanları.*Kurumsal \(tacir\)/, en: /PRESTİJ employees.*Business \(trade\)/, ar: /لموظفي PRESTİJ.*الشركات \(التجّار\)/ },
    "free, every slice wins, random": { tr: /ücretsizdir.*boş dilim yoktur.*rastgele/, en: /free.*no empty slices.*at random/, ar: /مجاني.*أجزاء فارغة.*عشوائيًا/ },
    "one prize per person per round": { tr: /her Kampanya turunda yalnızca bir ödül/, en: /only one prize per campaign round/, ar: /جائزة واحدة في كل جولة/ },
    "claim by signing up or in": { tr: /ücretsiz üye olarak veya üye girişi yaparak/, en: /signing up for free or signing in/, ar: /بالتسجيل مجانًا أو بتسجيل الدخول/ },
    "prize types": { tr: /Yüzde indirim.*Tutar indirimi.*Ücretsiz kargo/, en: /Percentage discount.*Amount discount.*Free shipping/, ar: /خصم بنسبة مئوية.*خصم بمبلغ محدد.*شحن مجاني/ },
    "minimum basket": { tr: /asgari sepet tutarına bağlıdır/, en: /minimum basket/, ar: /حدًّا أدنى لقيمة السلة/ },
    "heavy parcel fee": { tr: /Ağır gönderiler/, en: /heavy parcels/, ar: /لشحنات الثقيلة/ },
    validity: { tr: /Geçerlilik Süresi.*Süresi dolan ödül kullanılamaz/, en: /Validity and use.*An expired prize cannot be used/, ar: /مدة الصلاحية.*بعد انتهاء صلاحيتها/ },
    "single use, one order": { tr: /tek kullanımlık.*tek bir siparişte/, en: /single-use.*one order/, ar: /يُستخدم مرة واحدة.*طلب واحد/ },
    "no cash value": { tr: /nakde çevrilemez/, en: /no cash value/, ar: /لا قيمة نقدية/ },
    "not transferable": { tr: /başka bir hesaba aktarılamaz/, en: /cannot be transferred to another account/, ar: /لا يمكن نقلها إلى حساب آخر/ },
    "combination with other offers": { tr: /yalnızca bir indirim kodu.*birleştirilemez.*birlikte uygulanabilir/, en: /Only one discount code.*cannot be combined.*used together with other discounts/, ar: /رمز خصم واحد.*فلا تُجمع.*مع الخصومات الأخرى/ },
    "auto-apply, never overwrites": { tr: /kendiliğinden uygulanır.*yerine geçmez/, en: /applied automatically.*never replaces/, ar: /تُطبَّق الجائزة تلقائيًا.*لا تحلّ الجائزة أبدًا محل/ },
    cancellation: { tr: /teslim edilmeden iptal edilirse.*yeniden kullanılabilir/, en: /cancelled before delivery.*can be used again/, ar: /أُلغي قبل التسليم.*مجددًا/ },
    returns: { tr: /cayma hakkı kapsamında iade/, en: /right of withdrawal/, ar: /حق الانسحاب/ },
    abuse: { tr: /Kötüye Kullanım.*Birden fazla hesap/, en: /Misuse.*several accounts/, ar: /إساءة الاستخدام.*عدة حسابات/ },
    "personal data": { tr: /Kişisel Veriler.*IP adresinin kendisi saklanmaz/, en: /Personal data.*the IP address itself is not stored/, ar: /البيانات الشخصية.*ولا يُحفظ عنوان IP نفسه/ },
    "reminder only with newsletter consent": { tr: /hatırlatma e-postası yalnızca e-bülten/, en: /reminder .* only to members who have agreed to receive the newsletter/, ar: /رسالة التذكير .* إلا إلى الأعضاء الذين وافقوا على تلقي النشرة البريدية/ },
    "deleting the account": { tr: /Hesap silindiğinde kullanılmamış ödüller geçersiz olur/, en: /If you delete your account, unused prizes become invalid/, ar: /إذا حذفت حسابك تصبح الجوائز غير المستخدمة باطلة/ },
    changes: { tr: /Kampanyada Değişiklik.*ileriye dönük/, en: /Changes to the Campaign.*for the future/, ar: /التغييرات على الحملة.*بأثر مستقبلي/ },
  };

  for (const [topic, patterns] of Object.entries(TOPICS)) {
    test(`covers: ${topic}`, () => {
      for (const l of LOCALES) assert.match(text(l), patterns[l], `${l}: ${topic}`);
    });
  }

  test("links to the KVKK notice, the membership agreement and the distance sales agreement, locale-less", () => {
    const legalSlugs = new Set<string>(LEGAL_PAGES.map((p) => p.slug));
    for (const l of LOCALES) {
      const hrefs = [...rest(l).matchAll(/<a href="([^"]+)">/g)].map((m) => m[1]);
      assert.deepEqual([...new Set(hrefs)].sort(), ["/sayfa/kvkk", "/sayfa/mesafeli-satis-sozlesmesi", "/sayfa/uyelik-sozlesmesi"], l);
      for (const href of hrefs) assert.ok(legalSlugs.has(href.replace("/sayfa/", "")), `${l}: ${href} is a seeded legal page`);
    }
    // On the storefront each link points to the reader's language.
    assert.match(localizeBodyLinks(rest("tr"), "tr"), /<a href="\/tr\/sayfa\/kvkk">KVKK Aydınlatma Metni<\/a>/);
    assert.match(localizeBodyLinks(rest("en"), "en"), /<a href="\/en\/page\/kvkk">Privacy Notice \(KVKK\)<\/a>/);
    assert.match(localizeBodyLinks(rest("ar"), "ar"), /<a href="\/ar\/page\/kvkk">إشعار حماية البيانات الشخصية \(KVKK\)<\/a>/);
  });

  test("agrees with the code it describes: the spin cookie and the purge of unclaimed spins", () => {
    assert.ok(text("tr").includes(`“${WHEEL_COOKIE}”`) && text("en").includes(`“${WHEEL_COOKIE}”`) && text("ar").includes(`«${WHEEL_COOKIE}»`));
    assert.ok(text("tr").includes(`en geç ${WHEEL_PURGE_AFTER_DAYS} gün içinde silinir`));
    assert.ok(text("en").includes(`deleted within ${WHEEL_PURGE_AFTER_DAYS} days`));
    assert.ok(text("ar").includes(`خلال ${WHEEL_PURGE_AFTER_DAYS} يومًا`));
  });

  test("names no figure the owner can change in the panel (slices, minimums, validity, hold time)", () => {
    for (const l of LOCALES) {
      const visible = text(l);
      assert.doesNotMatch(visible, /%|₺|\bTL\b|ليرة/, `${l}: no prize value or amount`);
      assert.doesNotMatch(visible, /\b(72|24|720)\b|\b7 (gün|days)\b/, `${l}: no validity or hold time`);
    }
  });

  test("the Turkish draft lists what is still missing and the questions for the lawyer as [markers]", () => {
    const missing = findMissingFields(rest("tr"));
    for (const expected of ["başlangıç tarihi", "bitiş tarihi", "e-posta adresi", "MERSİS numarası", "KEP adresi"]) assert.ok(missing.includes(expected), expected);
    const questions = missing.filter((m) => /hukukçu tarafından/.test(m));
    assert.equal(questions.length, 3, questions.join("\n"));
    assert.ok(questions.some((q) => /çekiliş veya piyango/.test(q)));
    assert.ok(questions.some((q) => /ticari elektronik ileti/.test(q)));
    assert.ok(questions.some((q) => /Kötüye kullanılarak/.test(q)));
    assert.deepEqual(findMissingFields(rest("en")), ["email address", "start date", "end date"]);
    assert.deepEqual(findMissingFields(rest("ar")), ["عنوان البريد الإلكتروني", "تاريخ البدء", "تاريخ الانتهاء"]);
  });
});

describe("wheel terms: copy rules (DAY5-SEO §2, contract §2)", () => {
  const SUPERLATIVE = /\ben (iyi|ucuz|kaliteli|avantajlı|ekonomik|güvenilir)\b|\bbest\b|cheapest|number one|الأفضل|أفضل|الأرخص/i;

  test("honest and plain: no superlatives, no hype, no fake scarcity", () => {
    for (const l of LOCALES) {
      const visible = text(l);
      assert.doesNotMatch(visible, SUPERLATIVE, l);
      assert.doesNotMatch(visible, /!/, `${l}: no exclamation marks`);
      assert.doesNotMatch(visible, /herkes kazan|everyone wins|الجميع يربح|son şans|last chance|acele|hurry|sınırlı sayıda|limited (stock|time|number)/i, `${l}: no hype`);
    }
  });

  test("Arabic punctuation and Western digits in Arabic; no Arabic punctuation in Turkish or English", () => {
    // The company name and address are Turkish proper names (Latin, with their own dots and comma).
    const arabic = text("ar").replaceAll(COMPANY, "").replaceAll(ADDRESS, "");
    assert.doesNotMatch(arabic, /[,;?]/, "Arabic punctuation");
    assert.doesNotMatch(arabic, /[٠-٩]/, "Western digits");
    // Within a run of text (list items and paragraphs are separate blocks on the page).
    for (const run of rest("ar").split(/<[^>]+>/)) {
      assert.doesNotMatch(run, /[A-Za-zÇĞİÖŞÜçğıöşü]\.\s+[؀-ۿ]/, `no Latin full stop before Arabic text: ${run}`);
    }
    for (const l of ["tr", "en"] as const) assert.doesNotMatch(text(l), /[،؛؟]/, l);
  });

  test("the page description follows the legal-page rules", () => {
    const d = LEGAL_PAGE_DESCRIPTIONS[SLUG];
    for (const l of LOCALES) {
      const value = d[l] ?? "";
      const n = [...value].length;
      assert.ok(l === "ar" ? n >= 100 && n <= 155 : n >= 120 && n <= 155, `${l} ${n}`);
      assert.ok(value.includes("PRESTİJ"));
      assert.doesNotMatch(value, /\d/);
      assert.doesNotMatch(value, SUPERLATIVE);
    }
    assert.doesNotMatch(d.ar ?? "", /[,;?]/);
  });
});
