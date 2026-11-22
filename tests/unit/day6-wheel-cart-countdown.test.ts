// Day 6 WHEEL-CART: the prize countdown. Formatting in tr/en/ar (days + hh:mm, then hh:mm:ss, then the
// expired text; Western digits; Arabic day plurals), the Türkiye-time expiry label, the template split the
// UI renders the timer into, and the shared seconds clock (ticks once per second, only while someone
// listens and the tab is visible; null on the server and once nobody listens).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { secondsClock } from "@/components/cart/countdown-clock";
import { defaultMessages } from "@/i18n/messages";
import { countdownParts, formatCountdown, formatPrizeExpiry, msUntil, splitTemplate, type CountdownTexts } from "@/lib/cart/countdown";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;
const texts = (locale: "tr" | "en" | "ar"): CountdownTexts => defaultMessages[locale].wheel.countdown;
const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe("formatCountdown", () => {
  test("tr: days with hours:minutes, then hours:minutes:seconds under a day", () => {
    assert.equal(formatCountdown(2 * D + 3 * H + 14 * M + 7 * S, texts("tr"), "tr"), "2g 03:14");
    assert.equal(formatCountdown(D, texts("tr"), "tr"), "1g 00:00");
    assert.equal(formatCountdown(D - 1, texts("tr"), "tr"), "23:59:59");
    assert.equal(formatCountdown(3 * H + 14 * M + 7 * S, texts("tr"), "tr"), "03:14:07");
    assert.equal(formatCountdown(59 * S + 999, texts("tr"), "tr"), "00:00:59");
    assert.equal(formatCountdown(S, texts("tr"), "tr"), "00:00:01");
  });

  test("the expired text below one second, at zero, after the end and for unreadable input", () => {
    for (const ms of [999, 0, -5 * M, Number.NaN, Number.NEGATIVE_INFINITY]) {
      assert.equal(formatCountdown(ms, texts("tr"), "tr"), "Süresi doldu", String(ms));
    }
    assert.equal(formatCountdown(-1, texts("en"), "en"), defaultMessages.en.wheel.countdown.expired);
  });

  test("en", () => {
    assert.equal(formatCountdown(2 * D + 3 * H + 14 * M, texts("en"), "en"), "2d 03:14");
    assert.equal(formatCountdown(5 * H + 2 * M + 9 * S, texts("en"), "en"), "05:02:09");
  });

  test("ar: day plurals, Western digits, the clock kept as one run", () => {
    const ar = texts("ar");
    const cases: [number, string][] = [
      [1, "يوم واحد 05:00"],
      [2, "يومان 05:00"],
      [3, "3 أيام 05:00"],
      [11, "11 يومًا 05:00"],
      [100, "100 يوم 05:00"],
    ];
    for (const [days, expected] of cases) {
      const out = formatCountdown(days * D + 5 * H, ar, "ar");
      assert.equal(out, expected, `${days} days`);
      assert.doesNotMatch(out, ARABIC_INDIC);
    }
    assert.equal(formatCountdown(42 * M, ar, "ar"), "00:42:00");
    assert.equal(formatCountdown(0, ar, "ar"), "انتهت الصلاحية");
  });

  test("a panel override of the days template is used as given", () => {
    assert.equal(formatCountdown(3 * D + 4 * M, { days: "{days} gün {clock}", expired: "Bitti" }, "tr"), "3 gün 00:04");
  });
});

