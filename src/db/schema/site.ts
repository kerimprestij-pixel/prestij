// Site-wide settings, themes, media library, pages + sections (page builder), menus,
// announcements, editable UI texts and the admin audit log.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { MediaKind } from "../../lib/media/types";
import { id, schedule, timestamps, type LocalizedText, type SeoFields } from "./common";

/** Key/value settings. Each key holds one JSON document edited from the panel (see src/lib/settings/types.ts). */
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

/**
 * Design tokens for a theme. Colors are hex strings; the theme engine derives full OKLCH palettes,
 * hover/active shades and contrast-safe text colors from these seeds.
 */
export type ThemeTokens = {
  colors: {
    brand: string; // logo navy
    accent: string; // logo gold
    background?: string;
    surface?: string;
    text?: string;
  };
  dark?: Partial<ThemeTokens["colors"]>;
  radius?: "none" | "sm" | "md" | "lg" | "full";
  fonts?: { heading?: string; body?: string };
  /** Optional decorative extras for seasonal themes (e.g. a banner image, a pattern). */
  decor?: { pattern?: string; heroOverlay?: string };
};

export const themes = pgTable(
  "themes",
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    tokens: jsonb().$type<ThemeTokens>().notNull(),
    /** The base theme used when no scheduled theme is running. Exactly one should be true. */
    isDefault: boolean().notNull().default(false),
    /** Seasonal/campaign themes switch on automatically inside their schedule window. */
    isScheduled: boolean().notNull().default(false),
    ...schedule,
    priority: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index().on(t.isScheduled, t.startsAt, t.endsAt),
    // At most one default theme (the panel switches it inside one transaction: unset, then set).
    uniqueIndex("themes_single_default").on(t.isDefault).where(sql`${t.isDefault}`),
  ],
).enableRLS();

export type MediaVariant = { width: number; height: number; format: "avif" | "webp" | "jpeg" | "png"; key: string; bytes: number };

export const media = pgTable(
  "media",
  {
    id: id(),
    /** Storage key of the original file (local disk in development, Supabase Storage in production). */
    storageKey: text().notNull().unique(),
    url: text().notNull(),
    mime: text().notNull(),
    width: integer(),
    height: integer(),
    bytes: integer(),
    alt: jsonb().$type<LocalizedText>(),
    /** Tiny base64 blur placeholder shown while the image loads. */
    blurDataUrl: text(),
    /** Dominant color, used for skeletons and per-product theming suggestions. */
    dominantColor: text(),
    variants: jsonb().$type<MediaVariant[]>(),
    folder: text().notNull().default("genel"),
    tags: text().array(),
    /** File name as uploaded from the panel (searchable); null for seeded media. */
    originalName: text(),
    /**
     * Day 6: "image" (made by the image pipeline, `variants` set) or "video" (mp4/webm stored as uploaded,
     * `variants` null). Always agrees with `mime` (check below), so image consumers can filter on it
     * (`imageOnly()` in src/lib/data/media.ts).
     */
    kind: text().$type<MediaKind>().notNull().default("image"),
    /** Day 6: video length in milliseconds (null for images). */
    durationMs: integer(),
    /** Day 6: cover image of a video (an image row); its blur and dominant colour are copied onto the video row. */
    posterId: integer().references((): AnyPgColumn => media.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index().on(t.folder),
    index().on(t.posterId),
    check("media_kind_check", sql`${t.kind} in ('image', 'video')`),
    check("media_kind_mime_check", sql`(${t.kind} = 'video') = (${t.mime} like 'video/%')`),
  ],
).enableRLS();

export type PageKind = "home" | "custom" | "legal" | "landing" | "b2b";

export const pages = pgTable("pages", {
  id: id(),
  slug: text().notNull().unique(),
  kind: text().$type<PageKind>().notNull().default("custom"),
  title: jsonb().$type<LocalizedText>().notNull(),
  seo: jsonb().$type<SeoFields>(),
  isPublished: boolean().notNull().default(true),
  ...timestamps,
}).enableRLS();

/**
 * A block on a page. `type` selects the storefront component (src/components/sections/registry.ts);
 * `content` holds that component's localized texts and options (validated by its zod schema).
 */
export const pageSections = pgTable(
  "page_sections",
  {
    id: id(),
    pageId: integer()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    type: text().notNull(),
    position: integer().notNull().default(0),
    isVisible: boolean().notNull().default(true),
    content: jsonb().notNull().default({}),
    /** Optional: show the section only for some audiences. */
    audience: text().$type<"all" | "retail" | "business">().notNull().default("all"),
    ...schedule,
    ...timestamps,
  },
  (t) => [index().on(t.pageId, t.position)],
).enableRLS();

export type MenuItem = { label: LocalizedText; href: string; children?: MenuItem[]; highlight?: boolean };

export const menus = pgTable("menus", {
  id: id(),
  key: text().notNull().unique(), // header, footer_shop, footer_corporate, footer_legal
  items: jsonb().$type<MenuItem[]>().notNull().default([]),
  ...timestamps,
}).enableRLS();

export const announcements = pgTable("announcements", {
  id: id(),
  text: jsonb().$type<LocalizedText>().notNull(),
  href: text(),
  variant: text().$type<"brand" | "accent" | "neutral">().notNull().default("brand"),
  isActive: boolean().notNull().default(true),
  position: integer().notNull().default(0),
  ...schedule,
  ...timestamps,
}).enableRLS();

/** Overrides for the built-in UI texts (buttons, labels). Defaults live in src/i18n/messages/*.ts. */
export const uiStrings = pgTable("ui_strings", {
  key: text().primaryKey(),
  value: jsonb().$type<LocalizedText>().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

/** Every change made in the panel, so it can be reviewed (and later undone). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: text(),
    action: text().notNull(), // create | update | delete | publish | login ...
    entity: text().notNull(), // product, theme, page_section ...
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.entity, t.entityId), index().on(t.createdAt), index().on(t.userId, t.createdAt)],
).enableRLS();

export const redirects = pgTable(
  "redirects",
  {
    id: id(),
    fromPath: text().notNull(),
    toPath: text().notNull(),
    permanent: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.fromPath), index().on(t.toPath)],
).enableRLS();
