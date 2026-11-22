// Visitor light/dark preference. Shared by the inline <ThemeScript/> and the <ThemeToggle/> client component.

export const THEME_STORAGE_KEY = "prestij-theme";
/** Dispatched on window after a toggle so every mounted toggle re-reads the mode. */
export const THEME_CHANGE_EVENT = "prestij-theme-change";
export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

/** Used when localStorage is blocked, so the toggle still reflects the current page view. */
let memoryMode: ThemeMode = "system";

/** Browser only. Missing or invalid values mean "system". */
export function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    return memoryMode;
  }
}

/** light → dark → system → light */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];
}

/** Browser only. Toggles `dark` on <html> for the given preference. */
export function applyThemeMode(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Browser only. Persists, applies immediately and notifies other toggles on the page. */
export function setThemeMode(mode: ThemeMode): void {
  memoryMode = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage blocked (private mode): the choice still applies for this page view.
  }
  applyThemeMode(mode);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
