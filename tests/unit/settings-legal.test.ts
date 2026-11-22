// Legal documents in the panel (src/lib/panel/legal/schemas.ts): the draft-notice split/compose keeps
// the stored shape the storefront and the checkout renderer expect, missing-data markers, version labels,
// and the publish schema (sanitized rich text, Turkish required).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LEGAL_DOCUMENTS } from "../../scripts/seed-data/legal";
import { LEGAL_KEYS, renderPreInformation } from "@/lib/orders/legal-render";
import {
  CHECKOUT_LEGAL_KEYS,
  cleanStoredBody,
  composeLegalBody,
  findMissingFields,
  legalPublishInput,
  legalRestoreInput,
  splitDraftNotice,
  splitLocalizedBody,
  suggestNextVersion,
} from "@/lib/panel/legal/schemas";

/** The storefront's own regex (src/components/sections/LegalDocument.tsx). */
const STOREFRONT_NOTICE = /<aside\b[^>]*\blegal-draft\b[^>]*>([\s\S]*?)<\/aside\s*>/i;

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of result.error?.issues ?? []) out[i.path.map(String).join(".")] ??= i.message;
  return out;
}

const publishPayload = (over: Record<string, unknown> = {}) => ({
  key: "kvkk",
  baseId: 1,
  baseUpdatedAt: "2026-11-06T15:29:14.891Z",
  version: "taslak-2",
  title: { tr: "KVKK Aydınlatma Metni", en: "Privacy Notice" },
  showNotice: true,
  notice: { tr: "<p><strong>TASLAK</strong> — hukukçu onayı bekliyor.</p>" },
  body: { tr: "<h2>Başlık</h2><p>Metin</p>", en: "", ar: null },
  ...over,
});

describe("checkout keys", () => {
  test("match the renderer's LEGAL_KEYS", () => {
    assert.deepEqual([...CHECKOUT_LEGAL_KEYS].sort(), Object.values(LEGAL_KEYS).sort());
  });
});

describe("draft notice split and compose", () => {
  test("every seeded document splits into notice + body and composes back to the same shape", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const parts = splitLocalizedBody(doc.body);
      assert.ok(parts.hasNotice, doc.key);
      for (const locale of ["tr", "en", "ar"] as const) {
        assert.ok(parts.notice[locale], `${doc.key}.${locale} notice`);
        assert.doesNotMatch(parts.body[locale] ?? "", /legal-draft/, `${doc.key}.${locale} body keeps no aside`);
      }
      const stored = composeLegalBody(parts.body, parts.notice, true);
      // The storefront lifts the same notice out of the composed body …
      assert.equal(stored.tr.match(STOREFRONT_NOTICE)?.[1], parts.notice.tr);
      // … and composing is stable: split(compose(x)) === x.
      const again = splitLocalizedBody(stored);
      assert.deepEqual(again.body, parts.body);
      assert.deepEqual(again.notice, parts.notice);
      assert.deepEqual(cleanStoredBody(stored), stored);
    }
  });

  test("turning the notice off drops the aside; empty translations are left out", () => {
    const stored = composeLegalBody({ tr: "<p>Metin</p>", en: "<p> </p>" }, { tr: "<p>Taslak</p>", en: "<p>Draft</p>" }, false);
    assert.deepEqual(stored, { tr: "<p>Metin</p>" });
    const withNotice = composeLegalBody({ tr: "<p>Metin</p>", en: "" }, { tr: "<p>Taslak</p>", en: "<p>Draft</p>" }, true);
    assert.deepEqual(withNotice, { tr: '<aside class="legal-draft" role="note"><p>Taslak</p></aside>\n<p>Metin</p>' });
  });

  test("unsafe markup is sanitized in both parts", () => {
    const stored = composeLegalBody({ tr: '<p onclick="x()">Metin<script>alert(1)</script></p><a href="javascript:alert(1)">l</a>' }, { tr: "<p>N<img src=x onerror=alert(1)></p>" }, true);
    assert.doesNotMatch(stored.tr, /script|onclick|onerror|javascript:|<img/);
    assert.match(stored.tr, /^<aside class="legal-draft" role="note"><p>N<\/p><\/aside>/);
  });

  test("a body without a notice splits into an empty notice", () => {
    assert.deepEqual(splitDraftNotice("<p>Sade</p>"), { notice: "", body: "<p>Sade</p>" });
  });

  test("the checkout renderer keeps the body and the notice text, drops the aside tag", () => {
    const body = composeLegalBody({ tr: "<h3>Madde 1</h3><p>Sözleşme metni</p>" }, { tr: "<p><strong>TASLAK</strong> uyarısı</p>" }, true);
    const html = renderPreInformation({
      locale: "tr",
      seller: { legalName: "PRESTİJ", siteName: "PRESTİJ", phone: "0352 353 30 70", email: "", address: { line: "Cırgalan Mah.", district: "Kocasinan", city: "Kayseri", country: "Türkiye" } },
      estimatedDays: { min: 1, max: 3 },
      buyer: {},
      items: [],
      totals: {
        subtotal: 0,
        couponDiscount: 0,
        couponCode: null,
        bankTransferDiscount: 0,
        bankTransferPercent: 0,
        shippingFlat: 0,
        shippingHeavy: 0,
        heavyKg: 0,
        freeShipping: false,
        hasShipment: false,
        paymentFee: 0,
        vatTotal: 0,
        grandTotal: 0,
      },
      paymentMethod: null,
      orderNumber: null,
      date: new Date("2026-11-09T10:00:00Z"),
      document: { key: "pre_information", version: "taslak-2", title: { tr: "Ön Bilgilendirme Formu" }, body },
    });
    assert.match(html, /<hr>\n<p><strong>TASLAK<\/strong> uyarısı<\/p>\n<h3>Madde 1<\/h3><p>Sözleşme metni<\/p>/);
    assert.doesNotMatch(html, /<aside/);
  });
});

