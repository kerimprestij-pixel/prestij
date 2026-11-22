// AUDIENCE-PERF (day 5): who sees a page-builder section on static pages (<AudienceGate> rules). The
// server renders the guest view; the gate switches to the business view once the viewer has loaded and
// is an approved business customer.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  audienceMatches,
  inStaticHtml,
  isApprovedBusinessViewer,
  isSectionAudience,
  leadingGuestSection,
  mayLeadPage,
  showsForViewer,
  type AudienceViewer,
  type SectionAudience,
} from "@/components/sections/audience-gate-rules";

const LOADING: AudienceViewer = { ready: false, signedIn: false, isBusiness: false };
const GUEST: AudienceViewer = { ready: true, signedIn: false, isBusiness: false };
const RETAIL_CUSTOMER: AudienceViewer = { ready: true, signedIn: true, isBusiness: false };
const BUSINESS: AudienceViewer = { ready: true, signedIn: true, isBusiness: true };

describe("approved business viewer", () => {
  test("only a loaded, signed-in viewer in a business pricing context counts", () => {
    assert.equal(isApprovedBusinessViewer(BUSINESS), true);
    assert.equal(isApprovedBusinessViewer(LOADING), false);
    assert.equal(isApprovedBusinessViewer(GUEST), false);
    assert.equal(isApprovedBusinessViewer(RETAIL_CUSTOMER), false);
    // Before the first loadViewer() answer nothing is trusted, whatever the other fields say.
    assert.equal(isApprovedBusinessViewer({ ready: false, signedIn: true, isBusiness: true }), false);
    // isBusiness without a session (cannot come from loadViewer, but never show business content then).
    assert.equal(isApprovedBusinessViewer({ ready: true, signedIn: false, isBusiness: true }), false);
  });
});

describe("showsForViewer", () => {
  const cases: [SectionAudience, AudienceViewer, boolean, string][] = [
    ["all", LOADING, true, "all: before the viewer loads"],
    ["all", GUEST, true, "all: guest"],
    ["all", BUSINESS, true, "all: business"],
    ["retail", LOADING, true, "retail is in the static HTML (no flash for guests)"],
    ["retail", GUEST, true, "retail: guest"],
    ["retail", RETAIL_CUSTOMER, true, "retail: signed-in retail customer (also a pending company)"],
    ["retail", BUSINESS, false, "retail hides for an approved business customer"],
    ["business", LOADING, false, "business never renders before the viewer loads"],
    ["business", GUEST, false, "business: guest"],
    ["business", RETAIL_CUSTOMER, false, "business: retail customer"],
    ["business", BUSINESS, true, "business shows for an approved business customer"],
  ];
  for (const [audience, viewer, expected, label] of cases) {
    test(label, () => assert.equal(showsForViewer(audience, viewer), expected));
  }

  test("the server render equals the guest view (what crawlers index)", () => {
    for (const audience of ["all", "retail", "business"] as const) {
      assert.equal(showsForViewer(audience, LOADING), inStaticHtml(audience), audience);
      assert.equal(showsForViewer(audience, GUEST), inStaticHtml(audience), audience);
    }
  });

  test("every section shows to exactly one of guest and business when targeted, to both when 'all'", () => {
    assert.deepEqual(
      (["all", "retail", "business"] as const).map((a) => [showsForViewer(a, GUEST), showsForViewer(a, BUSINESS)]),
      [
        [true, true],
        [true, false],
        [false, true],
      ],
    );
  });
});

describe("audience values and filters", () => {
  test("only the three saved audiences are known", () => {
    for (const value of ["all", "retail", "business"]) assert.equal(isSectionAudience(value), true, value);
    for (const value of ["", "ALL", "b2b", null, undefined, 1, {}]) assert.equal(isSectionAudience(value), false, String(value));
  });

  test("audienceMatches: any keeps everything, retail/business keep their own plus all", () => {
    assert.equal(audienceMatches("business", "any"), true);
    assert.equal(audienceMatches("retail", "any"), true);
    assert.equal(audienceMatches("all", "retail"), true);
    assert.equal(audienceMatches("retail", "retail"), true);
    assert.equal(audienceMatches("business", "retail"), false);
    assert.equal(audienceMatches("all", "business"), true);
    assert.equal(audienceMatches("business", "business"), true);
    assert.equal(audienceMatches("retail", "business"), false);
  });

  test("inStaticHtml: business sections are not in the server HTML", () => {
    assert.equal(inStaticHtml("all"), true);
    assert.equal(inStaticHtml("retail"), true);
    assert.equal(inStaticHtml("business"), false);
  });
});

describe("leadingGuestSection", () => {
  const s = (id: number, type: string, audience: SectionAudience) => ({ id, type, audience });

  test("skips business-only sections at the top", () => {
    assert.deepEqual(leadingGuestSection([s(1, "hero", "business"), s(2, "rich_text", "all")]), s(2, "rich_text", "all"));
    assert.deepEqual(leadingGuestSection([s(1, "hero", "retail"), s(2, "faq", "all")]), s(1, "hero", "retail"));
    assert.deepEqual(leadingGuestSection([s(1, "hero", "all")]), s(1, "hero", "all"));
  });

  test("null when guests see no section", () => {
    assert.equal(leadingGuestSection([]), null);
    assert.equal(leadingGuestSection([s(1, "faq", "business")]), null);
  });
});

describe("mayLeadPage (day 5 FIX)", () => {
  test("only sections in the static HTML may take the page's <h1> or preload an image", () => {
    assert.equal(mayLeadPage("all"), true);
    assert.equal(mayLeadPage("retail"), true);
    assert.equal(mayLeadPage(undefined), true, "a section rendered outside SectionRenderer");
    assert.equal(mayLeadPage("business"), false);
  });

  test("the lead section for the priority image is the first guests see", () => {
    const sections = [{ id: 1, audience: "business" as const }, { id: 2, audience: "retail" as const }, { id: 3, audience: "all" as const }];
    assert.equal(leadingGuestSection(sections)?.id, 2);
  });
});
