// STORE-UI (day 5): one <h1> per page. claimPageHeading() hands the page title to the first claimant of
// a server render (ListingHeader, else the first hero). The real behaviour needs React's server build
// (its `cache` is per request), so that part runs in a child process with the react-server condition,
// where a stand-in for React's request dispatcher plays two separate renders.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { claimPageHeading } from "@/components/store/page-heading";

const MODULE_URL = pathToFileURL(path.resolve("src/components/store/page-heading.ts")).href;

const SERVER_SCRIPT = `
import * as React from "react";
const { claimPageHeading, claimSectionHeading } = await import(${JSON.stringify(MODULE_URL)});
const internals = React.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
if (!internals || typeof React.cache !== "function") throw new Error("not the react-server build");
// One Map per render, like React's request.cache.
const render = (fn) => {
  const store = new Map();
  internals.A = { getCacheForType: (create) => (store.has(create) || store.set(create, create()), store.get(create)), getOwner: () => null };
  try { return fn(); } finally { internals.A = null; }
};
const header = {}, hero = {}, secondHero = {};
const out = {
  listingPage: render(() => [claimPageHeading(header), claimPageHeading(hero)]),
  heroPage: render(() => [claimPageHeading(hero), claimPageHeading(secondHero), claimPageHeading(hero)]),
  nextRender: render(() => [claimPageHeading(secondHero)]),
  outsideRender: [claimPageHeading(hero), claimPageHeading(secondHero)],
  // A business-only hero (not in the guest HTML) never claims; the visible hero after it does.
  businessFirst: render(() => [claimSectionHeading(hero, "business"), claimSectionHeading(secondHero, "retail")]),
  allAfterBusiness: render(() => [claimSectionHeading(hero, "business"), claimSectionHeading(secondHero, "all"), claimSectionHeading(header, undefined)]),
};
process.stdout.write(JSON.stringify(out));
`;

describe("claimPageHeading", () => {
  test("outside a server render (tests, client components) every caller keeps its <h1> (pre-day-5 behaviour)", () => {
    const a = {};
    const b = {};
    assert.equal(claimPageHeading(a), true);
    assert.equal(claimPageHeading(b), true);
  });

  test("in a server render: first claimant wins, the same owner may re-render, each render starts fresh", () => {
    const run = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "--eval", SERVER_SCRIPT], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), {
      // ListingHeader first → a hero further down gets <h2>.
      listingPage: [true, false],
      // First hero is the title; a second hero is not; the first one rendered again still is.
      heroPage: [true, false, true],
      // A new render (another page or request) does not inherit the previous claim.
      nextRender: [true],
      // No request: no memoization at all.
      outsideRender: [true, true],
      // Day 5 FIX: a business hero placed above the guests' hero leaves the <h1> to the guests' hero.
      businessFirst: [false, true],
      allAfterBusiness: [false, true, false],
    });
  });
});
