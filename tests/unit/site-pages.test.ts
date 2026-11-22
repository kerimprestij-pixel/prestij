// SITE-PAGES: the seeded /kurumsal, /numune and /iletisim content parses with the section schemas and
// meets the contract (CTAs, sections, complete translations); contact form validation and the
// ?konu= mapping; reserved slugs; contact links.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SITE_PAGES } from "../../scripts/seed-data/site-pages";
import { sectionMeta, isSectionType } from "@/components/sections/schemas";
import { localizePath } from "@/i18n/paths";
import { formatInternationalPhone, mapHref, telHref, whatsappHref } from "@/lib/contact/links";
import { parseContactForm, readContactForm } from "@/lib/contact/schema";
import { subjectFromParam, SUBJECT_PARAMS, CONTACT_SUBJECTS } from "@/lib/contact/subjects";
import { isReservedPageSlug, RESERVED_PAGE_SLUGS, RESERVED_PAGES, reservedPagePath } from "@/lib/reserved-pages";
import { isSafeHref } from "@/lib/safe-href";

/** Seed references ("@media:…", "@product:…") become ids, like scripts/seed.ts does. */
function withIds(value: unknown): unknown {
  if (typeof value === "string") return /^@(media|product):/.test(value) ? 1 : value;
  if (Array.isArray(value)) return value.map(withIds);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withIds(v)]));
  return value;
}

/** Every string under a key named href (CTA, gallery, privacy link…). */
function hrefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => hrefs(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/href$/i.test(k) && typeof v === "string") out.push(v);
      else hrefs(v, out);
    }
  }
  return out;
}

/** Every localized text object ({ tr, … }) in the tree. */
function localizedTexts(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) value.forEach((v) => localizedTexts(v, out));
  else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.tr === "string") out.push(obj);
    else Object.values(obj).forEach((v) => localizedTexts(v, out));
  }
  return out;
}

