// Day 6 WHEEL-SERVER, pure modules: the weighted pick (statistical sanity with a seeded RNG), prize
// codes, every eligibility rule, countdowns and dates (tr/en/ar), prize labels and conditions, the
// same-origin check and canonical page path of the spin route, and the two wheel e-mails (tr/en/ar,
// RTL, marketing footer only on the reminder, panel overrides).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultMessages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import { getEmailTemplate } from "@/lib/email/registry";
import { renderTemplate, type EmailRenderEnvironment } from "@/lib/email/render";
import "@/lib/email/templates";
import { WHEEL_EMAIL_TEXTS, type WheelPrizeEmailData } from "@/lib/email/templates/wheel";
import { parseSettings } from "@/lib/settings/types";
import { generateWheelCode, isWheelCode } from "@/lib/wheel/code";
import { countdownParts, formatWheelCountdown, formatWheelDateTime } from "@/lib/wheel/countdown";
import { isSpinHeld, isStaffRoleString, spinHoldUntil, wheelAccountReason, wheelClaimReason, wheelScheduleState, wheelSpinReason } from "@/lib/wheel/eligibility";
import { pickWeightedIndex, secureRandomInt, type RandomInt } from "@/lib/wheel/pick";
import { generatedPrizeLabel, prizeCouponDescription, prizeLabel, prizeSnapshot, prizeSummary, prizeView } from "@/lib/wheel/prize";
import { canonicalWheelPath, isSameOriginRequest } from "@/lib/wheel/request";
import { GIFT_WHEEL_DEFAULT_SLICES, WHEEL_CODE_ALPHABET, WHEEL_CODE_PATTERN, type GiftWheelSettings } from "@/lib/wheel/types";

const LOCALES = ["tr", "en", "ar"] as const;
const m = (locale: (typeof LOCALES)[number]) => defaultMessages[locale].wheel;

/** mulberry32: a small deterministic PRNG; randomInt(max) = floor(u * max). */
function seededRandomInt(seed: number): RandomInt {
  let a = seed >>> 0;
  return (max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(u * max);
  };
}

/** A random source that returns the given values in order. */
const sequence = (...values: number[]): RandomInt => {
  let i = 0;
  return () => values[i++ % values.length];
};

const wheel = (over: Partial<GiftWheelSettings> = {}): GiftWheelSettings => ({ ...parseSettings("giftWheel", { enabled: true }), ...over });

describe("weighted pick", () => {
  test("statistical sanity: 200 000 seeded draws land within ±0.5 points of the configured shares", () => {
    const weights = GIFT_WHEEL_DEFAULT_SLICES.map((s) => s.weight); // 35 25 20 10 7 3
    const total = weights.reduce((a, b) => a + b, 0);
    for (const seed of [1, 42, 20261112]) {
      const counts = new Array(weights.length).fill(0);
      const rng = seededRandomInt(seed);
      const N = 200_000;
      for (let i = 0; i < N; i++) counts[pickWeightedIndex(weights, rng)]++;
      counts.forEach((count, i) => {
        const actual = (count / N) * 100;
        const expected = (weights[i] / total) * 100;
        assert.ok(Math.abs(actual - expected) < 0.5, `seed ${seed} slice ${i}: ${actual.toFixed(2)}% vs ${expected.toFixed(2)}%`);
      });
    }
  });

  test("boundaries: each roll maps to exactly one slice by cumulative weight", () => {
    const weights = [35, 25, 20, 10, 7, 3];
    const at = (roll: number) => pickWeightedIndex(weights, () => roll);
    assert.equal(at(0), 0);
    assert.equal(at(34), 0);
    assert.equal(at(35), 1);
    assert.equal(at(59), 1);
    assert.equal(at(60), 2);
    assert.equal(at(96), 4);
    assert.equal(at(97), 5);
    assert.equal(at(99), 5);
  });

  test("a slice of weight 1 among heavy ones still lands; the random source sees the total", () => {
    let seen = 0;
    assert.equal(pickWeightedIndex([1000, 1, 1000], (max) => ((seen = max), 1000)), 1);
    assert.equal(seen, 2001);
  });

  test("broken input throws instead of favouring a slice", () => {
    assert.throws(() => pickWeightedIndex([]));
    assert.throws(() => pickWeightedIndex([10, 0]));
    assert.throws(() => pickWeightedIndex([10, -1]));
    assert.throws(() => pickWeightedIndex([10, 1.5]));
    assert.throws(() => pickWeightedIndex([10, 10], () => 20), /out of range/);
    assert.throws(() => pickWeightedIndex([10, 10], () => -1), /out of range/);
  });

  test("the default source is crypto.randomInt (always in range)", () => {
    for (let i = 0; i < 2000; i++) {
      const v = secureRandomInt(7);
      assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
      const idx = pickWeightedIndex([1, 2, 3]);
      assert.ok(idx >= 0 && idx <= 2);
    }
  });
});

