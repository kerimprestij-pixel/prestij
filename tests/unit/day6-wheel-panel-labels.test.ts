// Day 6 WHEEL-PANEL: the pure pieces of the Hediye Çarkı panel pages. E-mail masking for editors, the
// live/scheduled status line, Turkish number formats, winner statuses and their URL params, the period
// and winners filters (the CSV export reads the same params as the list), the nav entry and the audit
// vocabulary (settings key giftWheel links to the wheel page, the export and the new-round action).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { actionInfo, entityHref, entityLabel, fieldLabel } from "@/components/panel/audit/labels";
import { navForRole, PANEL_NAV_ITEMS } from "@/components/panel/nav-config";
import {
  DEFAULT_WHEEL_PERIOD,
  parseWheelPeriod,
  parseWinnerFilter,
  parseWinnerPage,
  wheelOverviewHref,
  winnerQuery,
  winnersExportHref,
  winnersListHref,
} from "@/lib/panel/gift-wheel/filters";
import {
  BOUND_VIA_LABELS,
  formatHours,
  formatRatio,
  formatShare,
  maskEmail,
  niceCountMax,
  prizeConditions,
  prizeDetail,
  prizeValueLabel,
  WHEEL_SCHEDULE_STATUS,
  wheelScheduleStatus,
  WINNER_STATUS,
  WINNER_STATUSES,
  winnerStatusFromParam,
} from "@/lib/panel/gift-wheel/labels";
import { WHEEL_BOUND_VIA } from "@/db/schema/wheel";
import { formatPrice } from "@/lib/pricing/money";

describe("maskEmail (editors never see a full address)", () => {
  test("keeps one or two leading characters, the domain's first letter and the top-level domain", () => {
    assert.equal(maskEmail("ayse.yilmaz@gmail.com"), "ay•••@g•••.com");
    assert.equal(maskEmail("ali@firma.com.tr"), "a•••@f•••.tr");
    assert.equal(maskEmail("x@test.local"), "x•••@t•••.local");
    assert.equal(maskEmail("ab@localhost"), "a•••@l•••");
  });

  test("never returns the address itself; empty and malformed values are safe", () => {
    for (const email of ["ayse.yilmaz@gmail.com", "mehmet@prestij.com.tr", "a@b.co", "long.name+tag@sub.domain.example.org"]) {
      const masked = maskEmail(email)!;
      assert.notEqual(masked, email);
      assert.ok(masked.includes("•••"));
      const [local, domain] = email.split("@");
      const host = domain.slice(0, domain.lastIndexOf("."));
      assert.ok(!masked.includes(local) || local.length <= 2, `${email} → ${masked}`);
      assert.ok(!masked.includes(host) || host.length <= 1, `${email} → ${masked}`);
    }
    assert.equal(maskEmail(null), null);
    assert.equal(maskEmail(""), null);
    assert.equal(maskEmail("not-an-email"), "•••");
    assert.equal(maskEmail("@nolocal.com"), "•••");
    assert.equal(maskEmail("trailing@"), "•••");
  });
});

