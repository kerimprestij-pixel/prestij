// Editor and list shapes for the CONTENT area (pages, sections, menus, announcements). Type-only and
// client-safe: Dates are ISO strings, so the values cross the server/client boundary as they are.
import type { LocalizedText } from "@/db/schema/common";
import type { MenuItem, PageKind } from "@/db/schema/site";
import type { MenuKey } from "@/lib/data/site";
import type { PanelMedia } from "@/lib/panel/media/types";
import type { AnnouncementVariantKey } from "./announcements";
import type { Audience } from "./sections";

export type PanelPageRow = {
  id: number;
  slug: string;
  kind: PageKind;
  title: LocalizedText;
  isPublished: boolean;
  sectionCount: number;
  visibleCount: number;
  updatedAt: string;
};

/** One section in the page editor. `key` is client-only (stable across reorders); `id` is null for new ones. */
export type SectionState = {
  key: string;
  id: number | null;
  type: string;
  isVisible: boolean;
  audience: Audience;
  schedule: { startsAt: string | null; endsAt: string | null };
  content: Record<string, unknown>;
};

export type SeoState = {
  title: LocalizedText | null;
  description: LocalizedText | null;
  ogImageId: number | null;
  noIndex: boolean;
};

export type PageEditorState = {
  id: number;
  slug: string;
  kind: PageKind;
  title: LocalizedText;
  isPublished: boolean;
  seo: SeoState;
  sections: SectionState[];
  updatedAt: string;
};

export type PageEditorData = {
  page: PageEditorState;
  /** Media referenced by the page (pickers show them without a request). */
  media: PanelMedia[];
};

export type MenuState = { items: MenuItem[]; updatedAt: string | null };
export type MenusEditorState = { menus: Record<MenuKey, MenuState> };

export type PanelAnnouncement = {
  id: number;
  text: LocalizedText;
  href: string | null;
  variant: AnnouncementVariantKey;
  isActive: boolean;
  position: number;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
};
