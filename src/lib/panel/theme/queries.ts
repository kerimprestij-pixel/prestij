// Read side of the panel theme screens (uncached; pages call requireStaff("editor") first).
import "server-only";
import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ThemeTokens } from "@/db/schema";
import { themeStatuses, type ActiveThemeReason, type CampaignThemeLink, type ThemeStatus } from "@/lib/theme/active-theme";
import { resolveThemeTokens, themeVars } from "@/lib/theme/engine";
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, THEME_COLOR_KEYS, THEME_FONT_OPTIONS, type ThemeColorKey, type ThemeFont, type ThemeRadius } from "./schemas";

/** ThemeStatus with ISO strings (client-safe). */
export type PanelThemeStatus =
  | { kind: "live"; reason: ActiveThemeReason; campaignId: number | null }
  | { kind: "waiting" }
  | { kind: "upcoming"; startsAt: string }
  | { kind: "standby" }
  | { kind: "ended" }
  | { kind: "idle" };

export type PanelThemeCampaign = { id: number; name: string; isActive: boolean; startsAt: string | null; endsAt: string | null };

export type ThemeSwatches = {
  light: { brand: string; accent: string; background: string; surface: string; text: string };
  dark: { brand: string; accent: string; background: string; surface: string; text: string };
};

export type PanelThemeCard = {
  id: number;
  name: string;
  isDefault: boolean;
  isScheduled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  status: PanelThemeStatus;
  swatches: ThemeSwatches;
  radius: ThemeRadius;
  campaigns: PanelThemeCampaign[];
  updatedAt: string;
};

/** Editor state (client): Dates as ISO strings, empty dark colors = automatic. */
export type ThemeEditorState = {
  id: number;
  name: string;
  colors: Record<ThemeColorKey, string>;
  dark: Record<ThemeColorKey, string>;
  radius: ThemeRadius;
  fonts: { heading: ThemeFont; body: ThemeFont };
  isScheduled: boolean;
  schedule: { startsAt: string | null; endsAt: string | null };
  priority: number;
  updatedAt: string;
};

export type PanelThemeDetail = {
  state: ThemeEditorState;
  isDefault: boolean;
  status: PanelThemeStatus;
  campaigns: PanelThemeCampaign[];
  /** The theme the storefront shows now (for the "Şu an sitede" hint). */
  live: { id: number; name: string } | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function serializeStatus(status: ThemeStatus | undefined): PanelThemeStatus {
  if (!status) return { kind: "idle" };
  return status.kind === "upcoming" ? { kind: "upcoming", startsAt: status.startsAt.toISOString() } : status;
}

function swatchesOf(tokens: unknown): ThemeSwatches {
  const { light, dark } = themeVars(tokens);
  const d = { ...light, ...dark };
  return {
    light: { brand: light["--brand"], accent: light["--gold"], background: light["--bg"], surface: light["--surface"], text: light["--text"] },
    dark: { brand: d["--brand"], accent: d["--gold"], background: d["--bg"], surface: d["--surface"], text: d["--text"] },
  };
}

const isFont = (v: unknown): v is ThemeFont => THEME_FONT_OPTIONS.some((o) => o.value === v);

/** Stored tokens → editor colors (light colors resolved to valid hex; dark left empty when automatic). */
export function editorTokens(raw: ThemeTokens | unknown): Pick<ThemeEditorState, "colors" | "dark" | "radius" | "fonts"> {
  const tokens = resolveThemeTokens(raw);
  const upper = (hex: string | undefined) => (hex ? hex.toUpperCase() : "");
  const colors = {} as Record<ThemeColorKey, string>;
  const dark = {} as Record<ThemeColorKey, string>;
  for (const key of THEME_COLOR_KEYS) {
    colors[key] = upper(tokens.colors[key]);
    dark[key] = upper(tokens.dark?.[key]);
  }
  return {
    colors,
    dark,
    radius: (tokens.radius ?? "md") as ThemeRadius,
    fonts: {
      heading: isFont(tokens.fonts?.heading?.toLowerCase()) ? (tokens.fonts!.heading!.toLowerCase() as ThemeFont) : DEFAULT_HEADING_FONT,
      body: isFont(tokens.fonts?.body?.toLowerCase()) ? (tokens.fonts!.body!.toLowerCase() as ThemeFont) : DEFAULT_BODY_FONT,
    },
  };
}

async function loadAll() {
  const t = schema.themes;
  const c = schema.campaigns;
  const [themes, campaigns] = await Promise.all([
    db.select().from(t).orderBy(desc(t.isDefault), desc(t.isScheduled), asc(t.startsAt), asc(t.name)),
    db
      .select({ id: c.id, name: c.name, themeId: c.themeId, isActive: c.isActive, startsAt: c.startsAt, endsAt: c.endsAt })
      .from(c)
      .where(isNotNull(c.themeId))
      .orderBy(asc(c.startsAt), asc(c.id)),
  ]);
  const links: CampaignThemeLink[] = campaigns.map((x) => ({
    campaignId: x.id,
    themeId: x.themeId!,
    isActive: x.isActive,
    startsAt: x.startsAt,
    endsAt: x.endsAt,
  }));
  const statuses = themeStatuses(themes, links, new Date());
  const campaignsOf = (themeId: number): PanelThemeCampaign[] =>
    campaigns
      .filter((x) => x.themeId === themeId)
      .map((x) => ({ id: x.id, name: x.name, isActive: x.isActive, startsAt: iso(x.startsAt), endsAt: iso(x.endsAt) }));
  return { themes, statuses, campaignsOf };
}

export async function listPanelThemes(): Promise<PanelThemeCard[]> {
  const { themes, statuses, campaignsOf } = await loadAll();
  return themes.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    isScheduled: row.isScheduled,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    priority: row.priority,
    status: serializeStatus(statuses.get(row.id)),
    swatches: swatchesOf(row.tokens),
    radius: (resolveThemeTokens(row.tokens).radius ?? "md") as ThemeRadius,
    campaigns: campaignsOf(row.id),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getPanelTheme(id: number): Promise<PanelThemeDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await db.select({ id: schema.themes.id }).from(schema.themes).where(eq(schema.themes.id, id));
  if (!row) return null;
  const { themes, statuses, campaignsOf } = await loadAll();
  const theme = themes.find((t) => t.id === id);
  if (!theme) return null;
  const liveRow = themes.find((t) => statuses.get(t.id)?.kind === "live");
  return {
    state: {
      id: theme.id,
      name: theme.name,
      ...editorTokens(theme.tokens),
      isScheduled: theme.isScheduled,
      schedule: { startsAt: iso(theme.startsAt), endsAt: iso(theme.endsAt) },
      priority: theme.priority,
      updatedAt: theme.updatedAt.toISOString(),
    },
    isDefault: theme.isDefault,
    status: serializeStatus(statuses.get(theme.id)),
    campaigns: campaignsOf(theme.id),
    live: liveRow ? { id: liveRow.id, name: liveRow.name } : null,
  };
}
