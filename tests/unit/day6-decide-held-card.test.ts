// Day 6 follow-up, lead decision D15 (COR-4: held spins invisible after the campaign end), the pure part:
// the /hesap card model for a held, unclaimed spin (prize name by the shared rule, conditions with the
// minimum basket, validity and heavy-parcel note, the claim-until date, the claim button text), the labels
// of its claimed state, the new texts in tr/en/ar ("siz", placeholders), and how the client card is wired
// (claimWheel, role="timer" countdown, cart view published, no zod in the account page's client chunk).
// The loader and the account-based claim against the database: tests/db/day6-decide-wheel.test.ts.
//   npx tsx --test tests/unit/day6-decide-held-card.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { formatWheelDate } from "@/components/store/wheel/countdown";
import { heldSpinCardLabels, heldSpinCardModel, type HeldSpinCardInput } from "@/components/store/wheel/held-spin-card";
import { ACCOUNT_WHEEL_HEADING_ID, HELD_CARD_FINAL_ERRORS, heldCardRefusal, heldHoldPassed } from "@/components/store/wheel/held-spin-state";
import { format } from "@/i18n/format";
import { defaultMessages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import type { WheelPrizeSnapshot } from "@/lib/wheel/types";

const LOCALES = ["tr", "en", "ar"] as const;
const HOLD = "2026-11-19T09:00:00.000Z";
const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const input = (prize: Partial<WheelPrizeSnapshot> = {}, over: Partial<HeldSpinCardInput> = {}): HeldSpinCardInput => ({
  prize: { type: "percent", value: 10, label: { tr: "%10 indirim", en: "10% off" }, minOrderTotal: 0, ...prize },
  holdUntil: HOLD,
  validityHours: 72,
  heavySurcharge: false,
  claimCta: null,
  ...over,
});

describe("D15: the held-spin card model", () => {
  test("Turkish: the prize name, the conditions, the claim-until date and the button", () => {
    const m = defaultMessages.tr.wheel;
    const model = heldSpinCardModel(input(), "tr", m);
    assert.equal(model.title, "Çark hediyeniz sizi bekliyor");
    assert.equal(model.label, "%10 indirim");
    // The prize name after a colon (DU-4): "Ücretsiz kargo" never stands capitalized mid-sentence.
    assert.equal(model.intro, "Çarkta kazandığınız hediye: %10 indirim. Hediyenizi aldığınızda indirim kodunuz hesabınıza tanımlanır.");
    assert.equal(model.conditions, "Hesabınıza tanımlandıktan sonra 3 gün geçerli.");
    assert.equal(model.claimUntil, `Hediyenizi ${formatWheelDate(HOLD, "tr")} tarihine kadar alabilirsiniz.`);
    assert.match(model.claimUntil, /2026/);
    assert.equal(model.holdUntil, HOLD);
    assert.equal(model.claimCta, "Hediyemi al");
  });

  test("the minimum basket is stated first (prize texts state their conditions, D12)", () => {
    for (const l of LOCALES) {
      const m = defaultMessages[l].wheel;
      const model = heldSpinCardModel(input({ value: 20, label: { tr: "%20 indirim" }, minOrderTotal: 75000 }), l, m);
      const min = format(m.result.minOrder, { amount: formatPrice(75000, l) }, l);
      assert.ok(model.conditions.startsWith(min), `${l}: ${model.conditions}`);
      assert.ok(model.conditions.includes(format(m.result.validityDays, { days: 3 }, l)), l);
    }
  });

  test("the shared prize-name rule: own language, Turkish for Turkish readers, a generated name otherwise", () => {
    const en = heldSpinCardModel(input(), "en", defaultMessages.en.wheel);
    assert.equal(en.label, "10% off");
    assert.ok(en.intro.includes("10% off"));
    const ar = heldSpinCardModel(input(), "ar", defaultMessages.ar.wheel);
    assert.equal(ar.label, format(defaultMessages.ar.wheel.prize.percent, { value: 10 }, "ar"), "no Arabic label: generated, never Turkish");
    assert.doesNotMatch(ar.intro, /indirim/);
    const fixed = heldSpinCardModel(input({ type: "fixed", value: 5000, label: { tr: "50 TL indirim" } }), "en", defaultMessages.en.wheel);
    assert.equal(fixed.label, format(defaultMessages.en.wheel.prize.fixed, { amount: formatPrice(5000, "en") }, "en"));
  });

  test("free shipping names the heavy-parcel exception only when that surcharge is on; hours under two days stay hours", () => {
    const m = defaultMessages.tr.wheel;
    const free = (heavySurcharge: boolean) =>
      heldSpinCardModel(input({ type: "free_shipping", value: 0, label: { tr: "Ücretsiz kargo" } }, { heavySurcharge, validityHours: 36 }), "tr", m);
    assert.equal(free(true).conditions, `${format(m.result.validity, { hours: 36 }, "tr")} ${m.result.freeShippingHeavy}`);
    assert.equal(free(false).conditions, format(m.result.validity, { hours: 36 }, "tr"));
  });

  test("the panel's claim button text wins where it is set", () => {
    const own = input({}, { claimCta: { tr: "Kodumu ver", en: "Get my code" } });
    assert.equal(heldSpinCardModel(own, "tr", defaultMessages.tr.wheel).claimCta, "Kodumu ver");
    assert.equal(heldSpinCardModel(own, "en", defaultMessages.en.wheel).claimCta, "Get my code");
    assert.equal(heldSpinCardModel(input(), "en", defaultMessages.en.wheel).claimCta, defaultMessages.en.wheel.claim.claimCta);
  });

  test("the claimed state reuses the dialog's and the account card's texts", () => {
    for (const l of LOCALES) {
      const m = defaultMessages[l].wheel;
      const labels = heldSpinCardLabels(m);
      assert.equal(labels.claimedTitle, m.claim.claimedTitle);
      assert.equal(labels.applied, m.claim.applied);
      assert.equal(labels.kept, m.claim.kept);
      assert.equal(labels.goToCart, m.claim.goToCart);
      assert.match(labels.timeLeft, /\{time\}/);
      assert.match(labels.expiresAt, /\{date\}/);
      assert.deepEqual(labels.countdown, { days: m.countdown.days, expired: m.countdown.expired });
      assert.equal(labels.network, m.errors.network);
      // After the hold or a final refusal: the hold-expiry text and a neutral title (existing texts).
      assert.equal(labels.expired, m.errors.spin_expired);
      assert.equal(labels.goneTitle, m.account.title);
    }
    assert.equal(heldSpinCardLabels(defaultMessages.tr.wheel).expired, "Çark sonucunun süresi doldu.");
  });

  test("free shipping reads naturally in tr and en (the name after a colon, not capitalized mid-sentence)", () => {
    const free = input({ type: "free_shipping", value: 0, label: { tr: "Ücretsiz kargo", en: "Free shipping" } });
    assert.equal(heldSpinCardModel(free, "tr", defaultMessages.tr.wheel).intro.split(".")[0], "Çarkta kazandığınız hediye: Ücretsiz kargo");
    assert.equal(heldSpinCardModel(free, "en", defaultMessages.en.wheel).intro.split(".")[0], "Your wheel prize: Free shipping");
  });
});

describe("D15: what the card does with a refusal and with the hold's end (held-spin-state)", () => {
  test("final refusals hide the button; network, server and session problems keep it for a retry", () => {
    for (const code of ["disabled", "not_started", "ended", "staff", "business", "has_ordered", "already_claimed", "claim_limit", "no_spin", "spin_expired"]) {
      assert.equal(heldCardRefusal(code).final, true, code);
    }
    for (const code of ["network", "unavailable", "rate_limited", "invalid_request", "sign_in_required", "something_new"]) {
      const r = heldCardRefusal(code);
      assert.deepEqual(r, { final: false, offerGone: false, expired: false, refresh: false }, code);
    }
  });

  test("the same lasting refusals as the dialog (its LASTING list), plus the spin's own end", () => {
    const dialog = src("src/components/store/wheel/GiftWheelDialog.tsx");
    const lasting = /const LASTING: readonly WheelEligibilityReason\[\] = \[([^\]]+)\]/.exec(dialog)?.[1] ?? "";
    const codes = [...lasting.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((c) => c !== "spin_limit"); // spin_limit: never from a claim
    assert.ok(codes.length >= 8, lasting);
    for (const code of codes) assert.ok(HELD_CARD_FINAL_ERRORS.includes(code as never), code);
  });

  test("a held spin that is no longer held (no_spin, ended, not_started, spin_expired) says the result expired", () => {
    for (const code of ["no_spin", "ended", "not_started", "spin_expired"]) {
      const r = heldCardRefusal(code);
      assert.equal(r.expired, true, code);
      assert.equal(r.offerGone, true, code);
    }
    assert.equal(heldCardRefusal("has_ordered").expired, false, "other refusals keep the server's message");
  });

  test("claim_limit keeps the offer's lines (the spin is still held); already_claimed refreshes the overview", () => {
    assert.deepEqual(heldCardRefusal("claim_limit"), { final: true, offerGone: false, expired: false, refresh: false });
    assert.deepEqual(heldCardRefusal("already_claimed"), { final: true, offerGone: true, expired: false, refresh: true });
  });

  test("the hold has passed from its end on; a date that cannot be read never counts as passed", () => {
    const end = Date.parse(HOLD);
    assert.equal(heldHoldPassed(HOLD, end - 1), false);
    assert.equal(heldHoldPassed(HOLD, end), true);
    assert.equal(heldHoldPassed(HOLD, end + 3_600_000), true);
    assert.equal(heldHoldPassed("not a date", end), false);
    assert.equal(heldHoldPassed("", end), false);
  });
});

describe("D15: the new texts", () => {
  test("exist in tr/en/ar with the same placeholders; Turkish in 'siz'; no exclamation mark", () => {
    for (const l of LOCALES) {
      const a = defaultMessages[l].wheel.account;
      assert.ok(a.heldTitle.trim(), l);
      assert.match(a.held, /\{prize\}/, l);
      assert.match(a.claimUntil, /\{date\}/, l);
      for (const text of [a.heldTitle, a.held, a.claimUntil]) {
        assert.doesNotMatch(text, /!/, `${l}: ${text}`);
        assert.doesNotMatch(text, /[٠-٩]/, `${l}: Western digits`);
      }
    }
    const tr = defaultMessages.tr.wheel.account;
    assert.match(tr.held, /^Çarkta kazandığınız hediye: \{prize\}\./);
    assert.match(tr.held, /Hediyenizi aldığınızda/);
    assert.match(tr.claimUntil, /alabilirsiniz\.$/);
    assert.match(tr.heldTitle, /hediyeniz sizi/);
  });
});

describe("D15: the client card's wiring", () => {
  const card = src("src/components/store/wheel/AccountHeldSpinCard.tsx");

  test("claims with the existing claimWheel action, publishes the new cart view and drops the launcher's cached answer", () => {
    assert.match(card, /^"use client";/);
    assert.match(card, /import \{ claimWheel \} from "@\/lib\/wheel\/actions";/);
    assert.match(card, /await claimWheel\(\{ locale \}\)/);
    assert.match(card, /if \(result\.cart\) publishCartView\(result\.cart\);/);
    assert.match(card, /clearCachedWheelData\(\)/);
    // The countdown is the shared one (role="timer", to the coupon's real end).
    assert.match(card, /<WheelCountdownText endsAt=\{claimed\.endsAt\}/);
    assert.match(src("src/components/store/wheel/WheelLive.tsx"), /role="timer"/);
    // Errors: the server's localized message, shown as an alert.
    assert.match(card, /result\.message \|\| labels\.unavailable/);
    assert.match(card, /role="alert"/);
  });

  test("keyboard focus is never dropped: aria-disabled while claiming, the notice after a final refusal (DU-1, DL-3)", () => {
    assert.doesNotMatch(card, /\bdisabled=\{claiming\}/, "a disabled button loses focus in Chrome");
    assert.match(card, /aria-disabled=\{claiming \|\| undefined\}/);
    assert.match(card, /aria-disabled:cursor-progress/);
    assert.match(card, /if \(claiming \|\| gone \|\| claimed\) return;/, "a second press while claiming does nothing");
    assert.match(card, /ref=\{noticeRef\}\s+role="alert"\s+tabIndex=\{-1\}/);
    assert.match(card, /noticeRef\.current\?\.focus\(\)/);
  });

  test("the hold's end: checked at click time and on a timer; then no claim is sent and the card says it expired (DL-1)", () => {
    assert.match(card, /import \{ ACCOUNT_WHEEL_HEADING_ID, heldCardRefusal, heldHoldPassed \} from "\.\/held-spin-state";/);
    assert.match(card, /if \(heldHoldPassed\(model\.holdUntil, Date\.now\(\)\)\) \{\s+focusNotice\.current = true;\s+setHoldOver\(true\);\s+return;/);
    assert.ok(card.indexOf("heldHoldPassed(model.holdUntil, Date.now())) {") < card.indexOf("await claimWheel("), "checked before the claim");
    assert.match(card, /window\.setInterval\(check, 60_000\)/);
    assert.match(card, /holdOver \? labels\.expired/);
    assert.match(card, /offerGone \? labels\.goneTitle : model\.title/);
  });

  test("already claimed elsewhere: the overview is refreshed and focus continues at the prize card's heading (DU-3)", () => {
    assert.match(card, /import \{ useRouter \} from "next\/navigation";/);
    assert.match(card, /if \(outcome\.refresh\) \{\s+setRefreshing\(true\);\s+router\.refresh\(\);/);
    assert.match(card, /document\.getElementById\(ACCOUNT_WHEEL_HEADING_ID\)\?\.focus\(\)/);
    const overview = src("src/components/store/wheel/AccountWheelCard.tsx");
    assert.ok(overview.includes(`<h2 id="${ACCOUNT_WHEEL_HEADING_ID}" tabIndex={-1}`), "the prize card's heading takes focus");
  });

  test("keeps zod and the wheel services out of the account page's client chunk", () => {
    assert.match(card, /import type \{ HeldSpinCardLabels, HeldSpinCardModel \} from "\.\/held-spin-card";/);
    assert.match(card, /import type \{ WheelClaimResult \} from "@\/lib\/wheel\/types";/);
    assert.doesNotMatch(card, /from "zod"|@\/lib\/wheel\/service|@\/lib\/data\//);
    // The refusal rules module has type-only imports, so it adds no runtime dependency either.
    const state = src("src/components/store/wheel/held-spin-state.ts");
    for (const line of state.split("\n").filter((l) => /^import /.test(l))) assert.match(line, /^import type /, line);
  });

  test("the overview's wheel card renders it above the prize card; the loader is a module of its own", () => {
    const overview = src("src/components/store/wheel/AccountWheelCard.tsx");
    assert.match(overview, /getAccountHeldSpin\(userId, now\)/);
    assert.match(overview, /<AccountHeldSpinCard/);
    assert.ok(overview.indexOf("{heldCard}") < overview.indexOf('aria-labelledby="account-wheel"'));
    assert.doesNotMatch(src("src/lib/data/wheel.ts"), /wheel\/service/, "the layout's teaser reader keeps its small import graph");
  });
});
