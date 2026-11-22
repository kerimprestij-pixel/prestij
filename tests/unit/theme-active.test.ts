// Storefront theme choice (scheduled + campaign-linked themes), cache lifetimes and panel statuses.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  campaignWindowContains,
  nextThemeChange,
  pickActiveTheme,
  themeCacheProfile,
  themeStatuses,
  themeWindowContains,
  type CampaignThemeLink,
  type ThemeCandidate,
} from "@/lib/theme/active-theme";

const d = (iso: string) => new Date(iso);
const NOW = d("2026-11-09T12:00:00.000Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function theme(id: number, over: Partial<ThemeCandidate> = {}): ThemeCandidate {
  return { id, isDefault: false, isScheduled: false, startsAt: null, endsAt: null, priority: 0, ...over };
}
function link(campaignId: number, themeId: number, over: Partial<CampaignThemeLink> = {}): CampaignThemeLink {
  return { campaignId, themeId, isActive: true, startsAt: null, endsAt: null, ...over };
}

const DEFAULT = theme(1, { isDefault: true });

describe("windows", () => {
  test("theme windows need a start, the end is exclusive and may be open", () => {
    const t = theme(2, { isScheduled: true, startsAt: d("2026-11-09T12:00:00Z"), endsAt: d("2026-11-10T00:00:00Z") });
    assert.equal(themeWindowContains(t, NOW), true, "start is inclusive");
    assert.equal(themeWindowContains(t, d("2026-11-10T00:00:00Z")), false, "end is exclusive");
    assert.equal(themeWindowContains({ ...t, endsAt: null }, d("2030-01-01T00:00:00Z")), true, "open end");
    assert.equal(themeWindowContains({ ...t, startsAt: null }, NOW), false, "no start → never");
    assert.equal(themeWindowContains({ ...t, isScheduled: false }, NOW), false, "not scheduled → never");
  });

  test("campaign windows are unbounded where empty (like the cart engine)", () => {
    assert.equal(campaignWindowContains({ startsAt: null, endsAt: null }, NOW), true);
    assert.equal(campaignWindowContains({ startsAt: d("2026-11-10T00:00:00Z"), endsAt: null }, NOW), false);
    assert.equal(campaignWindowContains({ startsAt: null, endsAt: NOW }, NOW), false);
  });
});

