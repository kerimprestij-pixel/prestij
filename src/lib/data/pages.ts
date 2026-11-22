import { and, asc, eq, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import type { LocalizedText, PageKind, SeoFields } from "@/db/schema";
import { TAGS } from "@/lib/cache-tags";
import { SAMPLES_PAGE_SLUG, samplesSwitchedOff, withoutSamplesSections } from "@/lib/samples/visibility";
import { getSettings } from "@/lib/settings/get-settings";

export type PageSectionData = {
  id: number;
  type: string;
  /** Unvalidated JSON; each section validates it with its own zod schema when rendering. */
  content: unknown;
  audience: "all" | "retail" | "business";
};

export type PageData = {
  id: number;
  slug: string;
  kind: PageKind;
  title: LocalizedText;
  seo: SeoFields | null;
  sections: PageSectionData[];
};

/**
 * A published page with its visible sections whose schedule window contains "now", by position.
 * When a section starts or ends in the future, the entry gets a short lifetime so the change goes
 * live on time; otherwise it stays cached until the panel invalidates the page tag.
 *
 * Every audience is returned: storefront pages are static, so SectionRenderer renders all sections
 * and <AudienceGate> shows "retail" / "business" ones in the browser once the viewer is known. Business
 * content therefore reaches every visitor's page payload (the panel says so next to the audience
 * select): never a place for confidential information.
 */
export async function getPage(slug: string): Promise<PageData | null> {
  "use cache";
  cacheTag(TAGS.pages, TAGS.page(slug));

  const { pages, pageSections: s } = schema;
  const [page] = await db
    .select({ id: pages.id, slug: pages.slug, kind: pages.kind, title: pages.title, seo: pages.seo })
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.isPublished, true)))
    .limit(1);
  if (!page) {
    cacheLife("max");
    return null;
  }

  const rows = await db
    .select({
      id: s.id,
      type: s.type,
      content: s.content,
      audience: s.audience,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    })
    .from(s)
    .where(and(eq(s.pageId, page.id), eq(s.isVisible, true)))
    .orderBy(asc(s.position), asc(s.id));

  const now = Date.now();
  const upcomingChange = rows.some(
    (r) => (r.startsAt && r.startsAt.getTime() > now) || (r.endsAt && r.endsAt.getTime() > now),
  );
  if (upcomingChange) cacheLife("minutes");
  else cacheLife("max");

  const sections = rows
    .filter((r) => (!r.startsAt || r.startsAt.getTime() <= now) && (!r.endsAt || r.endsAt.getTime() > now))
    .map((r) => ({ id: r.id, type: r.type, content: r.content, audience: r.audience }));

  return { ...page, sections };
}

/**
 * getPage for rendering a storefront page: while free samples are switched off (Ayarlar › Numune, both switches),
 * sections whose main call to action is /numune are left out and other buttons/links to it are removed
 * (PayTR-fix IMPL-B, S17; rules in src/lib/samples/visibility.ts). The samples page itself is returned as stored.
 * Two cached reads (tags `pages`/`page:<slug>` and `settings`), so the page stays static and a panel save of either
 * refreshes it. Metadata and structured data may keep using getPage (they read no sections' links).
 */
export async function getStorefrontPage(slug: string): Promise<PageData | null> {
  const [page, samples] = await Promise.all([getPage(slug), getSettings("samples")]);
  if (!page || slug === SAMPLES_PAGE_SLUG || !samplesSwitchedOff(samples)) return page;
  return { ...page, sections: withoutSamplesSections(page.sections) };
}

/** Slugs of published pages served at /sayfa/<slug> (everything except the home page). */
export async function listPageSlugs(): Promise<string[]> {
  "use cache";
  cacheLife("max");
  cacheTag(TAGS.pages);

  const { pages } = schema;
  const rows = await db
    .select({ slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.isPublished, true), ne(pages.kind, "home")))
    .orderBy(asc(pages.slug));
  return rows.map((r) => r.slug);
}