describe("site pages seed", () => {
  test("covers exactly the reserved slugs, plus (day 5) the /urunler copy page and hakkimizda", () => {
    assert.deepEqual(SITE_PAGES.map((p) => p.slug).sort(), [...RESERVED_PAGE_SLUGS, "urunler", "hakkimizda"].sort());
  });

  for (const page of SITE_PAGES) {
    test(`/${page.slug}: every section is a known type and parses with its schema`, () => {
      assert.ok(page.sections.length > 0);
      page.sections.forEach((section, i) => {
        assert.equal(section.position, i, "positions follow the array order");
        assert.ok(isSectionType(section.type), `known type ${section.type}`);
        const parsed = sectionMeta[section.type].schema.safeParse(withIds(section.content));
        assert.ok(parsed.success, `/${page.slug} #${i} ${section.type}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
      });
    });

    test(`/${page.slug}: links are safe canonical paths`, () => {
      for (const href of hrefs(page.sections)) {
        assert.ok(isSafeHref(href), `${href} passes the link rule`);
        assert.ok(href.startsWith("/"), `${href} is an internal path`);
      }
    });

    test(`/${page.slug}: hero headlines use words that fit the narrow split column`, () => {
      for (const section of page.sections.filter((s) => s.type === "hero")) {
        for (const text of Object.values(section.content.headline as Record<string, string>)) {
          for (const word of text.split(/\s+/)) assert.ok([...word].length <= 10, `"${word}" is short enough for the hero`);
        }
      }
    });

    test(`/${page.slug}: every text has tr, en and ar`, () => {
      for (const text of localizedTexts([page.title, page.seo, page.sections])) {
        for (const locale of ["tr", "en", "ar"]) {
          assert.ok(typeof text[locale] === "string" && (text[locale] as string).trim().length > 0, `${JSON.stringify(text).slice(0, 80)} has ${locale}`);
        }
      }
    });
  }

  test("contract: kurumsal has hotel/spa/office/restaurant benefits, 5 L + 20 L, the quote form with CTAs to it and a FAQ", () => {
    const page = SITE_PAGES.find((p) => p.slug === "kurumsal")!;
    const types = page.sections.map((s) => s.type);
    assert.ok(types.includes("faq"));
    // Day 4 (REQUESTS): the quote form sits on the page itself; its CTAs jump to the #teklif anchor.
    assert.ok(types.includes("quote_form"));
    assert.ok(types.indexOf("quote_form") > types.indexOf("b2b_cta"));
    assert.ok(hrefs(page.sections).includes("/kurumsal#teklif"));
    assert.ok(!hrefs(page.sections).some((h) => h.startsWith("/iletisim?konu=")));
    const text = JSON.stringify(page.sections);
    for (const word of ["Oteller", "Spa", "Ofisler", "Restoran", "5 L", "20 L"]) assert.ok(text.includes(word), word);
  });

  test("contract: numune explains the steps, has a FAQ, the sample form and CTAs to it", () => {
    const page = SITE_PAGES.find((p) => p.slug === "numune")!;
    assert.ok(page.sections.some((s) => s.type === "faq"));
    assert.ok(page.sections.some((s) => s.type === "sample_request_form"));
    assert.ok(hrefs(page.sections).includes("/numune#numune-formu"));
    assert.ok(!hrefs(page.sections).some((h) => h.startsWith("/iletisim?konu=")));
  });

  test("contract: iletisim is contact_info + contact_form with all four subjects", () => {
    const page = SITE_PAGES.find((p) => p.slug === "iletisim")!;
    assert.deepEqual(
      page.sections.map((s) => s.type),
      ["contact_info", "contact_form"],
    );
    const form = sectionMeta.contact_form.schema.parse(page.sections[1].content);
    assert.deepEqual(
      form.subjects.map((s) => s.key),
      [...CONTACT_SUBJECTS],
    );
  });

  test("no contact data is hard-coded in the copy (it comes from settings)", () => {
    const text = JSON.stringify(SITE_PAGES);
    assert.ok(!/353\s?30\s?70|Cırgalan|@prestij/i.test(text));
  });
});

describe("contact_form section schema", () => {
  test("rejects duplicate subject keys and unsafe privacy links", () => {
    const base = sectionMeta.contact_form.defaults;
    assert.ok(sectionMeta.contact_form.schema.safeParse(base).success);
    const dup = { ...base, subjects: [{ key: "quote", label: { tr: "A" } }, { key: "quote", label: { tr: "B" } }] };
    assert.equal(sectionMeta.contact_form.schema.safeParse(dup).success, false);
    assert.equal(sectionMeta.contact_form.schema.safeParse({ ...base, privacyHref: "javascript:alert(1)" }).success, false);
    assert.equal(sectionMeta.contact_form.schema.safeParse({ ...base, subjects: [] }).success, false);
  });

  test("contact_info defaults show every channel", () => {
    const parsed = sectionMeta.contact_info.schema.parse({});
    assert.deepEqual([parsed.showPhone, parsed.showWhatsapp, parsed.showEmail, parsed.showAddress], [true, true, true, true]);
  });
});

describe("?konu= subjects", () => {
  test("Turkish params, keys and aliases map to subjects", () => {
    assert.equal(subjectFromParam("teklif"), "quote");
    assert.equal(subjectFromParam("NUMUNE"), "sample");
    assert.equal(subjectFromParam("genel"), "general");
    assert.equal(subjectFromParam("diğer"), "other");
    assert.equal(subjectFromParam("quote"), "quote");
    assert.equal(subjectFromParam("x"), null);
    assert.equal(subjectFromParam(null), null);
    for (const s of CONTACT_SUBJECTS) assert.equal(subjectFromParam(SUBJECT_PARAMS[s]), s);
  });

  test("the query survives localizing the link", () => {
    assert.equal(localizePath("en", "/iletisim?konu=teklif"), "/en/contact?konu=teklif");
    assert.equal(localizePath("ar", "/iletisim?konu=numune"), "/ar/contact?konu=numune");
  });
});

describe("contact form validation", () => {
  const valid = { name: "Ayşe Yılmaz", email: " Ayse@Example.COM ", phone: "0532 123 45 67", subject: "quote", message: "Otelimiz için 20 L fiyat almak istiyoruz.", locale: "en", website: "" };

  test("accepts and normalizes a valid message", () => {
    const result = parseContactForm(readContactForm(valid));
    assert.ok(result.success);
    assert.deepEqual(result.data, {
      name: "Ayşe Yılmaz",
      email: "ayse@example.com",
      phone: "+905321234567",
      subject: "quote",
      message: "Otelimiz için 20 L fiyat almak istiyoruz.",
      locale: "en",
    });
  });

  test("keeps landlines and foreign numbers, drops an empty phone", () => {
    const landline = parseContactForm(readContactForm({ ...valid, phone: "0352 353 30 70" }));
    assert.ok(landline.success && landline.data.phone === "0352 353 30 70");
    const none = parseContactForm(readContactForm({ ...valid, phone: "  " }));
    assert.ok(none.success && none.data.phone === null);
  });

  test("returns error codes per field", () => {
    const result = parseContactForm(readContactForm({ ...valid, name: "", email: "nope", phone: "12", message: "kısa" }));
    assert.ok(!result.success);
    assert.deepEqual(result.fieldErrors, { name: "required", email: "invalid_email", phone: "invalid_phone", message: "too_short" });
    const long = parseContactForm(readContactForm({ ...valid, message: "x".repeat(5001), name: "1 2" }));
    assert.ok(!long.success);
    assert.equal(long.fieldErrors.message, "too_long");
    assert.equal(long.fieldErrors.name, "invalid_name");
  });

  test("unknown subjects fall back to general, unknown locales to tr; control characters are removed", () => {
    const result = parseContactForm(readContactForm({ ...valid, subject: "spam", locale: "de", message: "Merhaba\u0000 dünya‮, nasılsınız?" }));
    assert.ok(result.success);
    assert.equal(result.data.subject, "general");
    assert.equal(result.data.locale, "tr");
    assert.equal(result.data.message, "Merhaba dünya, nasılsınız?");
  });
});

describe("reserved pages and contact links", () => {
  test("reserved slugs map to their routes", () => {
    assert.deepEqual(RESERVED_PAGES, { kurumsal: "business", numune: "samples", iletisim: "contact" });
    assert.ok(isReservedPageSlug("iletisim"));
    assert.ok(!isReservedPageSlug("kvkk"));
    assert.equal(reservedPagePath("numune"), "/numune");
  });

  test("phone, WhatsApp and map links", () => {
    assert.equal(telHref("0352 353 30 70"), "tel:+903523533070");
    assert.equal(telHref(""), null);
    assert.equal(whatsappHref("903523533070", "Merhaba"), "https://wa.me/903523533070?text=Merhaba");
    assert.equal(formatInternationalPhone("903523533070"), "+90 352 353 30 70");
    assert.equal(mapHref("https://maps.app.goo.gl/abc", "x"), "https://maps.app.goo.gl/abc");
    assert.equal(mapHref("javascript:alert(1)", "Kocasinan, Kayseri"), "https://www.google.com/maps/search/?api=1&query=Kocasinan%2C%20Kayseri");
    assert.equal(mapHref(undefined, " "), null);
  });
});
