// Day 6 INTEGRATE: cross-area agreements that no single area's tests can see. The campaign terms are
// one key/slug everywhere (wheel types, seed, launch checklist, the island's route rules, the page
// editor's legal select); the three countdown helpers (cart, island, server) read the same in tr/en/ar;
// every newsletter source has a panel label; a required video field asks for a video.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultMessages } from "@/i18n/messages";
import { LOCALES } from "@/i18n/locales";
import { formatCountdown as cartCountdown } from "@/lib/cart/countdown";
import { formatCountdown as islandCountdown } from "@/components/store/wheel/countdown";
import { WHEEL_LEGAL_SLUGS, wheelRouteAllowed } from "@/components/store/wheel/route-rules";
import { SUBSCRIBER_SOURCE } from "@/components/panel/marketing/labels";
import { sectionMeta } from "@/components/sections/schemas";
import { normalizeSectionContent } from "@/lib/panel/content/sections";
import { SUBSCRIBER_SOURCES } from "@/lib/panel/marketing/schemas";
import { WHEEL_TERMS_LEGAL_KEY as LAUNCH_TERMS_KEY } from "@/lib/panel/seo/launch";
import { formatWheelCountdown } from "@/lib/wheel/countdown";
import { WHEEL_TERMS_LEGAL_KEY, WHEEL_TERMS_PAGE_SLUG } from "@/lib/wheel/types";
import { LEGAL_DOCUMENTS, WHEEL_TERMS_KEY } from "../../scripts/seed-data/legal";
import { LEGAL_PAGES } from "../../scripts/seed-data/site";

describe("campaign terms: one key and one slug", () => {
  test("wheel types, seed, launch checklist and route rules agree", () => {
    assert.equal(WHEEL_TERMS_LEGAL_KEY, WHEEL_TERMS_KEY);
    assert.equal(LAUNCH_TERMS_KEY, WHEEL_TERMS_LEGAL_KEY);
    assert.ok(
      LEGAL_PAGES.some((p) => p.slug === WHEEL_TERMS_PAGE_SLUG && p.key === WHEEL_TERMS_LEGAL_KEY),
      "the seeded legal page shows the terms under the slug the dialog links to",
    );
    assert.ok((WHEEL_LEGAL_SLUGS as readonly string[]).includes(WHEEL_TERMS_PAGE_SLUG));
    assert.equal(wheelRouteAllowed(`/tr/sayfa/${WHEEL_TERMS_PAGE_SLUG}`), false);
  });

  test("the page editor's legal select offers every seeded legal document", () => {
    const field = sectionMeta.legal_document.fields.find((f) => f.key === "key");
    assert.ok(field && field.type === "select");
    const offered = new Set(field.options.map((o) => o.value));
    for (const doc of LEGAL_DOCUMENTS) assert.ok(offered.has(doc.key), doc.key);
  });
});

describe("countdowns read the same everywhere", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const cases = [0, 999, 1000, 59_000, 3_599_000, 86_399_000, 86_400_000, 2 * 86_400_000 + 3 * 3_600_000 + 14 * 60_000 + 9_000, 11 * 86_400_000 + 5_000];
  for (const locale of LOCALES) {
    test(`cart, island and server helpers in ${locale}`, () => {
      const texts = defaultMessages[locale].wheel.countdown;
      for (const ms of cases) {
        const server = formatWheelCountdown(now + ms, now, texts, locale);
        assert.equal(cartCountdown(ms, texts, locale), server, `cart ${ms}`);
        assert.equal(islandCountdown(ms, locale, texts), server, `island ${ms}`);
      }
      assert.match(formatWheelCountdown(now + cases[7], now, texts, locale), /03:14/);
      assert.ok(!/[٠-٩]/.test(formatWheelCountdown(now + cases[8], now, texts, locale)), "Western digits");
    });
  }
});

describe("panel vocabulary", () => {
  test("every newsletter source, the wheel included, has a Turkish label", () => {
    assert.ok((SUBSCRIBER_SOURCES as readonly string[]).includes("wheel"));
    for (const source of SUBSCRIBER_SOURCES) assert.ok(SUBSCRIBER_SOURCE[source], source);
    assert.equal(SUBSCRIBER_SOURCE.wheel, "Hediye çarkı");
  });

  test("a required video field asks for a video, an image field for an image", () => {
    const video = normalizeSectionContent("video", {});
    assert.equal(video.ok, false);
    assert.deepEqual(
      !video.ok && video.issues.filter((i) => i.path.join(".") === "videoMediaId"),
      [{ path: ["videoMediaId"], message: "Bir video seçin." }],
    );
    const gallery = normalizeSectionContent("lifestyle_gallery", { items: [{ imageId: null }] });
    assert.deepEqual(!gallery.ok && gallery.issues, [{ path: ["items", 0, "imageId"], message: "Bir görsel seçin." }]);
  });
});
