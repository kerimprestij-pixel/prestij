// One <h1> per page. Page builders can put a hero anywhere (and more than one), and pages such as
// /urunler or /sayfa/<slug> render a ListingHeader (its own <h1>) above their sections, so a hero
// cannot know on its own whether it carries the page title. Whoever renders first claims it: the
// ListingHeader always does (it is the page title), a hero only when nothing claimed it before.
//
// The claim lives in React's per-request cache, so it is scoped to one server render (a prerender or
// a request) and never leaks between pages or visitors. Server components are called in tree order
// (an async component's synchronous part runs when React reaches it), so call this before any
// `await`. Outside a server render (unit tests, client components) `cache` does not memoize: every
// caller gets the title, which is the pre-day-5 behaviour.
import { cache } from "react";
import { mayLeadPage, type SectionAudience } from "@/components/sections/audience-gate-rules";

type HeadingClaim = { owner: unknown };

const currentClaim = cache((): HeadingClaim => ({ owner: undefined }));

/**
 * Claims the page's single <h1> for `owner` in the current server render. True for the first
 * claimant, and again for the same owner if React renders that element twice (pass a stable value,
 * e.g. the component's `content` prop object); false for everyone after it.
 */
export function claimPageHeading(owner: object): boolean {
  const claim = currentClaim();
  if (claim.owner === undefined) {
    claim.owner = owner;
    return true;
  }
  return claim.owner === owner;
}

/**
 * claimPageHeading for a page-builder section. A business-only section is rendered on the server too
 * (inside <AudienceGate>, which shows nothing to guests), so it must not claim: its <h1> would be
 * missing from the static HTML and the visible hero after it would fall back to <h2>.
 */
export function claimSectionHeading(owner: object, audience: SectionAudience | undefined): boolean {
  return mayLeadPage(audience) && claimPageHeading(owner);
}
