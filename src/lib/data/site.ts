// Cached reads for the storefront shell: menus, announcements and single media rows (logo, OG image).
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { MenuItem } from "@/db/schema/site";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { localizePath } from "@/i18n/paths";
import { TAGS } from "@/lib/cache-tags";
import { campaignCacheProfile, type CampaignCacheProfile } from "@/lib/campaigns/pick";
import { imageOnly } from "@/lib/data/media";
import type { MediaLike } from "@/lib/media/types";
import { isSafeHref } from "@/lib/safe-href";

export const MENU_KEYS = ["header", "footer_shop", "footer_corporate", "footer_legal"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];
export type Menus = Record<MenuKey, MenuItem[]>;

/** All storefront menus keyed by menu key (unknown keys in the DB are ignored, missing ones are []). */
export async function getMenus(): Promise<Menus> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.menus);

  const rows = await db.select({ key: schema.menus.key, items: schema.menus.items }).from(schema.menus);
  const menus = Object.fromEntries(MENU_KEYS.map((key) => [key, [] as MenuItem[]])) as Menus;
  for (const row of rows) {
    if ((MENU_KEYS as readonly string[]).includes(row.key) && Array.isArray(row.items)) {
      menus[row.key as MenuKey] = row.items;
    }
  }
  return menus;
}

/** A menu item resolved for one locale: plain label, public href, external flag. */
export type NavItem = {
  label: string;
  href: string;
  external: boolean;
  highlight: boolean;
  children: NavItem[];
};

/** Localizes labels and turns canonical Turkish paths ("/urunler") into public paths for `locale`. */
export function localizeMenu(items: readonly MenuItem[], locale: Locale): NavItem[] {
  return items
    .map((item) => {
      const raw = typeof item.href === "string" ? item.href.trim() : "";
      // Render-time second check of the link rule (the panel validates on save): unsafe → home page.
      const href = raw && isSafeHref(raw) ? raw : "";
      return {
        label: localize(item.label, locale),
        href: localizePath(locale, href || "/"),
        external: /^(https?:)?\/\//i.test(href),
        highlight: Boolean(item.highlight),
        children: localizeMenu(item.children ?? [], locale),
      };
    })
    .filter((item) => item.label !== "");
}

export type AnnouncementVariant = "brand" | "accent" | "neutral";

export type ActiveAnnouncement = {
  id: number;
  text: LocalizedText;
  href: string | null;
  variant: AnnouncementVariant;
  /** Epoch ms of the last edit; used to re-show a bar after the visitor dismissed an older version. */
  updatedAt: number;
};

/**
 * Announcements that are switched on and inside their schedule window right now, in display order.
 * The bar is in the root layout, so this lifetime sets every storefront page's: it follows the
 * schedule like campaigns do ("minutes" while a start or end is under an hour away, longer further
 * out, "max" when nothing is scheduled). Panel saves expire the tag immediately.
 */
export async function getActiveAnnouncements(): Promise<ActiveAnnouncement[]> {
  "use cache";
  cacheTag(TAGS.announcements);

  const a = schema.announcements;
  const all = await db
    .select({ id: a.id, text: a.text, href: a.href, variant: a.variant, updatedAt: a.updatedAt, startsAt: a.startsAt, endsAt: a.endsAt })
    .from(a)
    .where(eq(a.isActive, true))
    .orderBy(asc(a.position), asc(a.id));
  const now = Date.now();
  applyScheduleCacheLife(campaignCacheProfile(all, now));
  const rows = all.filter((r) => (!r.startsAt || r.startsAt.getTime() <= now) && (!r.endsAt || r.endsAt.getTime() > now));

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    href: row.href?.trim() || null,
    variant: row.variant === "accent" || row.variant === "neutral" ? row.variant : "brand",
    updatedAt: row.updatedAt.getTime(),
  }));
}

/** cacheLife's overloads take one literal profile name each. */
function applyScheduleCacheLife(profile: CampaignCacheProfile): void {
  switch (profile) {
    case "minutes":
      return cacheLife("minutes");
    case "hours":
      return cacheLife("hours");
    case "days":
      return cacheLife("days");
    case "weeks":
      return cacheLife("weeks");
    case "max":
      return cacheLife("max");
  }
}

/** One image row as MediaLike (null when the id is empty, missing or a video: logos and share images are images). */
export async function getMediaById(id: number | null | undefined): Promise<MediaLike | null> {
  if (!id || !Number.isInteger(id) || id <= 0) return null;
  return loadMedia(id);
}

async function loadMedia(id: number): Promise<MediaLike | null> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.media);

  const m = schema.media;
  const [row] = await db
    .select({
      id: m.id,
      url: m.url,
      width: m.width,
      height: m.height,
      alt: m.alt,
      blurDataUrl: m.blurDataUrl,
      dominantColor: m.dominantColor,
      variants: m.variants,
    })
    .from(m)
    .where(and(eq(m.id, id), imageOnly()))
    .limit(1);
  return row ?? null;
}
