// Reviews: plain-text cleaning, default display names, number/date formatting and link paths (pure).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatAverage, formatReviewDate, reviewLang } from "@/lib/reviews/display";
import { cleanLine, cleanMultiline, initialsOf, textLength } from "@/lib/reviews/text";
import { reviewLinkPath, reviewsSectionPath } from "@/lib/reviews/tokens";

describe("review text", () => {
  test("initials: first and last word, Turkish upper case, letters only", () => {
    assert.equal(initialsOf("Ayşe Yılmaz"), "A. Y.");
    assert.equal(initialsOf("mehmet ali kaya"), "M. K.");
    assert.equal(initialsOf("ilknur"), "İ.");
    assert.equal(initialsOf("  Çağla   Öztürk "), "Ç. Ö.");
    assert.equal(initialsOf("محمد علي"), "م. ع.");
    assert.equal(initialsOf("123 !!"), "");
    assert.equal(initialsOf(null), "");
  });

  test("tags, controls, bidi overrides and extra blank lines are removed", () => {
    assert.equal(cleanLine("  <b>Çok</b>\tgüzel\u0000 "), "Çok güzel");
    assert.equal(cleanLine("5 < 6 ve 7 > 3"), "5 < 6 ve 7 > 3", "comparisons are not tags");
    assert.equal(cleanLine("ab‮dc​"), "abdc");
    assert.equal(cleanMultiline("Satır 1  \r\n\r\n\r\n\r\n  Satır 2\n<script>alert(1)</script>"), "Satır 1\n\nSatır 2\nalert(1)");
    assert.equal(cleanMultiline(42), "");
    assert.equal(textLength("İyi 👍🏻"), 6);
  });
});

describe("review display", () => {
  test("average with one decimal in the page's locale", () => {
    assert.equal(formatAverage(467, "tr"), "4,7");
    assert.equal(formatAverage(450, "en"), "4.5");
    assert.equal(formatAverage(500, "ar"), "5.0", "Arabic pages use Latin digits");
  });

  test("dates in Istanbul time; unknown review locales fall back to Turkish", () => {
    assert.equal(formatReviewDate("2026-11-09T22:30:00.000Z", "tr"), "10 Kasım 2026");
    assert.equal(formatReviewDate("2026-11-09T22:30:00.000Z", "en"), "November 10, 2026");
    assert.equal(formatReviewDate("not a date", "en"), "");
    assert.equal(reviewLang("ar"), "ar");
    assert.equal(reviewLang("de"), "tr");
  });

  test("link paths are localized and jump to the reviews section", () => {
    assert.equal(reviewLinkPath("tr", "lavanta", "v1.abc.def"), "/tr/urunler/lavanta?degerlendir=v1.abc.def#degerlendirmeler");
    assert.equal(reviewLinkPath("en", "okyanus", "a+b"), "/en/products/okyanus?degerlendir=a%2Bb#degerlendirmeler");
    assert.equal(reviewsSectionPath("ar", "portakal"), "/ar/products/portakal#degerlendirmeler");
  });
});