describe("pickActiveTheme", () => {
  test("only the default → default, no upcoming change", () => {
    const choice = pickActiveTheme([DEFAULT, theme(2)], [], NOW);
    assert.equal(choice.theme?.id, 1);
    assert.equal(choice.reason, "default");
    assert.equal(choice.nextChangeAt, null);
  });

  test("nothing at all → null", () => {
    const choice = pickActiveTheme([theme(2)], [], NOW);
    assert.equal(choice.theme, null);
    assert.equal(choice.reason, null);
  });

  test("a scheduled theme in its window beats the default; before it starts the default shows", () => {
    const xmas = theme(2, { isScheduled: true, startsAt: d("2026-12-14T21:00:00Z"), endsAt: d("2027-01-02T20:59:59Z"), priority: 20 });
    const before = pickActiveTheme([DEFAULT, xmas], [], NOW);
    assert.equal(before.theme?.id, 1);
    assert.deepEqual(before.nextChangeAt, xmas.startsAt);
    const during = pickActiveTheme([DEFAULT, xmas], [], d("2026-12-20T10:00:00Z"));
    assert.equal(during.theme?.id, 2);
    assert.equal(during.reason, "scheduled");
    assert.deepEqual(during.nextChangeAt, xmas.endsAt);
    assert.equal(pickActiveTheme([DEFAULT, xmas], [], d("2027-01-03T00:00:00Z")).theme?.id, 1);
  });

  test("a theme linked to a running campaign wins; inactive, ended or future campaigns do not", () => {
    const t = theme(3, { priority: 5 });
    assert.equal(pickActiveTheme([DEFAULT, t], [link(10, 3)], NOW).theme?.id, 3);
    const viaCampaign = pickActiveTheme([DEFAULT, t], [link(10, 3)], NOW);
    assert.equal(viaCampaign.reason, "campaign");
    assert.equal(viaCampaign.campaignId, 10);
    assert.equal(pickActiveTheme([DEFAULT, t], [link(10, 3, { isActive: false })], NOW).theme?.id, 1);
    assert.equal(pickActiveTheme([DEFAULT, t], [link(10, 3, { endsAt: d("2026-11-01T00:00:00Z") })], NOW).theme?.id, 1);
    const future = pickActiveTheme([DEFAULT, t], [link(10, 3, { startsAt: d("2026-11-20T00:00:00Z") })], NOW);
    assert.equal(future.theme?.id, 1);
    assert.deepEqual(future.nextChangeAt, d("2026-11-20T00:00:00Z"));
  });

  test("a campaign theme does not need to be scheduled itself, and links to unknown themes are ignored", () => {
    const choice = pickActiveTheme([DEFAULT], [link(10, 99, { startsAt: d("2026-11-20T00:00:00Z") })], NOW);
    assert.equal(choice.theme?.id, 1);
    assert.equal(choice.nextChangeAt, null);
  });

  test("highest priority wins; ties go to the latest start, then the lowest id", () => {
    const a = theme(2, { isScheduled: true, startsAt: d("2026-11-01T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 10 });
    const b = theme(3, { isScheduled: true, startsAt: d("2026-11-05T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 10 });
    const c = theme(4, { isScheduled: true, startsAt: d("2026-10-01T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 30 });
    assert.equal(pickActiveTheme([DEFAULT, a, b], [], NOW).theme?.id, 3, "same priority → later start");
    assert.equal(pickActiveTheme([DEFAULT, a, b, c], [], NOW).theme?.id, 4, "priority beats start");
    const twin = theme(5, { ...b, id: 5 });
    assert.equal(pickActiveTheme([DEFAULT, twin, b], [], NOW).theme?.id, 3, "full tie → lowest id");
  });

  test("a campaign that starts later than a scheduled theme wins the tie", () => {
    const scheduled = theme(2, { isScheduled: true, startsAt: d("2026-11-01T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 10 });
    const campaignTheme = theme(3, { priority: 10 });
    const choice = pickActiveTheme([DEFAULT, scheduled, campaignTheme], [link(7, 3, { startsAt: d("2026-11-08T00:00:00Z") })], NOW);
    assert.equal(choice.theme?.id, 3);
    // A campaign without a start counts as the oldest start.
    const openCampaign = pickActiveTheme([DEFAULT, scheduled, campaignTheme], [link(7, 3)], NOW);
    assert.equal(openCampaign.theme?.id, 2);
  });

  test("the latest active reason decides the start of a theme that is both scheduled and campaign-linked", () => {
    const both = theme(2, { isScheduled: true, startsAt: d("2026-11-01T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 10 });
    const other = theme(3, { isScheduled: true, startsAt: d("2026-11-05T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 10 });
    const choice = pickActiveTheme([DEFAULT, both, other], [link(9, 2, { startsAt: d("2026-11-08T00:00:00Z") })], NOW);
    assert.equal(choice.theme?.id, 2);
    assert.equal(choice.reason, "campaign");
  });

  test("seeded themes: Klasik in November, Yılbaşı at Christmas, Ramazan and Yaz in their windows", () => {
    const seeded: ThemeCandidate[] = [
      DEFAULT,
      theme(2, { isScheduled: true, startsAt: d("2026-12-14T21:00:00Z"), endsAt: d("2027-01-02T20:59:59Z"), priority: 20 }),
      theme(3, { isScheduled: true, startsAt: d("2027-02-06T21:00:00Z"), endsAt: d("2027-03-09T20:59:59Z"), priority: 20 }),
      theme(4, { isScheduled: true, startsAt: d("2027-05-31T21:00:00Z"), endsAt: d("2027-08-31T20:59:59Z"), priority: 10 }),
    ];
    assert.equal(pickActiveTheme(seeded, [], NOW).theme?.id, 1);
    assert.equal(pickActiveTheme(seeded, [], d("2026-12-31T12:00:00Z")).theme?.id, 2);
    assert.equal(pickActiveTheme(seeded, [], d("2027-03-01T12:00:00Z")).theme?.id, 3);
    assert.equal(pickActiveTheme(seeded, [], d("2027-07-01T12:00:00Z")).theme?.id, 4);
  });
});

describe("nextThemeChange", () => {
  test("earliest future start or end among scheduled themes and active links", () => {
    const themes = [
      DEFAULT,
      theme(2, { isScheduled: true, startsAt: d("2026-11-01T00:00:00Z"), endsAt: d("2026-11-30T00:00:00Z") }),
      theme(3, { isScheduled: false, startsAt: d("2026-11-10T00:00:00Z") }),
    ];
    assert.deepEqual(nextThemeChange(themes, [], NOW), d("2026-11-30T00:00:00Z"));
    assert.deepEqual(nextThemeChange(themes, [link(1, 3, { endsAt: d("2026-11-15T00:00:00Z") })], NOW), d("2026-11-15T00:00:00Z"));
    assert.deepEqual(nextThemeChange(themes, [link(1, 3, { isActive: false, endsAt: d("2026-11-15T00:00:00Z") })], NOW), d("2026-11-30T00:00:00Z"));
  });
});

describe("themeCacheProfile", () => {
  test("the longest preset that revalidates before the next change", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    assert.equal(themeCacheProfile(null, NOW), "max");
    assert.equal(themeCacheProfile(at(40 * DAY), NOW), "max");
    assert.equal(themeCacheProfile(at(30 * DAY), NOW), "weeks");
    assert.equal(themeCacheProfile(at(10 * DAY), NOW), "weeks");
    assert.equal(themeCacheProfile(at(2 * DAY), NOW), "days");
    assert.equal(themeCacheProfile(at(3 * HOUR), NOW), "hours");
    assert.equal(themeCacheProfile(at(HOUR), NOW), "minutes");
    assert.equal(themeCacheProfile(at(5 * 60_000), NOW), "minutes");
    assert.equal(themeCacheProfile(at(-60_000), NOW), "minutes");
  });
});

describe("themeStatuses", () => {
  test("live, waiting, upcoming, standby, ended and idle", () => {
    const live = theme(2, { isScheduled: true, startsAt: d("2026-11-01T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 20 });
    const waiting = theme(3, { isScheduled: true, startsAt: d("2026-11-02T00:00:00Z"), endsAt: d("2026-12-01T00:00:00Z"), priority: 5 });
    const upcoming = theme(4, { isScheduled: true, startsAt: d("2026-12-14T21:00:00Z"), endsAt: d("2027-01-02T00:00:00Z") });
    const ended = theme(5, { isScheduled: true, startsAt: d("2026-01-01T00:00:00Z"), endsAt: d("2026-02-01T00:00:00Z") });
    const idle = theme(6);
    const viaCampaign = theme(7);
    const statuses = themeStatuses([DEFAULT, live, waiting, upcoming, ended, idle, viaCampaign], [link(1, 7, { startsAt: d("2026-11-20T00:00:00Z") })], NOW);
    assert.deepEqual(statuses.get(2), { kind: "live", reason: "scheduled", campaignId: null });
    assert.deepEqual(statuses.get(3), { kind: "waiting" });
    assert.deepEqual(statuses.get(4), { kind: "upcoming", startsAt: d("2026-12-14T21:00:00Z") });
    assert.deepEqual(statuses.get(1), { kind: "standby" });
    assert.deepEqual(statuses.get(5), { kind: "ended" });
    assert.deepEqual(statuses.get(6), { kind: "idle" });
    assert.deepEqual(statuses.get(7), { kind: "upcoming", startsAt: d("2026-11-20T00:00:00Z") });
  });

  test("the default theme is live when nothing else runs", () => {
    const statuses = themeStatuses([DEFAULT, theme(2)], [], NOW);
    assert.deepEqual(statuses.get(1), { kind: "live", reason: "default", campaignId: null });
  });
});
