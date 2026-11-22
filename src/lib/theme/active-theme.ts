// Which theme the storefront shows at a given instant. Pure (no DB, no Next): unit-tested in
// tests/unit/theme-active.test.ts and shared by getActiveTheme (storefront) and the panel theme list.
//
// Candidates are scheduled themes whose window contains `now` plus themes linked to a running campaign
// (campaign.isActive and its window contains `now`). The highest theme priority wins; ties go to the
// latest start, then to the lowest id. Without a candidate the default theme is shown.

export type ThemeCandidate = {
  id: number;
  isDefault: boolean;
  isScheduled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
};

export type CampaignThemeLink = {
  campaignId: number;
  themeId: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type ActiveThemeReason = "scheduled" | "campaign" | "default";

export type ActiveThemeChoice<T extends ThemeCandidate> = {
  /** The winner, or null when there is neither a running candidate nor a default theme. */
  theme: T | null;
  reason: ActiveThemeReason | null;
  /** The campaign that switched the theme on (reason "campaign"), otherwise null. */
  campaignId: number | null;
  /** The next instant at which the choice can change on its own (a window starts or ends), or null. */
  nextChangeAt: Date | null;
};

const ms = (date: Date | null | undefined): number | null => {
  if (!date) return null;
  const t = date.getTime();
  return Number.isNaN(t) ? null : t;
};

/** Campaign windows: an empty start/end is unbounded (same rule as the cart engine). */
export function campaignWindowContains(link: Pick<CampaignThemeLink, "startsAt" | "endsAt">, now: Date): boolean {
  const start = ms(link.startsAt);
  const end = ms(link.endsAt);
  const t = now.getTime();
  return (start === null || start <= t) && (end === null || t < end);
}

/**
 * Scheduled theme windows: a start is required (a scheduled theme without one never switches on); an
 * empty end means "until switched off". The panel always stores both.
 */
export function themeWindowContains(theme: Pick<ThemeCandidate, "isScheduled" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!theme.isScheduled) return false;
  const start = ms(theme.startsAt);
  const end = ms(theme.endsAt);
  const t = now.getTime();
  return start !== null && start <= t && (end === null || t < end);
}

type Running<T> = { theme: T; start: number; reason: "scheduled" | "campaign"; campaignId: number | null };

/** Every running candidate with the start of the window that made it run (latest one wins ties). */
function runningCandidates<T extends ThemeCandidate>(themes: readonly T[], links: readonly CampaignThemeLink[], now: Date): Running<T>[] {
  const byId = new Map(themes.map((theme) => [theme.id, theme]));
  const running = new Map<number, Running<T>>();
  const offer = (entry: Running<T>) => {
    const current = running.get(entry.theme.id);
    if (!current || entry.start > current.start) running.set(entry.theme.id, entry);
  };
  for (const theme of themes) {
    if (themeWindowContains(theme, now)) {
      offer({ theme, start: ms(theme.startsAt) ?? Number.NEGATIVE_INFINITY, reason: "scheduled", campaignId: null });
    }
  }
  for (const link of links) {
    const theme = byId.get(link.themeId);
    if (!theme || !link.isActive || !campaignWindowContains(link, now)) continue;
    offer({ theme, start: ms(link.startsAt) ?? Number.NEGATIVE_INFINITY, reason: "campaign", campaignId: link.campaignId });
  }
  return [...running.values()].sort(
    (a, b) => b.theme.priority - a.theme.priority || b.start - a.start || a.theme.id - b.theme.id,
  );
}

/** The next future start or end among scheduled themes and active campaign links to known themes. */
export function nextThemeChange(themes: readonly ThemeCandidate[], links: readonly CampaignThemeLink[], now: Date): Date | null {
  const t = now.getTime();
  const ids = new Set(themes.map((theme) => theme.id));
  let next: number | null = null;
  const consider = (value: number | null) => {
    if (value !== null && value > t && (next === null || value < next)) next = value;
  };
  for (const theme of themes) {
    if (!theme.isScheduled || ms(theme.startsAt) === null) continue;
    consider(ms(theme.startsAt));
    consider(ms(theme.endsAt));
  }
  for (const link of links) {
    if (!link.isActive || !ids.has(link.themeId)) continue;
    consider(ms(link.startsAt));
    consider(ms(link.endsAt));
  }
  return next === null ? null : new Date(next);
}