describe("countdown helpers", () => {
  test("countdownParts floors to whole seconds and never goes negative", () => {
    assert.deepEqual(countdownParts(D + 2 * H + 3 * M + 4 * S + 999), { days: 1, hours: 2, minutes: 3, seconds: 4 });
    assert.deepEqual(countdownParts(-10), { days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  test("msUntil measures to an ISO instant; an unreadable one is already over", () => {
    const now = Date.parse("2026-11-12T10:00:00.000Z");
    assert.equal(msUntil("2026-11-12T10:00:05.000Z", now), 5000);
    assert.equal(msUntil("2026-11-12T09:59:59.000Z", now), -1000);
    assert.equal(msUntil("not a date", now), Number.NEGATIVE_INFINITY);
  });

  test("splitTemplate puts the timer where the template says, or after a template without the placeholder", () => {
    assert.deepEqual(splitTemplate("Kalan süre: {time}", "time"), ["Kalan süre: ", ""]);
    assert.deepEqual(splitTemplate("Çark hediyen · {time}", "time"), ["Çark hediyen · ", ""]);
    assert.deepEqual(splitTemplate("{time} left", "time"), ["", " left"]);
    assert.deepEqual(splitTemplate("الوقت المتبقي: {time}", "time"), ["الوقت المتبقي: ", ""]);
    assert.deepEqual(splitTemplate("Kalan süre", "time"), ["Kalan süre ", ""]);
    assert.deepEqual(splitTemplate("", "time"), ["", ""]);
  });

  test("formatPrizeExpiry shows Türkiye time whatever the machine's zone", () => {
    const iso = "2026-11-15T11:30:00.000Z"; // 14:30 in Istanbul (UTC+3)
    assert.equal(formatPrizeExpiry(iso, "tr"), "15 Kasım 14:30");
    for (const locale of ["en", "ar"] as const) {
      const out = formatPrizeExpiry(iso, locale);
      assert.match(out, /14:30/, locale);
      assert.match(out, /15/, locale);
      assert.doesNotMatch(out, ARABIC_INDIC, locale);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// The shared clock, with a fake document (visibility) and mocked timers.

type Listener = () => void;
const docListeners = new Map<string, Set<Listener>>();
const fakeDocument = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener(type: string, fn: Listener) {
    if (!docListeners.has(type)) docListeners.set(type, new Set());
    docListeners.get(type)!.add(fn);
  },
  removeEventListener(type: string, fn: Listener) {
    docListeners.get(type)?.delete(fn);
  },
};
const setVisibility = (state: "visible" | "hidden") => {
  fakeDocument.visibilityState = state;
  for (const fn of [...(docListeners.get("visibilitychange") ?? [])]) fn();
};
const g = globalThis as unknown as { document?: unknown; window?: unknown };

describe("seconds clock (shared external store)", () => {
  let savedDocument: unknown;
  let savedWindow: unknown;

  beforeEach(() => {
    savedDocument = g.document;
    savedWindow = g.window;
    g.document = fakeDocument;
    g.window = globalThis;
    fakeDocument.visibilityState = "visible";
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000_500 });
  });

  afterEach(() => {
    mock.timers.reset();
    g.document = savedDocument;
    g.window = savedWindow;
    docListeners.clear();
  });

  test("null on the server and before anyone listens; a value as soon as someone does", () => {
    assert.equal(secondsClock.getServerSnapshot(), null);
    assert.equal(secondsClock.getSnapshot(), null);
    let calls = 0;
    const stop = secondsClock.subscribe(() => calls++);
    assert.equal(secondsClock.getSnapshot(), 1_000_000, "whole seconds of the current time");
    assert.equal(calls, 1, "the first value is announced at once");
    stop();
    assert.equal(secondsClock.getSnapshot(), null, "stale once nobody listens");
  });

  test("ticks once per second, aligned to the second boundary, one timer for every listener", () => {
    const seen: number[] = [];
    const a = secondsClock.subscribe(() => seen.push(secondsClock.getSnapshot()!));
    let bCalls = 0;
    const b = secondsClock.subscribe(() => bCalls++);
    try {
      assert.deepEqual(seen, [1_000_000]);
      mock.timers.tick(499);
      assert.deepEqual(seen, [1_000_000], "no tick before the boundary");
      mock.timers.tick(1);
      assert.deepEqual(seen, [1_000_000, 1_000_001], "the boundary tick");
      for (let i = 0; i < 3; i++) mock.timers.tick(1000);
      assert.deepEqual(seen, [1_000_000, 1_000_001, 1_000_002, 1_000_003, 1_000_004]);
      assert.equal(bCalls, 4, "the second listener shares the same ticks (it joined after the first value)");
    } finally {
      a();
      b();
    }
  });

  test("pauses while the tab is hidden and catches up when it is visible again", () => {
    let calls = 0;
    const stop = secondsClock.subscribe(() => calls++);
    try {
      mock.timers.tick(500);
      assert.equal(calls, 2);
      setVisibility("hidden");
      for (let i = 0; i < 10; i++) mock.timers.tick(1000);
      assert.equal(calls, 2, "no ticks while hidden");
      setVisibility("visible");
      assert.equal(calls, 3, "one catch-up tick on return");
      assert.equal(secondsClock.getSnapshot(), 1_000_011);
      mock.timers.tick(1000);
      assert.equal(calls, 4);
    } finally {
      stop();
    }
  });

  test("does not start in a hidden tab, and stops ticking after the last listener leaves", () => {
    fakeDocument.visibilityState = "hidden";
    let calls = 0;
    const stop = secondsClock.subscribe(() => calls++);
    for (let i = 0; i < 5; i++) mock.timers.tick(1000);
    assert.equal(calls, 0);
    assert.equal(secondsClock.getSnapshot(), null);
    stop();
    fakeDocument.visibilityState = "visible";
    let later = 0;
    const stop2 = secondsClock.subscribe(() => later++);
    stop2();
    for (let i = 0; i < 5; i++) mock.timers.tick(1000);
    assert.equal(later, 1, "only the first value; no timer kept running");
    assert.equal(docListeners.get("visibilitychange")?.size ?? 0, 0, "the visibility listener is removed");
  });
});
