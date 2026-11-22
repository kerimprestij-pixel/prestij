import { and, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ThemeTokens } from "@/db/schema";
import { pickActiveTheme, type ActiveThemeReason, type CampaignThemeLink } from "./active-theme";
import { resolveThemeTokens } from "./engine";

export type ActiveTheme = { slug: string; name: string; tokens: ThemeTokens };

export type ActiveThemeState = {
  /** Null when the database has neither a running candidate nor a default theme. */
  theme: ActiveTheme | null;
  reason: ActiveThemeReason | null;
  /** Next instant at which a scheduled or campaign-linked theme starts or ends (drives cacheLife). */
  nextChangeAt: Date | null;
};

type Client = Pick<typeof db, "select">;

/**
 * Uncached lookup of the storefront theme at `now` (rules in active-theme.ts): the default theme,
 * scheduled themes that have not ended, and themes linked to an active campaign that has not ended
 * are loaded, then pickActiveTheme chooses. `client` may be a transaction (tests).
 */
export async function queryActiveThemeState(now: Date, client: Client = db): Promise<ActiveThemeState> {
  const t = schema.themes;
  const c = schema.campaigns;

  const [themes, links] = await Promise.all([
    client
      .select({
        id: t.id,
        slug: t.slug,
        name: t.name,
        tokens: t.tokens,
        isDefault: t.isDefault,
        isScheduled: t.isScheduled,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        priority: t.priority,
      })
      .from(t)
      .where(
        or(
          eq(t.isDefault, true),
          and(eq(t.isScheduled, true), isNotNull(t.startsAt), or(isNull(t.endsAt), gt(t.endsAt, now))),
          // Linked to a campaign that may still run (the window check happens in pickActiveTheme).
          inArray(
            t.id,
            client
              .select({ id: c.themeId })
              .from(c)
              .where(and(isNotNull(c.themeId), eq(c.isActive, true), or(isNull(c.endsAt), gt(c.endsAt, now)))),
          ),
        ),
      ),
    client
      .select({ campaignId: c.id, themeId: c.themeId, isActive: c.isActive, startsAt: c.startsAt, endsAt: c.endsAt })
      .from(c)
      .where(and(isNotNull(c.themeId), eq(c.isActive, true), or(isNull(c.endsAt), gt(c.endsAt, now)))),
  ]);

  const choice = pickActiveTheme(
    themes,
    links.filter((link): link is CampaignThemeLink => link.themeId !== null),
    now,
  );
  const theme = choice.theme
    ? { slug: choice.theme.slug, name: choice.theme.name, tokens: resolveThemeTokens(choice.theme.tokens) }
    : null;
  return { theme, reason: choice.reason, nextChangeAt: choice.nextChangeAt };
}

/** The theme at `now`, or null when neither a running candidate nor a default theme exists. */
export async function queryActiveTheme(now: Date, client: Client = db): Promise<ActiveTheme | null> {
  return (await queryActiveThemeState(now, client)).theme;
}
