import { cacheLife, cacheTag } from "next/cache";
import { TAGS } from "@/lib/cache-tags";
import { themeCacheProfile, type ThemeCacheProfile } from "./active-theme";
import { DEFAULT_THEME_NAME, DEFAULT_THEME_SLUG, DEFAULT_THEME_TOKENS } from "./defaults";
import { buildThemeCss } from "./engine";
import { queryActiveThemeState, type ActiveTheme } from "./query-active-theme";

export type { ActiveTheme };

type CachedThemeState = { theme: ActiveTheme; nextChangeAt: number | null };

/**
 * cacheLife() is typed per preset name, so the computed profile is applied through this switch. Call it
 * exactly once inside each "use cache" scope below.
 */
function themeCacheLife(profile: ThemeCacheProfile): void {
  switch (profile) {
    case "max":
      return cacheLife("max");
    case "weeks":
      return cacheLife("weeks");
    case "days":
      return cacheLife("days");
    case "hours":
      return cacheLife("hours");
    default:
      return cacheLife("minutes");
  }
}

const FALLBACK: ActiveTheme = { slug: DEFAULT_THEME_SLUG, name: DEFAULT_THEME_NAME, tokens: DEFAULT_THEME_TOKENS };

/**
 * The theme plus the next scheduled change, cached once. Tags: theme (panel theme saves) and campaigns
 * (campaign-linked themes). The lifetime is the longest preset that still revalidates before the next
 * scheduled or campaign window starts or ends, so seasonal themes switch on time without a write.
 */
async function loadActiveTheme(): Promise<CachedThemeState> {
  "use cache";
  cacheTag(TAGS.theme, TAGS.campaigns);
  const now = new Date();
  try {
    const state = await queryActiveThemeState(now);
    themeCacheLife(themeCacheProfile(state.nextChangeAt, now));
    return { theme: state.theme ?? FALLBACK, nextChangeAt: state.nextChangeAt?.getTime() ?? null };
  } catch (error) {
    console.error("[theme] could not load themes, using the built-in default:", error);
    cacheLife("minutes");
    return { theme: FALLBACK, nextChangeAt: null };
  }
}

/**
 * The theme the storefront should show right now. Panel writes call updateTag(TAGS.theme) (and
 * campaign writes TAGS.campaigns); scheduled and campaign themes switch by cache lifetime.
 */
export async function getActiveTheme(): Promise<ActiveTheme> {
  "use cache";
  cacheTag(TAGS.theme, TAGS.campaigns);
  const { theme, nextChangeAt } = await loadActiveTheme();
  themeCacheLife(themeCacheProfile(nextChangeAt === null ? null : new Date(nextChangeAt), new Date()));
  return theme;
}

/** Generated CSS for the active theme (cached separately so the color math runs once per lifetime). */
export async function getActiveThemeCss(): Promise<{ slug: string; css: string }> {
  "use cache";
  cacheTag(TAGS.theme, TAGS.campaigns);
  const { theme, nextChangeAt } = await loadActiveTheme();
  themeCacheLife(themeCacheProfile(nextChangeAt === null ? null : new Date(nextChangeAt), new Date()));
  return { slug: theme.slug, css: buildThemeCss(theme.tokens) };
}
