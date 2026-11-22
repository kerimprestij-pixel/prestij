// Who sees a page-builder section with an audience (pure and client-safe, unit-tested). Storefront
// pages are static, so the server renders the guest view; <AudienceGate> applies these rules in the
// browser once <ViewerProvider> knows who is visiting.
//
//   all      → everyone, always (no gate).
//   retail   → in the static HTML; hidden once the viewer turns out to be an approved business customer.
//   business → not in the HTML; appears once the viewer turns out to be an approved business customer.
//              Its content still travels in the page payload, so it must never hold secrets.

export type SectionAudience = "all" | "retail" | "business";

/** True for the three audiences the panel saves (anything else is never shown). */
export function isSectionAudience(value: unknown): value is SectionAudience {
  return value === "all" || value === "retail" || value === "business";
}

/** The parts of the viewer state the rules read (see useViewer()). */
export type AudienceViewer = { ready: boolean; signedIn: boolean; isBusiness: boolean };

/**
 * An approved business customer: the viewer has loaded, is signed in, and the server put them in a
 * business pricing context (an approved company, or a business group set by staff). Before the viewer
 * loads, everyone is treated as a guest.
 */
export function isApprovedBusinessViewer(viewer: AudienceViewer): boolean {
  return viewer.ready && viewer.signedIn && viewer.isBusiness;
}

/** True when a section for `audience` is shown to this viewer right now. */
export function showsForViewer(audience: SectionAudience, viewer: AudienceViewer): boolean {
  if (audience === "all") return true;
  const business = isApprovedBusinessViewer(viewer);
  return audience === "business" ? business : !business;
}

/** True when the section is part of the server-rendered (static) HTML: what guests and crawlers see. */
export function inStaticHtml(audience: SectionAudience): boolean {
  return audience !== "business";
}

/** Which audiences a renderability check accepts: guests ("retail"), business customers, or anyone. */
export type AudienceFilter = "retail" | "business" | "any";

/** True when a section with `audience` can render for the visitors described by `filter`. */
export function audienceMatches(audience: SectionAudience, filter: AudienceFilter): boolean {
  if (filter === "any" || audience === "all") return true;
  return audience === filter;
}

/**
 * The section that opens the page for guests (the first one not reserved for business customers),
 * or null. Pages use it to decide whether a hero provides the page's h1.
 */
export function leadingGuestSection<T extends { audience: SectionAudience }>(sections: readonly T[]): T | null {
  return sections.find((section) => inStaticHtml(section.audience)) ?? null;
}

/** True when a section rendered for `audience` may take the page's <h1> or preload an image (it is in the static HTML). */
export function mayLeadPage(audience: SectionAudience | undefined): boolean {
  return audience === undefined || inStaticHtml(audience);
}
