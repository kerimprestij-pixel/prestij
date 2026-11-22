// Day 6 WHEEL-UI: where the wheel may appear (route rules in tr/en/ar, the rendered-page check), the
// per-device hints keyed by the teaser signature (dismissal, "Bir daha gösterme", auto-open cooldown, the
// held prize, the chip), the per-tab cache, and what the floating control shows (launcher mode).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalWheelPath, isWheelSpendPath, wheelBlockedByPage, wheelRouteAllowed, type WheelPageProbe } from "@/components/store/wheel/route-rules";
import { launcherMode, teaserPrizeLabel, type LauncherInput } from "@/components/store/wheel/launcher-model";
import {
  WHEEL_NEVER_SHOW_DAYS,
  WHEEL_STATE_TTL_MS,
  WHEEL_STORAGE_KEY,
  canAutoOpen,
  heldPrize,
  isChipHidden,
  isPrizeLive,
  isTeaserHidden,
  parseCachedWheelData,
  parseWheelStore,
  withChipHidden,
  withCollapsed,
  withNeverShow,
  withPrize,
  withPrompted,
  type WheelDialogData,
  type WheelStore,
} from "@/components/store/wheel/wheel-storage";
import { wheelDialogLabels } from "@/components/store/wheel/labels";
import { defaultMessages } from "@/i18n/messages";
import { WHEEL_NEVER_SHOW_DAYS as CORE_NEVER_SHOW, WHEEL_STORAGE_KEY as CORE_STORAGE_KEY, type WheelState } from "@/lib/wheel/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);

describe("route rules", () => {
  test("canonical Turkish paths from tr/en/ar URLs (query, hash and trailing slash ignored)", () => {
    assert.equal(canonicalWheelPath("/tr"), "/");
    assert.equal(canonicalWheelPath("/en/"), "/");
    assert.equal(canonicalWheelPath("/en/products/lavanta?varyant=5-l#x"), "/urunler/lavanta");
    assert.equal(canonicalWheelPath("/ar/account/sign-in/"), "/hesap/giris");
    assert.equal(canonicalWheelPath("/en/urunler"), "/urunler", "a rewritten (Turkish-folder) pathname works too");
  });

  test("allowed: home, catalog, products, categories, blog, content pages, contact, samples, business", () => {
    for (const path of ["/tr", "/en", "/ar", "/tr/urunler", "/en/products/lavanta", "/ar/category/el-sabunu", "/tr/blog/x", "/en/page/hakkimizda", "/tr/iletisim", "/ar/samples", "/en/business"]) {
      assert.equal(wheelRouteAllowed(path), true, path);
    }
  });

  test("never: cart, checkout, account (sign-in and register too), orders, newsletter pages, panel, api", () => {
    for (const path of [
      "/tr/sepet",
      "/en/cart",
      "/ar/checkout",
      "/tr/odeme/kart",
      "/tr/hesap",
      "/en/account/register",
      "/ar/account/sign-in",
      "/tr/hesap/siparisler/PR-1",
      "/tr/siparis/PR-261001",
      "/en/order",
      "/tr/bulten/onay",
      "/en/newsletter/unsubscribe",
      "/panel",
      "/api/wheel/spin",
    ]) {
      assert.equal(wheelRouteAllowed(path), false, path);
    }
  });

  test("never on legal pages known by slug (in every language), but other /sayfa pages are fine", () => {
    assert.equal(wheelRouteAllowed("/tr/sayfa/kvkk"), false);
    assert.equal(wheelRouteAllowed("/en/page/mesafeli-satis-sozlesmesi"), false);
    assert.equal(wheelRouteAllowed("/ar/page/hediye-carki-kampanya-kosullari"), false);
    assert.equal(wheelRouteAllowed("/tr/sayfa/kvkk-ozet"), true, "prefix of a slug only, not a legal page");
    assert.equal(wheelRouteAllowed("/tr/sayfa/hakkimizda"), true);
  });

  test("claim and spend paths (cart, checkout, order, account) drop the cached wheel state", () => {
    assert.equal(isWheelSpendPath("/tr/sepet"), true);
    assert.equal(isWheelSpendPath("/en/checkout/card"), true);
    assert.equal(isWheelSpendPath("/ar/order/PR-1"), true);
    // D15 follow-up (DU-2): the /hesap card claims held spins, so the launcher asks again afterwards.
    assert.equal(isWheelSpendPath("/tr/hesap"), true);
    assert.equal(isWheelSpendPath("/en/account"), true);
    assert.equal(isWheelSpendPath("/tr/hesapla"), false, "a prefix of the folder only");
    assert.equal(isWheelSpendPath("/tr/urunler"), false);
  });

  const probe = (parts: { legal?: boolean; robots?: string | null; canonical?: boolean }): WheelPageProbe => ({
    querySelector(selector: string) {
      if (selector === "[data-legal-version]") return parts.legal ? { getAttribute: () => "1" } : null;
      if (selector === 'meta[name="robots"]') return parts.robots == null ? null : { getAttribute: () => parts.robots ?? null };
      if (selector === 'link[rel="canonical"]') return parts.canonical ? { getAttribute: () => "/tr" } : null;
      return null;
    },
  });

  test("the rendered page: a legal document, or a 404 (noindex without canonical), keeps the wheel away", () => {
    assert.equal(wheelBlockedByPage(probe({ legal: true, canonical: true })), true, "any legal page");
    assert.equal(wheelBlockedByPage(probe({ robots: "noindex", canonical: false })), true, "the not-found page");
    assert.equal(wheelBlockedByPage(probe({ robots: "noindex, nofollow", canonical: false })), true);
    assert.equal(wheelBlockedByPage(probe({ robots: "noindex", canonical: true })), false, "a page an editor marked noindex keeps the wheel");
    assert.equal(wheelBlockedByPage(probe({ robots: "index, follow", canonical: false })), false);
    assert.equal(wheelBlockedByPage(probe({ robots: null, canonical: true })), false);
  });
});