describe("prize codes", () => {
  test("CARK- + 6 characters of the look-alike-free alphabet", () => {
    for (let i = 0; i < 500; i++) assert.match(generateWheelCode(), WHEEL_CODE_PATTERN);
    assert.equal(generateWheelCode(() => 0), "CARK-AAAAAA");
    assert.equal(generateWheelCode(() => WHEEL_CODE_ALPHABET.length - 1), "CARK-999999");
    assert.equal(generateWheelCode(sequence(0, 1, 2, 3, 4, 5)), "CARK-ABCDEF");
    for (const c of "01ILO") assert.ok(!WHEEL_CODE_ALPHABET.includes(c), `no ${c}`);
  });

  test("isWheelCode accepts any case and surrounding spaces, refuses everything else", () => {
    assert.ok(isWheelCode("CARK-7KQ2MX"));
    assert.ok(isWheelCode("  cark-7kq2mx "));
    for (const bad of ["CARK-7KQ2M", "CARK-7KQ2MXX", "CARK-0KQ2MX", "KAMPANYA10", "", null, 12]) assert.equal(isWheelCode(bad), false, String(bad));
  });
});

describe("eligibility rules", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const guest = { account: null, claimedThisRound: false };
  const customer = { staff: false, business: false, hasOrdered: false };

  test("schedule: disabled, not started, ended (end is exclusive), live", () => {
    assert.equal(wheelScheduleState(wheel({ enabled: false }), now), "disabled");
    assert.equal(wheelScheduleState(wheel({ startsAt: "2026-11-13T00:00:00.000Z" }), now), "not_started");
    assert.equal(wheelScheduleState(wheel({ endsAt: "2026-11-12T12:00:00.000Z" }), now), "ended");
    assert.equal(wheelScheduleState(wheel({ startsAt: "2026-11-12T12:00:00.000Z", endsAt: "2026-11-12T12:00:01.000Z" }), now), "live");
    assert.equal(wheelScheduleState(wheel(), now), "live");
  });

  test("staff in any role string, never customers", () => {
    for (const role of ["admin", "editor", "staff", "customer,editor", " admin "]) assert.ok(isStaffRoleString(role), role);
    for (const role of ["customer", "", null, undefined, "administrator"]) assert.equal(isStaffRoleString(role), false, String(role));
  });

  test("account rules in order: off, staff, business, audience", () => {
    assert.equal(wheelAccountReason(wheel({ enabled: false }), { ...customer, staff: true }), "disabled");
    assert.equal(wheelAccountReason(wheel(), { staff: true, business: true, hasOrdered: true }), "staff");
    assert.equal(wheelAccountReason(wheel(), { ...customer, business: true, hasOrdered: true }), "business");
    assert.equal(wheelAccountReason(wheel({ showToBusiness: true }), { ...customer, business: true }), "eligible");
    assert.equal(wheelAccountReason(wheel(), { ...customer, hasOrdered: true }), "has_ordered");
    assert.equal(wheelAccountReason(wheel({ audience: "everyone" }), { ...customer, hasOrdered: true }), "eligible");
    assert.equal(wheelAccountReason(wheel(), customer), "eligible");
    assert.equal(wheelClaimReason(wheel({ audience: "everyone", showToBusiness: true }), { staff: true, business: true, hasOrdered: true }), "staff", "staff never, whatever the audience");
  });

  test("a new spin: guests pass the account rules (checked again at claim), then round and schedule", () => {
    assert.equal(wheelSpinReason(wheel(), guest, now), "eligible");
    assert.equal(wheelSpinReason(wheel({ enabled: false }), guest, now), "disabled");
    assert.equal(wheelSpinReason(wheel({ endsAt: "2026-11-01T00:00:00.000Z" }), guest, now), "ended");
    assert.equal(wheelSpinReason(wheel(), { account: { ...customer, hasOrdered: true }, claimedThisRound: false }, now), "has_ordered");
    assert.equal(wheelSpinReason(wheel(), { account: customer, claimedThisRound: true }, now), "already_claimed");
    assert.equal(wheelSpinReason(wheel({ startsAt: "2027-01-01T00:00:00.000Z" }), { account: customer, claimedThisRound: true }, now), "already_claimed", "the round rule comes before the schedule");
  });

  test("a held spin: spun or bound, no coupon, inside the hold (holdDays from the spin)", () => {
    const createdAt = new Date("2026-11-05T12:00:00.000Z");
    assert.equal(spinHoldUntil(createdAt, 7).toISOString(), "2026-11-12T12:00:00.000Z");
    const spin = { status: "spun", couponId: null, createdAt };
    assert.ok(isSpinHeld(spin, 7, new Date("2026-11-12T11:59:59.999Z")));
    assert.equal(isSpinHeld(spin, 7, now), false, "the hold end is exclusive");
    assert.ok(isSpinHeld({ ...spin, status: "bound" }, 8, now));
    assert.equal(isSpinHeld({ ...spin, status: "claimed" }, 8, now), false);
    assert.equal(isSpinHeld({ ...spin, status: "expired" }, 8, now), false);
    assert.equal(isSpinHeld({ ...spin, status: "bound", couponId: 5 }, 8, now), false);
  });
});

