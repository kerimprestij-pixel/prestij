// Go-live data path: the --profile=showcase settings transform (validated with the app's own
// settingsSchemas, other fields kept, missing rows filled with defaults, verifier flags satisfied)
// and the production admin's e-mail/password rules of scripts/golive/create-admin.ts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";
import { WHEEL_TERMS_PAGE_SLUG } from "@/lib/wheel/types";
import {
  SHOWCASE_EXPECTED_FLAGS,
  SHOWCASE_HIDE_SECTION_TYPES,
  SHOWCASE_SETTINGS,
  SHOWCASE_UNPUBLISH_PAGE_SLUGS,
  adminEmailProblem,
  adminPasswordProblem,
  buildSettingsChanges,
  changedPaths,
  readPath,
  type SettingsChange,
} from "../../scripts/golive/rules";

/** Stored documents shaped like the local database on 2026-11-14 (subscriptions has no row). */
const stored = (): Partial<Record<SettingsKey, unknown>> => ({
  payments: {
    card: { enabled: true, provider: "iyzico", testMode: true, installments: true },
    bankTransfer: { enabled: true, accounts: [], instructions: { tr: "Açıklamaya sipariş numaranızı yazın.", en: "Order number" }, discountPercent: 0 },
    cashOnDelivery: { fee: 4990, enabled: true, maxOrderTotal: 500000 },
  },
  newsletter: { enabled: true, incentive: { tr: "İlk siz haberdar olun." }, popupEnabled: false, popupDelaySeconds: 20 },
  samples: { maxPerOrder: 2, minOrderTotal: 0, cartSampleEnabled: true, requestFormEnabled: true },
  giftWheel: { ...settingsSchemas.giftWheel.parse({}), enabled: true, reminderEnabled: true, round: 3 },
});

const byKey = (changes: SettingsChange[]) => new Map(changes.map((c) => [c.key, c]));

