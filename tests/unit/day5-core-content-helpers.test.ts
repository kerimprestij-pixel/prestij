// Day 5 CORE: scripts/seed-data/content-helpers.ts (shared by content-day4.ts and content-day5.ts):
// JSON helpers, the "previous seeded default" rule, the production guard and the step registry.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STEPS as DAY4_STEPS } from "../../scripts/content-day4";
import { blogPosts, catalogSeo, STEPS as DAY5_STEPS } from "../../scripts/content-day5";
import {
  assertSafeTarget,
  decideDefaultUpdate,
  emptyReport,
  getAt,
  isNothingToDo,
  lt,
  sameJson,
  setAt,
  SKIP_REASON,
} from "../../scripts/seed-data/content-helpers";

describe("sameJson", () => {
  test("ignores key order and undefined properties, not array order", () => {
    assert.ok(sameJson({ tr: "a", en: "b" }, { en: "b", tr: "a" }));
    assert.ok(sameJson({ a: 1, b: undefined }, { a: 1 }));
    assert.ok(sameJson([{ x: [1, 2] }], [{ x: [1, 2] }]));
    assert.ok(!sameJson([1, 2], [2, 1]));
    assert.ok(!sameJson({ a: 1 }, { a: 1, b: 2 }));
    assert.ok(!sameJson(null, {}));
    assert.ok(!sameJson("1", 1));
  });
});

describe("getAt / setAt", () => {
  const value = { items: [{ answer: { tr: "eski" } }, { answer: { tr: "diğer" } }], title: "x" };

  test("getAt follows keys and indexes; missing steps give undefined", () => {
    assert.deepEqual(getAt(value, ["items", 0, "answer"]), { tr: "eski" });
    assert.equal(getAt(value, ["items", 5, "answer"]), undefined);
    assert.equal(getAt(null, ["a"]), undefined);
  });

  test("setAt returns a copy and leaves the input untouched", () => {
    const next = setAt(value, ["items", 0, "answer"], { tr: "yeni" }) as typeof value;
    assert.deepEqual(next.items[0].answer, { tr: "yeni" });
    assert.deepEqual(next.items[1], value.items[1]);
    assert.deepEqual(value.items[0].answer, { tr: "eski" });
    assert.equal(setAt(value, [], 5), 5);
  });
});

describe("decideDefaultUpdate", () => {
  const OLD = lt("Eski başlık", "Old title", "عنوان قديم");
  const NEW = lt("Yeni başlık", "New title", "عنوان جديد");

  test("up to date / update while still a previous default / edited otherwise", () => {
    assert.equal(decideDefaultUpdate({ ...NEW }, NEW, OLD), "up_to_date");
    assert.equal(decideDefaultUpdate({ ar: OLD.ar, en: OLD.en, tr: OLD.tr }, NEW, OLD), "update");
    assert.equal(decideDefaultUpdate({ ...OLD, tr: "Müşterinin başlığı" }, NEW, OLD), "edited");
  });

  test("several previous defaults; undefined among them also fills a value never set", () => {
    const OLDER = { tr: "Daha eski" };
    assert.equal(decideDefaultUpdate(OLDER, NEW, OLD, OLDER), "update");
    assert.equal(decideDefaultUpdate(undefined, NEW, OLD), "edited");
    assert.equal(decideDefaultUpdate(undefined, NEW, OLD, undefined), "update");
  });

  test("skip wording is the day-4 wording", () => {
    assert.equal(SKIP_REASON.up_to_date, "already up to date");
    assert.equal(SKIP_REASON.edited, "edited in the panel, left as is");
  });
});

describe("assertSafeTarget", () => {
  test("local databases pass; production and remote hosts need --allow-production", () => {
    assert.doesNotThrow(() => assertSafeTarget([], { DATABASE_URL: "postgres://u:p@localhost:54329/prestij" }));
    assert.doesNotThrow(() => assertSafeTarget([], { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x" }));
    assert.throws(() => assertSafeTarget([], { NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost/x" }), /NODE_ENV=production/);
    assert.throws(() => assertSafeTarget([], { DATABASE_URL: "postgres://u:p@db.example.supabase.co:5432/x" }), /not a local database/);
    assert.doesNotThrow(() => assertSafeTarget(["--allow-production"], { NODE_ENV: "production", DATABASE_URL: "postgres://u:p@db.example.com/x" }));
  });
});

describe("step registries", () => {
  test("day 5 registers catalogSeo then blogPosts; both start empty", async () => {
    assert.deepEqual(DAY5_STEPS.map((s) => [s.key, s.owner]), [["catalogSeo", "CONTENT-CATALOG"], ["blogPosts", "CONTENT-BLOG"]]);
    assert.equal(DAY5_STEPS[0].run, catalogSeo);
    assert.equal(DAY5_STEPS[1].run, blogPosts);
    assert.ok(isNothingToDo(emptyReport()));
    assert.ok(!isNothingToDo({ ...emptyReport(), updated: ["x"] }));
  });

  test("day 4 keeps its three steps (refactor changed nothing visible)", () => {
    assert.deepEqual(DAY4_STEPS.map((s) => s.key), ["requestForms", "membershipLegalDoc", "reviewSettings"]);
  });
});