describe("wheelScheduleStatus", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  const cfg = (enabled: boolean, startsAt: string | null, endsAt: string | null) => ({ enabled, startsAt, endsAt });

  test("off → ended → scheduled → live, with the storefront's half-open window (start ≤ now < end)", () => {
    assert.equal(wheelScheduleStatus(cfg(false, null, null), now), "off");
    assert.equal(wheelScheduleStatus(cfg(false, "2026-11-01T00:00:00.000Z", null), now), "off");
    assert.equal(wheelScheduleStatus(cfg(true, null, null), now), "live");
    assert.equal(wheelScheduleStatus(cfg(true, "2026-11-13T00:00:00.000Z", null), now), "scheduled");
    assert.equal(wheelScheduleStatus(cfg(true, null, "2026-11-12T12:00:00.000Z"), now), "ended", "the end instant itself is over");
    assert.equal(wheelScheduleStatus(cfg(true, "2026-11-12T12:00:00.000Z", null), now), "live", "the start instant itself is live");
    assert.equal(wheelScheduleStatus(cfg(true, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"), now), "live");
  });

  test("every status has a Turkish label and a tone", () => {
    for (const meta of Object.values(WHEEL_SCHEDULE_STATUS)) {
      assert.ok(meta.label && meta.description && meta.tone);
    }
  });
});

describe("formatting", () => {
  test("percent shares in Turkish style (% before the number, decimal comma)", () => {
    assert.equal(formatShare(25), "%25");
    assert.equal(formatShare(2.5), "%2,5");
    assert.equal(formatShare(0), "%0");
    assert.equal(formatShare(Number.NaN), "%0");
    assert.equal(formatRatio(3, 12), "%25");
    assert.equal(formatRatio(0, 0), "–");
  });

  test("hours with days in brackets", () => {
    assert.equal(formatHours(72), "72 saat (3 gün)");
    assert.equal(formatHours(36), "36 saat (1,5 gün)");
    assert.equal(formatHours(24), "24 saat (1 gün)");
    assert.equal(formatHours(12), "12 saat");
  });

  test("prize values and conditions", () => {
    assert.equal(prizeValueLabel("percent", 10), "%10");
    assert.equal(prizeValueLabel("fixed", 5000), formatPrice(5000, "tr"));
    assert.equal(prizeValueLabel("free_shipping", 0), "Ücretsiz kargo");
    assert.equal(prizeConditions({ type: "percent", value: 10, minOrderTotal: 0 }), "%10 indirim");
    assert.equal(
      prizeConditions({ type: "fixed", value: 5000, minOrderTotal: 30000 }),
      `${formatPrice(5000, "tr")} indirim · ${formatPrice(30000, "tr")} ve üzeri sepette`,
    );
    assert.match(formatPrice(5000, "tr"), /^50,00\s₺$/u);
    assert.equal(prizeConditions({ type: "free_shipping", value: 0, minOrderTotal: 0 }), "Ücretsiz kargo");
  });

  test("prize detail under a winner's label: only what the label does not already say", () => {
    assert.equal(prizeDetail({ type: "percent", value: 10, minOrderTotal: 0, label: { tr: "%10 indirim" } }), "");
    assert.equal(prizeDetail({ type: "free_shipping", value: 0, minOrderTotal: 0, label: { tr: "Ücretsiz kargo" } }), "");
    assert.equal(
      prizeDetail({ type: "fixed", value: 5000, minOrderTotal: 30000, label: { tr: "50 TL indirim" } }),
      `${formatPrice(30000, "tr")} ve üzeri sepette`,
    );
    assert.equal(prizeDetail({ type: "percent", value: 15, minOrderTotal: 0, label: { tr: "Sürpriz hediye" } }), "%15 indirim");
    assert.equal(prizeDetail({ type: "percent", value: 15, minOrderTotal: 0, label: null }), "%15 indirim");
  });

  test("chart scale for counts: 2/4/6/8/10 × 10^k, never below 2, midpoint whole", () => {
    assert.equal(niceCountMax(0), 2);
    assert.equal(niceCountMax(1), 2);
    assert.equal(niceCountMax(3), 4);
    assert.equal(niceCountMax(5), 6);
    assert.equal(niceCountMax(9), 10);
    assert.equal(niceCountMax(11), 20);
    assert.equal(niceCountMax(45), 60);
    assert.equal(niceCountMax(999), 1000);
    for (const v of [1, 3, 7, 13, 77, 345, 4321]) {
      const max = niceCountMax(v);
      assert.ok(max >= v && Number.isInteger(max / 2), `${v} → ${max}`);
    }
  });
});

describe("winner statuses", () => {
  test("labels, tones and unique ASCII URL params", () => {
    const params = WINNER_STATUSES.map((s) => WINNER_STATUS[s].param);
    assert.equal(new Set(params).size, params.length);
    for (const p of params) assert.match(p, /^[a-z-]+$/);
    for (const s of WINNER_STATUSES) {
      assert.equal(winnerStatusFromParam(WINNER_STATUS[s].param), s);
      assert.ok(WINNER_STATUS[s].label && WINNER_STATUS[s].description);
    }
    assert.equal(winnerStatusFromParam("nope"), null);
    assert.equal(winnerStatusFromParam(undefined), null);
  });

  test("every bound_via value has a Turkish label", () => {
    for (const v of WHEEL_BOUND_VIA) assert.ok(BOUND_VIA_LABELS[v]);
  });
});

describe("filters and links", () => {
  test("period: 7, 30 or 90 days; anything else is the default (30)", () => {
    assert.equal(parseWheelPeriod({ donem: "7" }), 7);
    assert.equal(parseWheelPeriod({ donem: "90" }), 90);
    assert.equal(parseWheelPeriod({ donem: ["30", "7"] }), 30);
    assert.equal(parseWheelPeriod({ donem: "365" }), DEFAULT_WHEEL_PERIOD);
    assert.equal(parseWheelPeriod({}), DEFAULT_WHEEL_PERIOD);
    assert.equal(parseWheelPeriod(new URLSearchParams("donem=7")), 7);
    assert.equal(wheelOverviewHref(30), "/panel/hediye-carki");
    assert.equal(wheelOverviewHref(7), "/panel/hediye-carki?donem=7");
  });

  test("winners: status param, trimmed search (≤ 100 chars), page ≥ 1", () => {
    assert.deepEqual(parseWinnerFilter({ durum: "kullanildi", ara: "  CARK-7KQ2MX " }), { status: "used", q: "CARK-7KQ2MX" });
    assert.deepEqual(parseWinnerFilter({ durum: "x" }), { status: null, q: "" });
    assert.equal(parseWinnerFilter({ ara: "a".repeat(300) }).q.length, 100);
    assert.equal(parseWinnerPage({ sayfa: "3" }), 3);
    assert.equal(parseWinnerPage({ sayfa: "0" }), 1);
    assert.equal(parseWinnerPage({ sayfa: "-2" }), 1);
    assert.equal(parseWinnerPage({ sayfa: "1.5" }), 1);
    assert.equal(parseWinnerPage({}), 1);
  });

  test("the list link and the CSV link carry the same filter (page only on the list)", () => {
    const filter = { status: "active" as const, q: "ayse@" };
    assert.equal(winnerQuery(filter, 2), "durum=aktif&ara=ayse%40&sayfa=2");
    assert.equal(winnersListHref(filter, 2), "/panel/hediye-carki/kazananlar?durum=aktif&ara=ayse%40&sayfa=2");
    assert.equal(winnersListHref({}), "/panel/hediye-carki/kazananlar");
    assert.equal(winnersExportHref(filter), "/panel/api/hediye-carki/export?durum=aktif&ara=ayse%40");
    assert.equal(winnersExportHref({}), "/panel/api/hediye-carki/export");
    // Round trip: what the link writes, the page and the route read back.
    assert.deepEqual(parseWinnerFilter(new URLSearchParams(winnerQuery(filter))), filter);
  });
});

describe("panel navigation", () => {
  test("Pazarlama → Hediye Çarkı is ready, editor and up, after Kuponlar", () => {
    const item = PANEL_NAV_ITEMS.find((i) => i.href === "/panel/hediye-carki");
    assert.ok(item);
    assert.equal(item.label, "Hediye Çarkı");
    assert.equal(item.minRole, "editor");
    assert.equal(item.ready, true);
    const hrefs = (role: "staff" | "editor" | "admin") => navForRole(role).flatMap((g) => g.items.map((i) => i.href));
    assert.ok(!hrefs("staff").includes("/panel/hediye-carki"));
    assert.ok(hrefs("editor").includes("/panel/hediye-carki"));
    assert.ok(hrefs("admin").includes("/panel/hediye-carki"));
    const marketing = navForRole("admin").find((g) => g.title === "Pazarlama")!.items.map((i) => i.href);
    assert.equal(marketing.indexOf("/panel/hediye-carki"), marketing.indexOf("/panel/kuponlar") + 1);
  });
});

describe("audit vocabulary", () => {
  test("the giftWheel settings row links to the wheel's own page; other settings keep /panel/ayarlar", () => {
    assert.equal(entityHref("settings", "giftWheel"), "/panel/hediye-carki/ayarlar");
    assert.equal(entityHref("settings", "shipping"), "/panel/ayarlar");
    assert.equal(entityHref("settings", null), "/panel/ayarlar");
  });

  test("winners export and new round have Turkish names", () => {
    assert.equal(entityLabel("wheel_spin"), "Çark kazananları");
    assert.equal(entityHref("wheel_spin", null), "/panel/hediye-carki/kazananlar");
    assert.deepEqual(actionInfo("wheel_round"), { label: "Yeni çark turu başlattı", tone: "warning" });
    assert.equal(actionInfo("export").label, "Dışa aktardı");
  });

  test("the wheel's settings fields read in Turkish in the diff", () => {
    for (const [key, label] of [
      ["slices", "Dilimler"],
      ["weight", "Şans ağırlığı"],
      ["validityHours", "Kod geçerlilik süresi (saat)"],
      ["round", "Tur"],
      ["texts", "Metinler"],
      ["reminderEnabled", "Hatırlatma e-postası"],
      ["enabled", "Açık"],
    ] as const) {
      assert.equal(fieldLabel(key), label);
    }
  });
});
