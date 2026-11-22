// Panel reads for pages, menus and announcements. Uncached on purpose (editors need the live rows);
// callers have passed requireStaff("editor"). Dates leave as ISO strings for client editor state.
import "server-only";
import { asc, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getPanelMedia, mediaIdsInJson } from "@/lib/panel/media/queries";
import type { Tx } from "@/lib/panel/tx";
import type { MenuKey } from "@/lib/data/site";
import { MENU_KEY_LIST } from "./menus";
import { loadSectionContent } from "./sections";
import type { MenuState, MenusEditorState, PageEditorData, PanelAnnouncement, PanelPageRow, SectionState } from "./types";

export type { MenuState, MenusEditorState, PageEditorData, PageEditorState, PanelAnnouncement, PanelPageRow, SectionState, SeoState } from "./types";

// ---------------------------------------------------------------------------------------------------
// Pages

export async function listPanelPages(executor: Tx = db): Promise<PanelPageRow[]> {
  const p = schema.pages;
  const s = schema.pageSections;
  const rows = await executor
    .select({
      id: p.id,
      slug: p.slug,
      kind: p.kind,
      title: p.title,
      isPublished: p.isPublished,
      updatedAt: p.updatedAt,
      sectionCount: count(s.id),
      visibleCount: sql<number>`count(${s.id}) filter (where ${s.isVisible})`.mapWith(Number),
    })
    .from(p)
    .leftJoin(s, eq(s.pageId, p.id))
    .groupBy(p.id)
    .orderBy(asc(p.id));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getPageEditorData(id: number, executor: Tx = db): Promise<PageEditorData | null> {
  const p = schema.pages;
  const s = schema.pageSections;
  const [page] = await executor.select().from(p).where(eq(p.id, id)).limit(1);
  if (!page) return null;
  const rows = await executor.select().from(s).where(eq(s.pageId, id)).orderBy(asc(s.position), asc(s.id));

  const sections: SectionState[] = rows.map((row) => ({
    key: `s${row.id}`,
    id: row.id,
    type: row.type,
    isVisible: row.isVisible,
    audience: row.audience === "retail" || row.audience === "business" ? row.audience : "all",
    schedule: { startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) },
    content: loadSectionContent(row.type, row.content),
  }));

  const seo = page.seo ?? {};
  const mediaIds = new Set<number>();
  for (const section of sections) mediaIdsInJson(section.content, mediaIds);
  if (seo.ogImageId) mediaIds.add(seo.ogImageId);

  return {
    page: {
      id: page.id,
      slug: page.slug,
      kind: page.kind,
      title: page.title,
      isPublished: page.isPublished,
      seo: {
        title: seo.title ?? null,
        description: seo.description ?? null,
        ogImageId: seo.ogImageId ?? null,
        noIndex: Boolean(seo.noIndex),
      },
      sections,
      updatedAt: page.updatedAt.toISOString(),
    },
    media: await getPanelMedia([...mediaIds], executor),
  };
}

// ---------------------------------------------------------------------------------------------------
// Menus

export async function getMenusEditorState(executor: Tx = db): Promise<MenusEditorState> {
  const m = schema.menus;
  const rows = await executor.select({ key: m.key, items: m.items, updatedAt: m.updatedAt }).from(m);
  const menus = Object.fromEntries(MENU_KEY_LIST.map((key): [MenuKey, MenuState] => [key, { items: [], updatedAt: null }])) as Record<MenuKey, MenuState>;
  for (const row of rows) {
    if (!(MENU_KEY_LIST as readonly string[]).includes(row.key)) continue;
    menus[row.key as MenuKey] = { items: Array.isArray(row.items) ? row.items : [], updatedAt: row.updatedAt.toISOString() };
  }
  return { menus };
}

// ---------------------------------------------------------------------------------------------------
// Announcements

function toPanelAnnouncement(row: typeof schema.announcements.$inferSelect): PanelAnnouncement {
  return {
    id: row.id,
    text: row.text,
    href: row.href,
    variant: row.variant === "accent" || row.variant === "neutral" ? row.variant : "brand",
    isActive: row.isActive,
    position: row.position,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPanelAnnouncements(executor: Tx = db): Promise<PanelAnnouncement[]> {
  const a = schema.announcements;
  const rows = await executor.select().from(a).orderBy(asc(a.position), asc(a.id));
  return rows.map(toPanelAnnouncement);
}