describe("countdown and dates", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  test("parts round down; past and invalid ends are expired", () => {
    assert.deepEqual(countdownParts("2026-11-14T15:14:59.900Z", now), { totalMs: 184_499_900, days: 2, hours: 3, minutes: 14, seconds: 59, expired: false });
    assert.equal(countdownParts("2026-11-12T11:00:00.000Z", now).expired, true);
    assert.equal(countdownParts("2026-11-12T12:00:00.000Z", now).totalMs, 0);
    assert.equal(countdownParts("2026-11-12T12:00:00.999Z", now).expired, true, "less than a second left is over");
    assert.equal(countdownParts("nope", now).expired, true);
  });

  test("formatting: days + hh:mm, or hh:mm:ss under a day, in every locale with Western digits", () => {
    const ends = "2026-11-14T15:14:59.000Z";
    assert.equal(formatWheelCountdown(ends, now, m("tr").countdown, "tr"), "2g 03:14");
    assert.equal(formatWheelCountdown(ends, now, m("en").countdown, "en"), "2d 03:14");
    assert.equal(formatWheelCountdown(ends, now, m("ar").countdown, "ar"), "يومان 03:14");
    assert.equal(formatWheelCountdown("2026-11-15T15:14:59.000Z", now, m("ar").countdown, "ar"), "3 أيام 03:14");
    assert.equal(formatWheelCountdown("2026-11-12T15:14:59.000Z", now, m("tr").countdown, "tr"), "03:14:59");
    for (const l of LOCALES) assert.equal(formatWheelCountdown("2026-11-12T11:00:00.000Z", now, m(l).countdown, l), m(l).countdown.expired);
  });

  test("dates in Istanbul time; Arabic keeps Western digits", () => {
    const tr = formatWheelDateTime("2026-11-14T12:00:00.000Z", "tr");
    assert.match(tr, /14 Kasım 2026/);
    assert.match(tr, /15:00/, "UTC+3");
    const ar = formatWheelDateTime("2026-11-14T12:00:00.000Z", "ar");
    assert.match(ar, /14/);
    assert.ok(!/[٠-٩]/.test(ar), "no Arabic-Indic digits");
    assert.equal(formatWheelDateTime("nope", "en"), "");
  });
});

