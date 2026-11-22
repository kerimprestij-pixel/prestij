// Day 6 WHEEL-UI: the layout teaser (display-only, schedule-aware, tiny, signature rules), countdown and
// date formatting in tr/en/ar, prize labels, the label pickers, the spin response guard and the offline
// fallback texts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countdownParts, formatCountdown, formatWheelDate } from "@/components/store/wheel/countdown";
import { WHEEL_DIALOG_FALLBACK, wheelDialogLabels, wheelTeaserLabels } from "@/components/store/wheel/labels";
import { wheelPrizeLabel } from "@/components/store/wheel/prize-label";
import { readSpinResponse } from "@/components/store/wheel/spin-response";
import { buildWheelTeaser, isTeaserInSchedule, isWheelLive, wheelScheduleBounds, wheelTeaserSignature } from "@/components/store/wheel/wheel-teaser";
import { format } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import { campaignCacheProfile } from "@/lib/campaigns/pick";
import { parseSettings } from "@/lib/settings/types";
import type { GiftWheelSettings } from "@/lib/wheel/types";

const LOCALES = ["tr", "en", "ar"] as const;
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const live = (over: Partial<GiftWheelSettings> = {}): GiftWheelSettings => ({ ...parseSettings("giftWheel", { enabled: true }), ...over });

describe("layout teaser", () => {
  test("null while the wheel is off (the code default) or outside its schedule", () => {
    assert.equal(buildWheelTeaser(parseSettings("giftWheel", undefined), "tr", NOW), null, "code default: off");
    assert.equal(buildWheelTeaser(live({ startsAt: new Date(NOW + HOUR).toISOString() }), "tr", NOW), null, "not started");
    assert.equal(buildWheelTeaser(live({ endsAt: new Date(NOW).toISOString() }), "tr", NOW), null, "ended (end is exclusive)");
    assert.ok(buildWheelTeaser(live({ startsAt: new Date(NOW).toISOString(), endsAt: new Date(NOW + DAY).toISOString() }), "tr", NOW), "start is inclusive");
    assert.equal(isWheelLive(live({ slices: [] }), NOW), false);
  });

  test("display-only: no weights, prize values, slices or validity; under 0.5 KB with the labels in every locale", () => {
    const settings = live({ texts: { teaser: { tr: "Şansını dene", en: "Try your luck", ar: "جرّب حظك" } } });
    for (const locale of LOCALES) {
      const teaser = buildWheelTeaser(settings, locale, NOW)!;
      assert.deepEqual(Object.keys(teaser).sort(), ["audience", "autoOpenCooldownDays", "autoOpenSeconds", "endsAt", "exitIntent", "showToBusiness", "signature", "startsAt", "teaserDelaySeconds", "teaserText"]);
      const json = JSON.stringify(teaser);
      assert.ok(!/weight|slices|value|minOrderTotal|validity|round/.test(json), json);
      const { teaserText, ...island } = teaser;
      const props = JSON.stringify({ locale, teaser: island, labels: wheelTeaserLabels(defaultMessages[locale], teaserText) });
      assert.ok(Buffer.byteLength(props) < 500, `${locale}: ${Buffer.byteLength(props)} bytes`);
    }
    assert.equal(buildWheelTeaser(settings, "ar", NOW)?.teaserText, "جرّب حظك");
    assert.equal(buildWheelTeaser(live({ texts: { teaser: { tr: "Şansını dene" } } }), "en", NOW)?.teaserText, "Şansını dene", "Turkish fallback");
    assert.equal(buildWheelTeaser(live(), "en", NOW)?.teaserText, null, "no override → the dictionary text");
  });

  test("the signature changes with what visitors see or how it behaves, not with weights", () => {
    const base = live();
    const sig = wheelTeaserSignature(base);
    assert.match(sig, /^1\.[0-9a-z]+$/);
    assert.equal(wheelTeaserSignature(live()), sig, "stable");
    const reweighted = base.slices.map((s, i) => (i === 0 ? { ...s, weight: 999 } : s));
    assert.equal(wheelTeaserSignature({ ...base, slices: reweighted }), sig, "weights do not reset dismissals");
    const changes: Partial<GiftWheelSettings>[] = [
      { round: 2 },
      { slices: base.slices.map((s, i) => (i === 0 ? { ...s, label: { ...s.label, ar: "خصم ٥" } } : s)) },
      { slices: base.slices.map((s, i) => (i === 0 ? { ...s, tone: "ink" as const } : s)) },
      { slices: [...base.slices].reverse() },
      { texts: { title: { tr: "Kış Çarkı" } } },
      { autoOpenSeconds: 40 },
      { exitIntent: false },
      { audience: "everyone" },
      { endsAt: new Date(NOW + DAY).toISOString() },
    ];
    for (const change of changes) assert.notEqual(wheelTeaserSignature({ ...base, ...change }), sig, JSON.stringify(change));
  });

  test("schedule-aware cache lifetime: max when open-ended, minutes when a bound is under an hour away", () => {
    assert.deepEqual(wheelScheduleBounds(parseSettings("giftWheel", undefined)), []);
    assert.equal(campaignCacheProfile(wheelScheduleBounds(live()), NOW), "max");
    assert.equal(campaignCacheProfile(wheelScheduleBounds(live({ endsAt: new Date(NOW + 30 * 60_000).toISOString() })), NOW), "minutes");
    assert.equal(campaignCacheProfile(wheelScheduleBounds(live({ startsAt: new Date(NOW + 3 * DAY).toISOString() })), NOW), "days");
  });

  test("the island re-checks the schedule on the client clock", () => {
    assert.equal(isTeaserInSchedule({ startsAt: null, endsAt: new Date(NOW + 1).toISOString() }, NOW), true);
    assert.equal(isTeaserInSchedule({ startsAt: null, endsAt: new Date(NOW).toISOString() }, NOW), false);
    assert.equal(isTeaserInSchedule({ startsAt: new Date(NOW + 1).toISOString(), endsAt: null }, NOW), false);
  });
});