/** The theme to show at `now` (see the file comment for the rules). */
export function pickActiveTheme<T extends ThemeCandidate>(
  themes: readonly T[],
  links: readonly CampaignThemeLink[],
  now: Date,
): ActiveThemeChoice<T> {
  const nextChangeAt = nextThemeChange(themes, links, now);
  const [winner] = runningCandidates(themes, links, now);
  if (winner) return { theme: winner.theme, reason: winner.reason, campaignId: winner.campaignId, nextChangeAt };
  const fallback = [...themes].filter((theme) => theme.isDefault).sort((a, b) => a.id - b.id)[0] ?? null;
  return { theme: fallback, reason: fallback ? "default" : null, campaignId: null, nextChangeAt };
}

/** Preset cacheLife profiles with their server revalidate period in seconds (Next 16 defaults). */
const PROFILES = [
  ["max", 30 * 24 * 3600],
  ["weeks", 7 * 24 * 3600],
  ["days", 24 * 3600],
  ["hours", 3600],
] as const;

export type ThemeCacheProfile = "max" | "weeks" | "days" | "hours" | "minutes";

/**
 * The longest cacheLife preset that still revalidates before the next scheduled change, so a seasonal
 * or campaign theme switches on (and off) within about a minute without any write. No upcoming change
 * → "max" (panel saves expire the tags anyway).
 */
export function themeCacheProfile(nextChangeAt: Date | null, now: Date): ThemeCacheProfile {
  const next = ms(nextChangeAt);
  if (next === null) return "max";
  const seconds = (next - now.getTime()) / 1000;
  for (const [profile, revalidate] of PROFILES) if (seconds > revalidate) return profile;
  return "minutes";
}

// ---------------------------------------------------------------------------------------------------
// Panel status per theme

export type ThemeStatus =
  /** The storefront shows this theme right now. */
  | { kind: "live"; reason: ActiveThemeReason; campaignId: number | null }
  /** Inside a window, but a theme with a higher priority (or a later start) wins. */
  | { kind: "waiting" }
  /** A window (own schedule or a linked campaign) starts in the future. */
  | { kind: "upcoming"; startsAt: Date }
  /** The default theme while another one is shown; it returns when that one ends. */
  | { kind: "standby" }
  /** Every window is in the past. */
  | { kind: "ended" }
  /** Not scheduled, not linked to a campaign and not the default. */
  | { kind: "idle" };

/** Status of every theme at `now`, keyed by id (one pass for the whole list). */
export function themeStatuses<T extends ThemeCandidate>(
  themes: readonly T[],
  links: readonly CampaignThemeLink[],
  now: Date,
): Map<number, ThemeStatus> {
  const choice = pickActiveTheme(themes, links, now);
  const runningIds = new Set(runningCandidates(themes, links, now).map((r) => r.theme.id));
  const t = now.getTime();
  const out = new Map<number, ThemeStatus>();
  for (const theme of themes) {
    if (choice.theme?.id === theme.id && choice.reason) {
      out.set(theme.id, { kind: "live", reason: choice.reason, campaignId: choice.campaignId });
      continue;
    }
    if (runningIds.has(theme.id)) {
      out.set(theme.id, { kind: "waiting" });
      continue;
    }
    const starts: number[] = [];
    let hadWindow = false;
    if (theme.isScheduled && ms(theme.startsAt) !== null) {
      hadWindow = true;
      const start = ms(theme.startsAt)!;
      if (start > t) starts.push(start);
    }
    for (const link of links) {
      if (link.themeId !== theme.id || !link.isActive) continue;
      hadWindow = true;
      const start = ms(link.startsAt);
      if (start !== null && start > t) starts.push(start);
    }
    if (starts.length > 0) out.set(theme.id, { kind: "upcoming", startsAt: new Date(Math.min(...starts)) });
    else if (theme.isDefault) out.set(theme.id, { kind: "standby" });
    else if (hadWindow) out.set(theme.id, { kind: "ended" });
    else out.set(theme.id, { kind: "idle" });
  }
  return out;
}