describe("per-device hints (localStorage prestij:wheel)", () => {
  const SIG = "3.k2j9xq";

  test("the key and the 30 days equal CORE's constants (copied to keep zod out of the bundle)", () => {
    assert.equal(WHEEL_STORAGE_KEY, CORE_STORAGE_KEY);
    assert.equal(WHEEL_NEVER_SHOW_DAYS, CORE_NEVER_SHOW);
  });

  // D14: hints of another ROUND start over; an edited wheel of the same round keeps the visitor's choices
  // (tests/unit/day6-decide-wheel-store.test.ts).
  test("garbage, other shapes and hints of another round start over", () => {
    assert.deepEqual(parseWheelStore(null, SIG), { sig: SIG });
    assert.deepEqual(parseWheelStore("{not json", SIG), { sig: SIG });
    assert.deepEqual(parseWheelStore("[1,2]", SIG), { sig: SIG });
    assert.deepEqual(parseWheelStore(JSON.stringify({ sig: "2.old", collapsed: true, hiddenUntil: NOW + DAY }), SIG), { sig: SIG });
    const kept = parseWheelStore(JSON.stringify({ sig: SIG, collapsed: true, hiddenUntil: NOW + DAY, promptedAt: NOW, chipHiddenUntil: NOW, prize: { label: "%10 indirim", holdUntil: "2026-11-19T09:00:00.000Z" }, extra: "x" }), SIG);
    assert.deepEqual(kept, { sig: SIG, collapsed: true, hiddenUntil: NOW + DAY, promptedAt: NOW, chipHiddenUntil: NOW, prize: { label: "%10 indirim", holdUntil: "2026-11-19T09:00:00.000Z" } });
    assert.equal(parseWheelStore(JSON.stringify({ sig: SIG, hiddenUntil: "soon", collapsed: "yes" }), SIG).hiddenUntil, undefined, "wrong types are dropped");
  });

  test('"Bir daha gösterme" hides the teaser for exactly 30 days', () => {
    const store = withNeverShow({ sig: SIG }, NOW);
    assert.equal(isTeaserHidden(store, NOW + 29 * DAY), true);
    assert.equal(isTeaserHidden(store, NOW + 30 * DAY), false);
    assert.equal(store.collapsed, true);
  });

  test("automatic opening: once per cooldown, never when minimized, hidden, or a prize is waiting", () => {
    const fresh: WheelStore = { sig: SIG };
    assert.equal(canAutoOpen(fresh, NOW, 7), true);
    const prompted = withPrompted(fresh, NOW);
    assert.equal(canAutoOpen(prompted, NOW + 6 * DAY, 7), false);
    assert.equal(canAutoOpen(prompted, NOW + 7 * DAY, 7), true);
    assert.equal(canAutoOpen(withCollapsed(fresh), NOW, 7), false);
    assert.equal(canAutoOpen(withNeverShow(fresh, NOW), NOW + DAY, 7), false);
    assert.equal(canAutoOpen(withPrize(fresh, { label: "%5 indirim", holdUntil: new Date(NOW + DAY).toISOString() }), NOW, 7), false);
  });

  test("the held prize lasts until its hold ends; long labels are cut; the chip hides for a day", () => {
    const store = withPrize({ sig: SIG }, { label: "x".repeat(120), holdUntil: new Date(NOW + 2 * DAY).toISOString() });
    assert.equal(store.prize?.label.length, 80);
    assert.ok(heldPrize(store, NOW + DAY));
    assert.equal(heldPrize(store, NOW + 2 * DAY), null);
    assert.equal(heldPrize({ sig: SIG, prize: { label: "a", holdUntil: "not a date" } }, NOW), null);
    const chip = withChipHidden({ sig: SIG }, NOW);
    assert.equal(isChipHidden(chip, NOW + DAY - 1), true);
    assert.equal(isChipHidden(chip, NOW + DAY), false);
  });

  test("a prize is live only before its real end", () => {
    assert.equal(isPrizeLive({ code: "CARK-AAAAAA", label: "x", endsAt: new Date(NOW + 1000).toISOString() }, NOW), true);
    assert.equal(isPrizeLive({ code: "CARK-AAAAAA", label: "x", endsAt: new Date(NOW).toISOString() }, NOW), false);
    assert.equal(isPrizeLive(null, NOW), false);
  });
});