describe("countdown (tr/en/ar)", () => {
  const c = (locale: (typeof LOCALES)[number]) => defaultMessages[locale].wheel.countdown;

  test("parts of a remaining time", () => {
    assert.deepEqual(countdownParts(2 * DAY + 3 * HOUR + 14 * 60_000 + 9_500), { expired: false, days: 2, hours: 3, minutes: 14, seconds: 9 });
    assert.equal(countdownParts(0).expired, true);
    assert.equal(countdownParts(-5000).expired, true);
  });

  test("a day or more: days + hh:mm through the dictionary (Arabic plural forms, Western digits)", () => {
    const left = 2 * DAY + 3 * HOUR + 14 * 60_000 + 30_000;
    assert.equal(formatCountdown(left, "tr", c("tr")), "2g 03:14");
    assert.equal(formatCountdown(left, "en", c("en")), "2d 03:14");
    assert.equal(formatCountdown(left, "ar", c("ar")), "يومان 03:14");
    assert.equal(formatCountdown(DAY + 60_000, "ar", c("ar")), "يوم واحد 00:01");
    assert.equal(formatCountdown(5 * DAY, "ar", c("ar")), "5 أيام 00:00");
    assert.equal(formatCountdown(11 * DAY, "ar", c("ar")), "11 يومًا 00:00");
    for (const locale of LOCALES) assert.ok(!/[٠-٩]/.test(formatCountdown(left, locale, c(locale))), "no Arabic-Indic digits");
  });

  test("under a day: hh:mm:ss; at zero: the expired text", () => {
    assert.equal(formatCountdown(3 * HOUR + 14 * 60_000 + 9_999, "tr", c("tr")), "03:14:09");
    assert.equal(formatCountdown(59_000, "ar", c("ar")), "00:00:59");
    assert.equal(formatCountdown(0, "tr", c("tr")), "Süresi doldu");
    assert.equal(formatCountdown(-1, "en", c("en")), "Expired");
    assert.equal(formatCountdown(-1, "ar", c("ar")), "انتهت الصلاحية");
  });

  test("dates in Türkiye time, Western digits in Arabic, empty for garbage", () => {
    const iso = "2026-11-14T15:30:00.000Z"; // 18:30 in Istanbul
    assert.match(formatWheelDate(iso, "tr"), /14 Kasım 2026.*18:30/);
    assert.match(formatWheelDate(iso, "en"), /November 14, 2026.*6:30/);
    const ar = formatWheelDate(iso, "ar");
    assert.match(ar, /14/);
    assert.match(ar, /2026/);
    assert.ok(!/[٠-٩]/.test(ar));
    assert.equal(formatWheelDate("nope", "tr"), "");
  });
});