describe("showcase profile: settings", () => {
  test("switches off payments, wheel, newsletter, samples and subscriptions and keeps everything else", () => {
    const changes = byKey(buildSettingsChanges(SHOWCASE_SETTINGS, stored()));
    assert.deepEqual([...changes.keys()].sort(), ["giftWheel", "newsletter", "payments", "samples", "subscriptions"]);

    const payments = changes.get("payments")!.value as Settings<"payments">;
    assert.equal(payments.card.enabled, false);
    assert.equal(payments.bankTransfer.enabled, false);
    assert.equal(payments.cashOnDelivery.enabled, false);
    assert.equal(payments.card.provider, "iyzico");
    assert.equal(payments.cashOnDelivery.fee, 4990);
    assert.deepEqual(payments.bankTransfer.instructions, { tr: "Açıklamaya sipariş numaranızı yazın.", en: "Order number" });
    assert.deepEqual(changes.get("payments")!.fields.map((f) => f.path), ["bankTransfer.enabled", "card.enabled", "cashOnDelivery.enabled"]);
    assert.deepEqual(
      changes.get("payments")!.normalized,
      [
        // SR-2: rows saved before the havale payment days existed get the default 3.
        { path: "bankTransfer.paymentDays", from: undefined, to: 3 },
        { path: "card.maxInstallments", from: undefined, to: 1 },
        // PayTR-fix IMPL-B (S7): no PayTR logo until the owner picks one.
        { path: "paytrLogoImageId", from: undefined, to: null },
      ],
      "defaults written like a panel save",
    );

    const wheel = changes.get("giftWheel")!.value as Settings<"giftWheel">;
    assert.equal(wheel.enabled, false);
    assert.equal(wheel.reminderEnabled, false);
    assert.equal(wheel.round, 3);
    assert.equal(wheel.slices.length, 6);

    const newsletter = changes.get("newsletter")!.value as Settings<"newsletter">;
    assert.equal(newsletter.enabled, false);
    assert.deepEqual(newsletter.incentive, { tr: "İlk siz haberdar olun." });

    const samples = changes.get("samples")!.value as Settings<"samples">;
    assert.equal(samples.cartSampleEnabled, false);
    assert.equal(samples.requestFormEnabled, false);
    assert.equal(samples.maxPerOrder, 2);
  });

  test("a key without a row gets the schema defaults plus the change", () => {
    const sub = byKey(buildSettingsChanges(SHOWCASE_SETTINGS, stored())).get("subscriptions")!;
    assert.equal(sub.existed, false);
    assert.deepEqual(sub.value, { ...settingsSchemas.subscriptions.parse({}), enabled: false });
    assert.deepEqual(sub.normalized, []);
  });

  test("every written value passes the app's schema and satisfies the verifier's flags", () => {
    const changes = buildSettingsChanges(SHOWCASE_SETTINGS, stored());
    for (const c of changes) assert.equal(settingsSchemas[c.key].safeParse(c.value).success, true, c.key);
    const values = byKey(changes);
    for (const flag of SHOWCASE_EXPECTED_FLAGS) {
      assert.equal(readPath(values.get(flag.key)?.value, flag.path), flag.expected, `${flag.key}.${flag.path}`);
    }
  });

  test("is idempotent: already switched-off documents report no change", () => {
    const once = buildSettingsChanges(SHOWCASE_SETTINGS, stored());
    const again = buildSettingsChanges(SHOWCASE_SETTINGS, Object.fromEntries(once.map((c) => [c.key, c.value])));
    for (const c of again) {
      assert.deepEqual(c.fields, [], c.key);
      assert.equal(c.existed, true);
    }
  });

  test("a partly invalid stored document is repaired per field, as the storefront reads it", () => {
    const docs = stored();
    docs.giftWheel = { enabled: true, reminderEnabled: true, slices: [{ key: "x" }], holdDays: 5 };
    const wheel = byKey(buildSettingsChanges(SHOWCASE_SETTINGS, docs)).get("giftWheel")!;
    assert.equal(wheel.repaired, true);
    const value = wheel.value as Settings<"giftWheel">;
    assert.equal(value.enabled, false);
    assert.equal(value.holdDays, 5, "valid fields are kept");
    assert.equal(value.slices.length, 6, "the broken field falls back to its default");
  });

  test("a patch that breaks the schema throws instead of writing", () => {
    const broken = { samples: (v: Settings<"samples">) => ({ ...v, maxPerOrder: -1 }) };
    assert.throws(() => buildSettingsChanges(broken, stored()), /settings "samples" would not pass the app's schema/);
  });
});

describe("showcase profile: pages and sections", () => {
  test("unpublishes the wheel terms page and hides the newsletter band", () => {
    assert.deepEqual([...SHOWCASE_UNPUBLISH_PAGE_SLUGS], [WHEEL_TERMS_PAGE_SLUG]);
    assert.equal(WHEEL_TERMS_PAGE_SLUG, "hediye-carki-kampanya-kosullari");
    assert.deepEqual([...SHOWCASE_HIDE_SECTION_TYPES], ["newsletter"]);
  });
});

describe("changedPaths", () => {
  test("lists changed leaves with dotted paths; arrays compare as a whole", () => {
    assert.deepEqual(changedPaths({ a: { b: 1, c: [1] }, d: true }, { a: { b: 2, c: [1] }, d: true }), [{ path: "a.b", from: 1, to: 2 }]);
    assert.deepEqual(changedPaths({ a: [1, 2] }, { a: [2, 1] }), [{ path: "a", from: [1, 2], to: [2, 1] }]);
    assert.deepEqual(changedPaths({}, { x: 1 }), [{ path: "x", from: undefined, to: 1 }]);
  });

  test("ignores object key order (jsonb reorders keys)", () => {
    assert.deepEqual(changedPaths({ s: [{ key: "a", tone: "gold" }] }, { s: [{ tone: "gold", key: "a" }] }), []);
    const wheel = settingsSchemas.giftWheel.parse({});
    const reordered = JSON.parse(JSON.stringify({ ...wheel, slices: wheel.slices.map((s) => Object.fromEntries(Object.entries(s).reverse())) }));
    const change = buildSettingsChanges({ giftWheel: SHOWCASE_SETTINGS.giftWheel }, { giftWheel: reordered })[0];
    assert.deepEqual(change.normalized, []);
  });
});

describe("production admin rules", () => {
  const strong = "Vq7#mR2!pL9z@Wd4";

  test("passwords: at least 14 characters, varied, without the shop name or the e-mail", () => {
    assert.equal(adminPasswordProblem(strong, "owner@gmail.com"), null);
    const checks: [string, RegExp][] = [
      ["Short1!aB", /at least 14/],
      [" " + strong, /space/],
      ["abababababababab", /too few different/],
      ["Prestij2026!xYz#q", /common word/],
      ["PRESTİJ2026!xYz#q", /common word/],
      ["ownerbox-Zq8#Lm2!", /e-mail address/],
      ["x".repeat(129), /at most 128/],
    ];
    for (const [pw, expected] of checks) {
      const problem = adminPasswordProblem(pw, "ownerbox@gmail.com");
      assert.match(problem ?? "", expected, pw.slice(0, 6));
      assert.ok(!(problem ?? "").includes(pw), "the message never repeats the password");
    }
  });

  test("e-mail: a real mailbox in production, @test.local in a rehearsal", () => {
    assert.equal(adminEmailProblem("owner@gmail.com", "production"), null);
    assert.match(adminEmailProblem("admin@prestij.local", "production") ?? "", /real mailbox/);
    assert.match(adminEmailProblem("a@example.com", "production") ?? "", /real mailbox/);
    assert.match(adminEmailProblem("not-an-email", "production") ?? "", /not an e-mail/);
    assert.equal(adminEmailProblem("golive-test-admin@test.local", "rehearsal"), null);
    assert.match(adminEmailProblem("owner@gmail.com", "rehearsal") ?? "", /@test\.local/);
  });
});