describe("prizes", () => {
  const [five, ten, ship, , fifty, twenty] = GIFT_WHEEL_DEFAULT_SLICES;

  test("the snapshot keeps type, value, label and minimum (free shipping is 0), never the weight", () => {
    assert.deepEqual(prizeSnapshot(fifty), { type: "fixed", value: 5000, label: { tr: "50 TL indirim", en: "₺50 off", ar: "خصم 50 ليرة" }, minOrderTotal: 30000 });
    assert.deepEqual(prizeSnapshot({ ...ship, value: 7 }).value, 0);
    assert.deepEqual(prizeSnapshot({ ...ten, label: { tr: "%10", en: "  ", ar: undefined } }).label, { tr: "%10" }, "blank translations dropped");
    assert.ok(!("weight" in prizeSnapshot(ten)));
  });

  test("labels: own translation, Turkish for tr, generated for a missing translation (never Turkish in en/ar)", () => {
    assert.equal(prizeLabel(prizeSnapshot(ten), "en", m("en")), "10% off");
    assert.equal(prizeLabel({ type: "percent", value: 12, label: { tr: "Sürpriz %12" } }, "tr", m("tr")), "Sürpriz %12");
    assert.equal(prizeLabel({ type: "percent", value: 12, label: { tr: "Sürpriz %12" } }, "en", m("en")), "12% off");
    assert.equal(prizeLabel({ type: "percent", value: 12, label: { tr: "Sürpriz %12" } }, "ar", m("ar")), "خصم 12%");
    assert.equal(prizeLabel({ type: "fixed", value: 7500, label: null }, "tr", m("tr")), `${formatPrice(7500, "tr")} indirim`);
    assert.equal(generatedPrizeLabel({ type: "free_shipping", value: 0 }, "ar", m("ar")), "شحن مجاني");
  });

  test("conditions: minimum basket when set, validity always, heavy-parcel note only for free shipping with the surcharge on", () => {
    const opts = { validityHours: 72, heavySurcharge: true };
    // FIX UX-8: whole days of 2 or more read in days ("3 gün", not "72 saat"); D1: "siz".
    assert.equal(prizeSummary(prizeSnapshot(five), opts, "tr", m("tr")), "Hesabınıza tanımlandıktan sonra 3 gün geçerli.");
    assert.equal(
      prizeSummary(prizeSnapshot(twenty), opts, "tr", m("tr")),
      `${formatPrice(75000, "tr")} ve üzeri alışverişlerde geçerli. Hesabınıza tanımlandıktan sonra 3 gün geçerli.`,
    );
    assert.equal(prizeSummary(prizeSnapshot(five), { validityHours: 36, heavySurcharge: false }, "tr", m("tr")), "Hesabınıza tanımlandıktan sonra 36 saat geçerli.");
    assert.equal(prizeSummary(prizeSnapshot(ship), opts, "en", m("en")), `Valid for 3 days after it is added to your account. ${m("en").result.freeShippingHeavy}`);
    assert.ok(!prizeSummary(prizeSnapshot(ship), { ...opts, heavySurcharge: false }, "tr", m("tr")).includes(m("tr").result.freeShippingHeavy));
    assert.equal(prizeSummary(prizeSnapshot(five), { validityHours: 1, heavySurcharge: false }, "en", m("en")), "Valid for 1 hour after it is added to your account.");
    assert.match(prizeSummary(prizeSnapshot(five), { validityHours: 48, heavySurcharge: false }, "ar", m("ar")), /يومين/);
    assert.match(prizeSummary(prizeSnapshot(five), { validityHours: 30, heavySurcharge: false }, "ar", m("ar")), /30 ساعة/);
    for (const l of LOCALES) assert.ok(!/[٠-٩]/.test(prizeSummary(prizeSnapshot(fifty), opts, l, m(l))), `${l}: Western digits`);
    assert.deepEqual(prizeView(prizeSnapshot(ten), opts, "en", m("en")), { label: "10% off", summary: "Valid for 3 days after it is added to your account." });
  });

  test("the panel note on the coupon is Turkish and names the round", () => {
    assert.equal(prizeCouponDescription(prizeSnapshot(ten), 3), "Hediye çarkı · %10 indirim · 3. tur");
  });
});