describe("missing data markers and version labels", () => {
  test("[köşeli parantez] markers are listed once, in order", () => {
    const kvkk = LEGAL_DOCUMENTS.find((d) => d.key === "kvkk");
    assert.ok(kvkk);
    const missing = findMissingFields(splitDraftNotice(kvkk.body.tr).body);
    assert.ok(missing.includes("e-posta adresi"));
    assert.equal(new Set(missing).size, missing.length);
    assert.deepEqual(findMissingFields("<p>[a b] ve <strong>[a b]</strong> [cc]</p>"), ["a b", "cc"]);
  });

  test("the next label increments a trailing number and skips used labels", () => {
    assert.equal(suggestNextVersion("taslak-1"), "taslak-2");
    assert.equal(suggestNextVersion("taslak-1", ["taslak-1", "Taslak-2"]), "taslak-3");
    assert.equal(suggestNextVersion("v1.9"), "v1.10");
    assert.equal(suggestNextVersion("ilk"), "ilk-2");
    assert.equal(suggestNextVersion("2026"), "2027");
    assert.equal(suggestNextVersion(null), "sürüm-1");
  });
});

describe("publish and restore payloads", () => {
  test("a valid payload is sanitized and empty translations are dropped", () => {
    const parsed = legalPublishInput.parse(publishPayload({ body: { tr: "<p>Metin<script>x</script></p>", en: "<p></p>" } }));
    assert.deepEqual(parsed.body, { tr: "<p>Metin</p>" });
    assert.ok(parsed.baseUpdatedAt instanceof Date);
    assert.equal(parsed.version, "taslak-2");
  });

  test("Turkish body and title are required; a translation without Turkish is refused", () => {
    const errors = issues(legalPublishInput.safeParse(publishPayload({ title: { tr: " " }, body: { tr: "<p> </p>", en: "<p>Text</p>" } })));
    assert.ok(errors["title.tr"]);
    assert.ok(errors["body.tr"]);
  });

  test("an enabled notice needs Turkish text", () => {
    assert.ok(issues(legalPublishInput.safeParse(publishPayload({ notice: { tr: "" } })))["notice.tr"]);
    assert.ok(legalPublishInput.safeParse(publishPayload({ showNotice: false, notice: { tr: "" } })).success);
  });

  test("version labels: required, at most 40 characters, letters/digits first", () => {
    for (const version of ["", " ", "-taslak", "<b>v2</b>", "x".repeat(41)]) {
      assert.ok(issues(legalPublishInput.safeParse(publishPayload({ version }))).version, version);
    }
    for (const version of ["taslak-2", "2026-11 v1", "Sürüm 3", "v1.2/a"]) {
      assert.ok(legalPublishInput.safeParse(publishPayload({ version })).success, version);
    }
  });

  test("keys and ids are validated; a missing base is allowed only as null", () => {
    assert.ok(issues(legalPublishInput.safeParse(publishPayload({ key: "../x" }))).key);
    assert.ok(legalPublishInput.safeParse(publishPayload({ baseId: null, baseUpdatedAt: null })).success);
    assert.ok(issues(legalPublishInput.safeParse(publishPayload({ baseUpdatedAt: undefined }))).baseUpdatedAt);
    assert.ok(legalRestoreInput.safeParse({ key: "kvkk", sourceId: "3", version: "taslak-3", baseId: 1, baseUpdatedAt: "2026-11-06T15:29:14.891Z" }).success);
    assert.ok(issues(legalRestoreInput.safeParse({ key: "kvkk", sourceId: 0, version: "x", baseId: 1, baseUpdatedAt: null })).sourceId);
  });
});