const labels = wheelDialogLabels(defaultMessages.tr);
const state = (over: Partial<WheelState> = {}): WheelState => ({
  eligible: true,
  reason: "eligible",
  signedIn: false,
  spin: null,
  activePrize: null,
  slices: [],
  texts: { title: "", subtitle: "", teaser: "", claimCta: "", registerCta: "", signInCta: "" },
  links: { terms: null, privacy: null },
  validityHours: 72,
  ...over,
});
const data = (over: Partial<WheelState> = {}): WheelDialogData => ({ state: state(over), labels });

describe("per-tab cache of the loaded wheel", () => {
  test("reused within 10 minutes for the same signature only", () => {
    const raw = JSON.stringify({ sig: "1.a", at: NOW, data: data() });
    assert.ok(parseCachedWheelData(raw, "1.a", NOW + WHEEL_STATE_TTL_MS));
    assert.equal(parseCachedWheelData(raw, "1.a", NOW + WHEEL_STATE_TTL_MS + 1), null);
    assert.equal(parseCachedWheelData(raw, "2.b", NOW), null);
    assert.equal(parseCachedWheelData(raw, "1.a", NOW - 1), null, "a clock that went back");
    assert.equal(parseCachedWheelData("{", "1.a", NOW), null);
    assert.equal(parseCachedWheelData(null, "1.a", NOW), null);
  });
});