describe("spin route request helpers", () => {
  const headers = (h: Record<string, string>) => new Headers(h);
  test("same origin only: Origin host = Host, Sec-Fetch-Site same-origin when sent", () => {
    assert.ok(isSameOriginRequest(headers({ origin: "https://prestij.com.tr", host: "prestij.com.tr", "sec-fetch-site": "same-origin" })));
    assert.ok(isSameOriginRequest(headers({ origin: "http://check.localhost:3710", host: "check.localhost:3710" })));
    assert.ok(isSameOriginRequest(headers({ origin: "https://prestij.com.tr", host: "internal:3000", "x-forwarded-host": "prestij.com.tr" })));
    assert.equal(isSameOriginRequest(headers({ host: "prestij.com.tr" })), false, "no Origin");
    assert.equal(isSameOriginRequest(headers({ origin: "null", host: "prestij.com.tr" })), false);
    assert.equal(isSameOriginRequest(headers({ origin: "https://evil.example", host: "prestij.com.tr" })), false);
    assert.equal(isSameOriginRequest(headers({ origin: "https://prestij.com.tr", host: "prestij.com.tr", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginRequest(headers({ origin: "https://prestij.com.tr", host: "prestij.com.tr", "sec-fetch-site": "same-site" })), false);
    assert.equal(isSameOriginRequest(headers({ origin: "not a url", host: "prestij.com.tr" })), false);
  });

  test("page path: canonical Turkish folder path, no query, ≤ 200 characters, local paths only", () => {
    assert.equal(canonicalWheelPath("/en/products/lavanta?utm=x#top"), "/urunler/lavanta");
    assert.equal(canonicalWheelPath("/ar/category/sivi-sabun"), "/kategori/sivi-sabun");
    assert.equal(canonicalWheelPath("/tr"), "/");
    assert.equal(canonicalWheelPath(`/tr/blog/${"a".repeat(300)}`)?.length, 200);
    for (const bad of ["https://evil.example/tr", "//evil.example", "/xx/urunler", "urunler", "/tr/a b", "/tr/\\x", 5, undefined]) assert.equal(canonicalWheelPath(bad), null, String(bad));
  });
});

describe("e-mails", () => {
  const SITE = "https://prestij.test";
  const env = (locale: (typeof LOCALES)[number], emails: unknown = {}): EmailRenderEnvironment => ({
    locale,
    messages: defaultMessages[locale],
    general: parseSettings("general", { email: "info@prestij.test" }),
    emails: parseSettings("emails", emails),
    siteUrl: SITE,
  });
  const data: WheelPrizeEmailData = {
    name: "Ayşe <b>",
    prize: { tr: "50 TL indirim", en: "₺50 off", ar: "خصم 50 ليرة" },
    type: "fixed",
    value: 5000,
    minOrderTotal: 30000,
    code: "CARK-7KQ2MX",
    endsAt: "2026-11-15T09:30:00.000Z",
    cartUrl: `${SITE}/tr/sepet`,
    shopUrl: `${SITE}/tr/urunler`,
  };

  test("both templates are registered with Turkish panel labels and the same placeholders", () => {
    const prize = getEmailTemplate("wheel_prize");
    const reminder = getEmailTemplate("wheel_prize_reminder");
    assert.ok(prize && reminder);
    assert.equal(prize.label, "Çark hediyesi tanımlandı");
    assert.equal(reminder.label, "Çark hediyesi hatırlatma");
    assert.equal(Boolean(prize.marketing), false, "the prize mail is transactional");
    assert.equal(reminder.marketing, true, "the reminder carries the unsubscribe link");
    assert.deepEqual([...prize.placeholders], ["name", "prize", "code", "date"]);
    assert.deepEqual([...reminder.placeholders], ["name", "prize", "code", "date"]);
  });

  for (const locale of LOCALES) {
    test(`wheel_prize renders a complete mail in ${locale}`, () => {
      const mail = renderTemplate(getEmailTemplate("wheel_prize")!, data, env(locale));
      const label = data.prize[locale]!;
      const t = WHEEL_EMAIL_TEXTS[locale];
      assert.equal(mail.subject, t.prize.subject.replace("{prize}", label));
      assert.ok(mail.html.includes(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      assert.ok(mail.html.includes("CARK-7KQ2MX") && mail.text.includes("CARK-7KQ2MX"), "the code");
      assert.ok(mail.html.includes("Ayşe &lt;b&gt;"), "name escaped");
      assert.ok(mail.text.includes(formatPrice(30000, locale)), "minimum basket");
      assert.ok(mail.text.includes(t.common.expiresLabel));
      assert.ok(mail.html.includes(`href="${SITE}/tr/sepet"`) && mail.html.includes(`href="${SITE}/tr/urunler"`));
      assert.ok(!mail.html.includes(defaultMessages[locale].email.layout.unsubscribe), "no unsubscribe link in a transactional mail");
      if (locale === "ar") assert.ok(!/[٠-٩]/.test(mail.text), "Western digits");
    });

    test(`wheel_prize_reminder renders in ${locale} with the unsubscribe footer`, () => {
      const mail = renderTemplate(getEmailTemplate("wheel_prize_reminder")!, data, env(locale), { unsubscribeUrl: `${SITE}/${locale}/bulten/ayril?t=abc` });
      assert.equal(mail.subject, WHEEL_EMAIL_TEXTS[locale].reminder.subject);
      assert.ok(mail.html.includes("CARK-7KQ2MX"));
      assert.ok(mail.html.includes(`href="${SITE}/${locale}/bulten/ayril?t=abc"`), "unsubscribe link");
    });
  }

  test("the heavy-parcel note appears only for free shipping with the surcharge on", () => {
    const ship: WheelPrizeEmailData = { ...data, type: "free_shipping", value: 0, minOrderTotal: 0, prize: { tr: "Ücretsiz kargo" } };
    const note = defaultMessages.tr.wheel.result.freeShippingHeavy;
    assert.ok(renderTemplate(getEmailTemplate("wheel_prize")!, { ...ship, heavySurcharge: true }, env("tr")).text.includes(note));
    assert.ok(!renderTemplate(getEmailTemplate("wheel_prize")!, ship, env("tr")).text.includes(note));
    assert.ok(!renderTemplate(getEmailTemplate("wheel_prize")!, { ...data, heavySurcharge: true }, env("tr")).text.includes(note), "not for a discount");
    const en = renderTemplate(getEmailTemplate("wheel_prize")!, { ...ship, heavySurcharge: true }, env("en"));
    assert.ok(en.subject.endsWith("Free shipping"), "an untranslated label gets the generated English name");
  });

  test("panel overrides of subject and intro work with the declared placeholders", () => {
    const emails = { templates: { wheel_prize: { enabled: true, subject: { tr: "{name}, kodun: {code}" }, intro: { tr: "{prize} seni bekliyor ({date})." } } } };
    const mail = renderTemplate(getEmailTemplate("wheel_prize")!, data, env("tr", emails));
    assert.equal(mail.subject, "Ayşe <b>, kodun: CARK-7KQ2MX");
    assert.ok(mail.text.includes("50 TL indirim seni bekliyor ("));
  });

  test("built-in texts: the same keys and placeholders in tr/en/ar", () => {
    const shape = (o: object, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}:${[...v.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",")}`] : shape(v as object, `${prefix}${k}.`)));
    const tr = shape(WHEEL_EMAIL_TEXTS.tr);
    assert.deepEqual(shape(WHEEL_EMAIL_TEXTS.en), tr);
    assert.deepEqual(shape(WHEEL_EMAIL_TEXTS.ar), tr);
  });
});