describe("prize labels", () => {
  const t = (locale: (typeof LOCALES)[number]) => defaultMessages[locale].wheel.prize;
  test("the slice label in the reader's language wins (Turkish readers: the Turkish one); otherwise built from the coupon", () => {
    assert.equal(wheelPrizeLabel({ label: { tr: "%10 indirim", en: "10% off" }, type: "percent", value: 10 }, "en", t("en")), "10% off");
    // FIX COR-7: no Turkish text on /ar: the automatic name, like the dialog, the cart and the e-mails.
    assert.equal(wheelPrizeLabel({ label: { tr: "Sürpriz %10", ar: " " }, type: "percent", value: 10 }, "ar", t("ar")), "خصم 10%");
    assert.equal(wheelPrizeLabel({ label: { tr: "Sürpriz %10" }, type: "percent", value: 10 }, "tr", t("tr")), "Sürpriz %10");
    assert.equal(wheelPrizeLabel({ label: null, type: "percent", value: 15 }, "tr", t("tr")), "%15 indirim");
    assert.equal(wheelPrizeLabel({ type: "fixed", value: 5000 }, "tr", t("tr")), format(t("tr").fixed, { amount: formatPrice(5000, "tr") }));
    assert.match(wheelPrizeLabel({ type: "fixed", value: 5000 }, "tr", t("tr")), /^50,00\s₺\sindirim$/u);
    assert.equal(wheelPrizeLabel({ type: "fixed", value: 5000 }, "en", t("en")), format(t("en").fixed, { amount: formatPrice(5000, "en") }));
    assert.equal(wheelPrizeLabel({ type: "free_shipping", value: 0 }, "ar", t("ar")), "شحن مجاني");
  });
});

describe("labels", () => {
  test("the teaser labels use the panel text when set", () => {
    assert.equal(wheelTeaserLabels(defaultMessages.tr, null).label, "Hediye çarkını çevir");
    assert.equal(wheelTeaserLabels(defaultMessages.tr, "Şansını dene").label, "Şansını dene");
  });

  test("the dialog labels carry every text the dialog and the chip show", () => {
    const l = wheelDialogLabels(defaultMessages.ar);
    assert.equal(l.dialog.spin, defaultMessages.ar.wheel.dialog.spin);
    assert.equal(l.chip.text, defaultMessages.ar.wheel.chip.text);
    assert.equal(l.errors.network, defaultMessages.ar.wheel.errors.network);
    assert.equal(l.opensInNewTab, defaultMessages.ar.common.opensInNewTab);
  });

  test("the offline fallback texts equal the dictionary defaults", () => {
    for (const locale of LOCALES) {
      assert.equal(WHEEL_DIALOG_FALLBACK[locale].close, defaultMessages[locale].wheel.dialog.close);
      assert.equal(WHEEL_DIALOG_FALLBACK[locale].network, defaultMessages[locale].wheel.errors.network);
    }
  });
});

describe("spin response guard", () => {
  test("a well-formed win passes through; anything malformed becomes a refusal the dialog can show", () => {
    const ok = { ok: true, sliceIndex: 2, prize: { label: "Ücretsiz kargo", summary: "…" }, holdUntil: "2026-11-19T09:00:00.000Z", claim: "register", repeated: false };
    assert.deepEqual(readSpinResponse(ok, 200), ok);
    assert.deepEqual(readSpinResponse({ ...ok, sliceIndex: 1.5 }, 200), { ok: false, error: "unavailable", message: "" });
    assert.deepEqual(readSpinResponse({ ...ok, claim: "steal" }, 200), { ok: false, error: "unavailable", message: "" });
    assert.deepEqual(readSpinResponse(null, 502), { ok: false, error: "unavailable", message: "" });
    assert.deepEqual(readSpinResponse(null, 404), { ok: false, error: "invalid_request", message: "" });
    assert.deepEqual(readSpinResponse({ ok: false, error: "spin_limit", message: "Çok fazla", retryAfterSeconds: 60 }, 429), { ok: false, error: "spin_limit", message: "Çok fazla", retryAfterSeconds: 60 });
  });
});