describe("launcher mode", () => {
  const base: LauncherInput = { signedIn: false, data: null, store: { sig: "s" }, now: NOW, routeOk: true, inSchedule: true };
  const prize = { code: "CARK-7K2M9Q", label: "%10 indirim", endsAt: new Date(NOW + 2 * DAY).toISOString() };

  test("nothing before the delay, on excluded pages or outside the schedule", () => {
    assert.equal(launcherMode({ ...base, now: 0 }), "none");
    assert.equal(launcherMode({ ...base, routeOk: false }), "none");
    assert.equal(launcherMode({ ...base, inSchedule: false }), "none");
  });

  test("guests: the teaser (from local hints alone), minimized after closing, gone after a lasting refusal", () => {
    assert.equal(launcherMode(base), "teaser");
    assert.equal(launcherMode({ ...base, store: { sig: "s", collapsed: true } }), "collapsed");
    assert.equal(launcherMode({ ...base, store: withNeverShow({ sig: "s" }, NOW) }), "none");
    assert.equal(launcherMode({ ...base, data: data({ eligible: false, reason: "spin_limit" }) }), "none");
    assert.equal(launcherMode({ ...base, data: data({ eligible: false, reason: "disabled", spin: { sliceIndex: 1, prize: { label: "%10 indirim", summary: "" }, holdUntil: "", claim: "register" } }) }), "teaser", "a held spin can still be claimed");
  });

  test("signed in: asks the server first; staff, business, ordered or claimed accounts see nothing", () => {
    assert.equal(launcherMode({ ...base, signedIn: true }), "none", "until the answer");
    assert.equal(launcherMode({ ...base, signedIn: true, data: data({ signedIn: true }) }), "teaser");
    for (const reason of ["staff", "business", "has_ordered", "already_claimed"] as const) {
      assert.equal(launcherMode({ ...base, signedIn: true, data: data({ eligible: false, reason }) }), "none", reason);
    }
    assert.equal(launcherMode({ ...base, signedIn: true, data: { state: null, labels } }), "none", "state failed to load");
  });

  test("signed in with a live prize: the reminder chip (also when the teaser was dismissed), until it ends or is closed", () => {
    const withPrizeData = data({ eligible: false, reason: "already_claimed", activePrize: prize, signedIn: true });
    assert.equal(launcherMode({ ...base, signedIn: true, data: withPrizeData }), "chip");
    assert.equal(launcherMode({ ...base, signedIn: true, data: withPrizeData, store: withNeverShow({ sig: "s" }, NOW) }), "chip");
    assert.equal(launcherMode({ ...base, signedIn: true, data: withPrizeData, now: NOW + 3 * DAY }), "none", "expired");
    assert.equal(launcherMode({ ...base, signedIn: true, data: withPrizeData, store: withChipHidden({ sig: "s" }, NOW) }), "none");
  });

  test("the teaser shows a held prize: the server's spin first, then the guest's device hint", () => {
    const spin = { sliceIndex: 2, prize: { label: "Ücretsiz kargo", summary: "" }, holdUntil: new Date(NOW + DAY).toISOString(), claim: "register" as const };
    assert.equal(teaserPrizeLabel({ signedIn: false, data: data({ spin }), store: { sig: "s" }, now: NOW }), "Ücretsiz kargo");
    assert.equal(teaserPrizeLabel({ signedIn: false, data: null, store: withPrize({ sig: "s" }, { label: "%5 indirim", holdUntil: new Date(NOW + DAY).toISOString() }), now: NOW }), "%5 indirim");
    assert.equal(teaserPrizeLabel({ signedIn: true, data: data(), store: withPrize({ sig: "s" }, { label: "%5 indirim", holdUntil: new Date(NOW + DAY).toISOString() }), now: NOW }), null, "a device hint never speaks for an account");
    assert.equal(teaserPrizeLabel({ signedIn: false, data: null, store: { sig: "s" }, now: NOW }), null);
  });
});
