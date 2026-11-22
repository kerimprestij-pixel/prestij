// Sales-ready FIX (pure parts and the copy flow with stubbed connections):
//   F1   the sales profile switches free samples off (until ÜTS); --keep-samples (sales only) keeps them and drops the
//        two samples flags from the verifier's list.
//   F2   any variant on a Day-1 price refuses in the scripts (stock ignored; --allow-prices: a warning with the SKUs).
//   F3   the scripts' seller rule is the panel's missingSellerFields (KEP, chamber, rules link, district).
//   F5   the readiness rules run again on the copied content inside the copy transaction.
//   F6   a production copy needs a profile.
//   F8   legal placeholders use the legal editor's rule; --allow-legal-brackets turns them into warnings.
//   F11  copy-content refuses an unready shop before a single statement reaches the target.
//   F4   the havale day count stored with the order (orderPaymentDays); B-F9 launch checklist groups.
// The DB halves: tests/db/salesready-fix.test.ts (and the updated tests/db/salesready-impl-{a,b}.test.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BANK_TRANSFER_PAYMENT_DAYS, bankTransferDeadline, istanbulDayStart, orderPaymentDays } from "@/lib/orders/bank-transfer-deadline";
import { LAUNCH_GROUPS, launchChecklist, type LaunchChecklistInput } from "@/lib/panel/seo/launch";
import { placeholderPriceCheck, type PriceCheckRow } from "@/lib/pricing/placeholder-prices";
import { missingSellerFieldKeys, missingSellerFields, REQUIRED_SELLER_FIELDS, SELLER_FIELD_NAMES } from "@/lib/settings/seller";
import { parseSettings, settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";
import { assertCopiedContentReady, runCopy, type CopyArgs, type CopyState } from "../../scripts/golive/copy-run";
import { Refusal, type Pool } from "../../scripts/golive/pg";
import {
  PROFILES,
  SALES_EXPECTED_FLAGS,
  SALES_LEGAL_KEYS,
  buildSettingsChanges,
  legalReadiness,
  priceProblems,
  productionProfileProblem,
  readPath,
  resolveProfile,
  salesOnlyFlagProblem,
  salesReadiness,
  samplesSummary,
  sellerProblems,
} from "../../scripts/golive/rules";

const IBAN = "TR330006100519786457841326";
const row = (sku: string, price: number, stock: number): PriceCheckRow => ({ sku, price, stock, variantActive: true, productStatus: "active", productType: "standard" });
const SEED = [14990, 44990, 149990];

const readyGeneral = (): Settings<"general"> =>
  parseSettings("general", {
    email: "satis@prestij.example",
    mersisNo: "0123456789012345",
    taxOffice: "Kocasinan",
    taxNumber: "1234567890",
    kep: "prestij@hs01.kep.tr",
    chamber: { name: { tr: "Kayseri Ticaret Odası" }, rulesUrl: "https://www.example.org/meslek-kurallari" },
  });

const readyPayments = (): Settings<"payments"> => {
  const p = parseSettings("payments", {});
  return { ...p, cashOnDelivery: { ...p.cashOnDelivery, enabled: true }, bankTransfer: { ...p.bankTransfer, enabled: true, accounts: [{ bank: "Ziraat", holder: "PRESTİJ", iban: IBAN }] } };
};

const approvedLegal = () => SALES_LEGAL_KEYS.map((key) => ({ key, version: "2026-11 v1", body: { tr: `<p>Onaylı metin ${key}.</p>` } }));

// ---------------------------------------------------------------------------------------------------
// F1

describe("F1: free samples off in the sales profile until ÜTS", () => {
  const stored: Partial<Record<SettingsKey, unknown>> = {
    samples: { cartSampleEnabled: true, requestFormEnabled: true, maxPerOrder: 2, minOrderTotal: 0 },
    giftWheel: { ...settingsSchemas.giftWheel.parse({}), enabled: true },
  };

  test("the sales profile switches both sample options off and the verifier expects them off", () => {
    const samples = buildSettingsChanges(PROFILES.sales.settings, stored).find((c) => c.key === "samples");
    assert.ok(samples, "settings.samples is changed");
    assert.deepEqual(samples.fields.map((f) => f.path).sort(), ["cartSampleEnabled", "requestFormEnabled"]);
    const flags = SALES_EXPECTED_FLAGS.filter((f) => f.key === "samples").map((f) => [f.path, f.expected]);
    assert.deepEqual(flags, [["cartSampleEnabled", false], ["requestFormEnabled", false]]);
    for (const flag of SALES_EXPECTED_FLAGS) assert.equal(readPath(buildSettingsChanges(PROFILES.sales.settings, stored).find((c) => c.key === flag.key)?.value, flag.path), flag.expected, `${flag.key}.${flag.path}`);
  });

  test("--keep-samples (sales only): samples untouched, the two flags dropped; refused with showcase", () => {
    const kept = resolveProfile("sales", { keepSamples: true });
    assert.equal(kept.keepsSamples, true);
    assert.equal("samples" in kept.settings, false);
    assert.deepEqual(kept.expectedFlags.filter((f) => f.key === "samples"), []);
    assert.equal(kept.expectedFlags.length, SALES_EXPECTED_FLAGS.length - 2);
    assert.equal(buildSettingsChanges(kept.settings, stored).some((c) => c.key === "samples"), false);
    assert.equal(PROFILES.sales.settings.samples !== undefined, true, "the shared profile is not mutated");
    assert.equal(resolveProfile("sales"), PROFILES.sales);
    assert.equal(resolveProfile("showcase"), PROFILES.showcase);
    assert.throws(() => resolveProfile("showcase", { keepSamples: true }), /--keep-samples belongs to --profile=sales/);
  });

  test("both scripts refuse the sales-only flags without --profile=sales", () => {
    assert.equal(salesOnlyFlagProblem("sales", { allowPrices: true, keepSamples: true, allowLegalBrackets: true }), null);
    assert.equal(salesOnlyFlagProblem(null, {}), null);
    assert.equal(salesOnlyFlagProblem("showcase", {}), null);
    assert.match(salesOnlyFlagProblem("showcase", { keepSamples: true }) ?? "", /--keep-samples belong\(s\) to --profile=sales/);
    assert.match(salesOnlyFlagProblem(null, { allowPrices: true, allowLegalBrackets: true }) ?? "", /--allow-prices, --allow-legal-brackets/);
  });

  test("the samples line: OK (switched off) locally, FAIL when still on at the target, WARN with --keep-samples", () => {
    const on = { cartSampleEnabled: true, requestFormEnabled: false };
    const off = { cartSampleEnabled: false, requestFormEnabled: false };
    assert.equal(samplesSummary(on, false, "local").status, "OK");
    assert.match(samplesSummary(on, false, "local").en, /switched off on the target/);
    assert.equal(samplesSummary(on, false, "target").status, "FAIL");
    assert.equal(samplesSummary(off, false, "target").status, "OK");
    assert.equal(samplesSummary(on, true, "target").status, "WARN");
    assert.match(samplesSummary(on, true, "local").en, /ÜTS/);
  });
});

// ---------------------------------------------------------------------------------------------------
// F2

describe("F2: any Day-1 price refuses in the scripts", () => {
  test("probe 1: every seed price kept but stock changed to 37 still refuses", () => {
    const check = placeholderPriceCheck(Array.from({ length: 13 }, (_, i) => row(`S${i}`, SEED[i % 3], 37)));
    assert.equal(check.matches.length, 13);
    assert.equal(priceProblems(check, false).problems.length, 1);
  });

  test("probe 2: 7 of 13 updated, 6 still on seed prices (46 %) refuses and lists the six SKUs", () => {
    const rows = Array.from({ length: 13 }, (_, i) => (i < 7 ? row(`NEW${i}`, 12345 + i, 40) : row(`OLD${i}`, SEED[i % 3], 100)));
    const check = placeholderPriceCheck(rows);
    assert.equal(check.placeholder, false, "below the panel's 'Yapılacak' threshold");
    const { problems, warnings } = priceProblems(check, false);
    assert.equal(problems.length, 1);
    assert.deepEqual(warnings, []);
    assert.match(problems[0].tr, /6\/13 fiyatlı varyant/);
    for (const sku of ["OLD7", "OLD8", "OLD12"]) assert.ok(problems[0].tr.includes(sku) && problems[0].en.includes(sku), sku);
    assert.doesNotMatch(problems[0].tr, /NEW\d/);
  });

  test("a single kept seed price refuses too; --allow-prices turns it into a warning that still lists it", () => {
    const check = placeholderPriceCheck([row("PR-LVL-500", 14990, 12), row("PR-LVL-5L", 52000, 12)]);
    assert.equal(priceProblems(check, false).problems[0].code, "prices");
    const allowed = priceProblems(check, true);
    assert.deepEqual(allowed.problems, []);
    assert.equal(allowed.warnings[0].code, "prices-allowed");
    assert.match(allowed.warnings[0].tr, /PR-LVL-500 149,90 TL/);
    assert.deepEqual(priceProblems(placeholderPriceCheck([row("A", 52000, 100)]), false), { problems: [], warnings: [] }, "stock 100 alone is fine");
  });
});

// ---------------------------------------------------------------------------------------------------
// F3

describe("F3: one seller rule for the panel and the scripts", () => {
  test("probe 4: complete except KEP and chamber -> both name the same three fields", () => {
    const general = parseSettings("general", { legalName: "X Ltd", address: { line: "a", district: "b", city: "c" }, phone: "1", email: "a@b.co", mersisNo: "1", taxOffice: "t", taxNumber: "1" });
    assert.deepEqual(missingSellerFields(general), ["KEP adresi", "meslek odası", "meslek kuralları bağlantısı"]);
    const [problem] = sellerProblems(general);
    assert.equal(problem.code, "seller");
    assert.match(problem.tr, /KEP adresi, meslek odası, meslek kuralları bağlantısı/);
    assert.match(problem.en, /KEP address, professional chamber, link to the chamber's professional rules/);
  });

  test("the district counts in both; a rules link the footer would not show (not https) counts as missing", () => {
    const ready = readyGeneral();
    assert.deepEqual(missingSellerFieldKeys(ready), []);
    assert.deepEqual(sellerProblems(ready), []);
    assert.deepEqual(missingSellerFieldKeys({ ...ready, address: { ...ready.address, district: " " } }), ["address"]);
    assert.deepEqual(missingSellerFieldKeys({ ...ready, chamber: { ...ready.chamber, rulesUrl: "http://example.org/kurallar" } }), ["chamberRules"]);
    for (const field of REQUIRED_SELLER_FIELDS) assert.ok(SELLER_FIELD_NAMES[field].tr && SELLER_FIELD_NAMES[field].en, field);
  });
});

// ---------------------------------------------------------------------------------------------------
// F8

describe("F8: legal placeholders", () => {
  test("probe 3: the editor's '[ad]' and a 113-character bracket refuse in the scripts too", () => {
    const long = `[${"Bu alan hukukçu tarafından sözleşmenin imzalanmasından önce belirlenmelidir ve boş bırakılmamalıdır, lütfen kontrol edin".slice(0, 113)}]`;
    const docs = approvedLegal().map((d) => (d.key === "kvkk" ? { ...d, body: { tr: `<p>Ad: [ad]</p><p>${long}</p>` } } : d));
    const { problems } = legalReadiness(docs);
    assert.deepEqual(problems.map((p) => p.code), ["legal-placeholder:kvkk"]);
    assert.match(problems[0].tr, /^KVKK Aydınlatma Metni: /, "the Turkish title, never the raw key (FIX B-F8)");
    assert.match(problems[0].en, /legal text "kvkk" \(KVKK Aydınlatma Metni\)/);
  });

  test("--allow-legal-brackets: brackets become warnings; the taslak label and the draft notice still refuse", () => {
    const docs = approvedLegal().map((d) =>
      d.key === "returns"
        ? { ...d, body: { tr: "<p>[Mülga: 6502 s. K. m.48]</p>" } }
        : d.key === "cookies"
          ? { ...d, version: "taslak-3" }
          : d,
    );
    const strict = legalReadiness(docs);
    assert.deepEqual(strict.problems.map((p) => p.code).sort(), ["legal-draft:cookies", "legal-placeholder:returns"]);
    const allowed = legalReadiness(docs, true);
    assert.deepEqual(allowed.problems.map((p) => p.code), ["legal-draft:cookies"]);
    assert.deepEqual(allowed.warnings.map((p) => p.code), ["legal-brackets-allowed:returns"]);
    assert.match(allowed.warnings[0].tr, /\[Mülga: 6502 s\. K\. m\.48\]/);
    const all = salesReadiness({ legal: docs, general: readyGeneral(), payments: readyPayments(), prices: placeholderPriceCheck([]), allowPrices: false, allowLegalBrackets: true });
    assert.deepEqual(all.problems.map((p) => p.code), ["legal-draft:cookies"]);
    assert.deepEqual(all.warnings.map((p) => p.code), ["legal-brackets-allowed:returns"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F6

describe("F6: a production copy needs a profile", () => {
  test("production without --profile is refused; rehearsal targets keep the plain copy", () => {
    assert.match(productionProfileProblem("production", null) ?? "", /--profile=sales/);
    assert.equal(productionProfileProblem("production", "sales"), null);
    assert.equal(productionProfileProblem("production", "showcase"), null);
    assert.equal(productionProfileProblem("rehearsal", null), null);
  });
});

// ---------------------------------------------------------------------------------------------------
// F11 / F5: the copy flow with stubbed connections

type Call = { text: string; values: unknown[] };
type FakeDb = Pool & { calls: Call[] };

/** A postgres.js-shaped stub: tagged-template queries and unsafe() answered by `answer`, every call recorded. */
function fakeDb(answer: (text: string) => unknown[]): FakeDb {
  const calls: Call[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$");
    calls.push({ text, values });
    return Promise.resolve(answer(text));
  };
  Object.assign(sql, {
    calls,
    unsafe: (text: string) => {
      calls.push({ text, values: [] });
      return Promise.resolve(answer(text));
    },
    begin: () => {
      calls.push({ text: "BEGIN", values: [] });
      return Promise.reject(new Error("the stub has no transactions"));
    },
    json: (value: unknown) => value,
    end: () => Promise.resolve(),
  });
  return sql as unknown as FakeDb;
}

/** The local source as today: draft legal texts with [placeholders], seller details missing, havale without IBAN, seed prices. */
function sourceAnswer(ready: boolean) {
  return (text: string): unknown[] => {
    if (text.includes("current_database()")) return [{ name: "prestij" }];
    if (text.includes("from legal_documents")) {
      return ready ? approvedLegal() : SALES_LEGAL_KEYS.map((key) => ({ key, version: "taslak-1", body: { tr: "<p>[e-posta adresi]</p>" } }));
    }
    if (text.includes("from settings where key in ('general', 'payments')")) {
      return ready
        ? [
            { key: "general", value: readyGeneral() },
            { key: "payments", value: readyPayments() },
          ]
        : [];
    }
    if (text.includes("from settings where key =")) return [{ value: { cartSampleEnabled: true, requestFormEnabled: true, maxPerOrder: 2, minOrderTotal: 0 } }];
    if (text.includes("from product_variants")) {
      return ready ? [row("PR-LVL-500", 18990, 40)] : Array.from({ length: 13 }, (_, i) => row(`PR-${i}`, SEED[i % 3], 100));
    }
    return [];
  };
}

const salesArgs = (patch: Partial<CopyArgs> = {}): CopyArgs => ({ dryRun: false, profile: "sales", allowPrices: false, keepSamples: false, allowLegalBrackets: false, ...patch });

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("F11: copy-content refuses an unready shop before the target is touched", () => {
  for (const dryRun of [true, false]) {
    test(`${dryRun ? "dry run" : "copy"}: Refusal, and not a single statement reached the target`, async () => {
      const src = fakeDb(sourceAnswer(false));
      const dst = fakeDb(() => {
        throw new Error("the target must not be queried");
      });
      const state: CopyState = { phase: "copying" };
      await assert.rejects(
        quietly(() =>
          runCopy({ args: salesArgs({ dryRun }), src, dst, journal: ["0000_x"], databases: { source: "prestij", target: "postgres" }, targetLabel: "production test", state }),
        ),
        (error: unknown) => error instanceof Refusal && /hiçbir şey yazılmadı \/ the sales profile was refused, nothing was written/.test(error.message),
      );
      assert.deepEqual(dst.calls, [], "no statement, no BEGIN on the target");
      assert.ok(src.calls.some((c) => c.text.includes("from legal_documents")), "the readiness rules read the source");
      assert.ok(!src.calls.some((c) => c.text === "BEGIN"), "no copy snapshot was opened");
      assert.equal(state.phase, "copying");
    });
  }

  test("a ready shop passes the gate and only then reaches the target preflight", async () => {
    const src = fakeDb(sourceAnswer(true));
    const dst = fakeDb((text) => (text.includes("current_database()") ? [{ name: "elsewhere" }] : []));
    await assert.rejects(
      quietly(() => runCopy({ args: salesArgs({ dryRun: true }), src, dst, journal: ["0000_x"], databases: { source: "prestij", target: "postgres" }, targetLabel: "t", state: { phase: "copying" } })),
      /target: connected to database "elsewhere"/,
    );
    assert.equal(dst.calls.length, 1, "the first target statement comes after the gate: the database check");
  });

  test("--allow-prices lets the seed prices through as a warning (the other rules still refuse)", async () => {
    const src = fakeDb(sourceAnswer(false));
    const dst = fakeDb(() => []);
    await assert.rejects(
      quietly(() => runCopy({ args: salesArgs({ allowPrices: true }), src, dst, journal: [], databases: { source: "prestij", target: "postgres" }, targetLabel: "t", state: { phase: "copying" } })),
      Refusal,
    );
    assert.deepEqual(dst.calls, []);
  });
});

describe("F5: the readiness rules run again on the copied content", () => {
  test("not ready inside the transaction: Refusal (the copy rolls back); ready: resolves", async () => {
    await assert.rejects(
      quietly(() => assertCopiedContentReady(fakeDb(sourceAnswer(false)), { allowPrices: false, allowLegalBrackets: false })),
      (error: unknown) => error instanceof Refusal && /the copy was rolled back, nothing was committed/.test(error.message),
    );
    await quietly(() => assertCopiedContentReady(fakeDb(sourceAnswer(true)), { allowPrices: false, allowLegalBrackets: false }));
  });
});

// ---------------------------------------------------------------------------------------------------
// F4 / B-F9

describe("F4: the havale day count stored with the order", () => {
  test("orderPaymentDays: the stored count wins (clamped), the setting only for orders without one", () => {
    assert.equal(orderPaymentDays({ bankTransferDays: 3 }, 5), 3);
    assert.equal(orderPaymentDays({ bankTransferDays: 40 }, 5), BANK_TRANSFER_PAYMENT_DAYS.max);
    assert.equal(orderPaymentDays({}, 5), 5);
    assert.equal(orderPaymentDays(null, 2), 2);
    assert.equal(orderPaymentDays({ bankTransferDays: "7" }, 2), 2, "only a number counts");
    // The scenario: placed 10 Nov with 3 days, setting changed to 5 later: the order keeps 13 Nov.
    const placed = new Date("2026-11-10T09:00:00Z");
    assert.equal(bankTransferDeadline(placed, orderPaymentDays({ bankTransferDays: 3 }, 5)).toISOString(), "2026-11-13T20:59:59.999Z");
  });

  test("istanbulDayStart: 00:00 Istanbul (21:00Z the day before)", () => {
    assert.equal(istanbulDayStart(new Date("2026-11-13T21:00:00Z")).toISOString(), "2026-11-13T21:00:00.000Z");
    assert.equal(istanbulDayStart(new Date("2026-11-13T20:59:59Z")).toISOString(), "2026-11-12T21:00:00.000Z");
  });
});

describe("B-F9: launch checklist groups", () => {
  const base: LaunchChecklistInput = { origin: "https://prestij.com.tr", verification: { google: "", bing: "", yandex: "" }, socialLinks: 0, indexNow: "missing", address: "" };

  test("three groups in order; the wheel steps do not sit in 'before'; every step has a known group", () => {
    assert.deepEqual(LAUNCH_GROUPS.map((g) => g.key), ["before", "wheel", "after"]);
    assert.deepEqual(LAUNCH_GROUPS.map((g) => g.title), ["Yayından önce (satışla birlikte açılış)", "Çarkı açmadan önce", "Yayından sonra"]);
    const steps = launchChecklist({ ...base, bankTransfer: { enabled: true, accounts: 1, usableAccounts: 1, paymentDays: 3 } });
    const byGroup = (g: string) => steps.filter((s) => s.group === g).map((s) => s.key);
    assert.deepEqual(byGroup("before"), ["media-storage", "seller-identity", "checkout-contracts", "email-sending", "site-url", "cron-secret", "admin-recipients", "real-prices", "bank-transfer", "shipping-settings"]);
    assert.deepEqual(byGroup("wheel"), ["gift-wheel-slices", "wheel-terms-review"]);
    assert.equal(byGroup("after").length, 8);
    for (const s of steps) assert.ok(LAUNCH_GROUPS.some((g) => g.key === s.group), s.key);
  });

  test("no showcase (vitrin) alternative is offered any more", () => {
    const text = JSON.stringify([LAUNCH_GROUPS, launchChecklist(base)]).toLocaleLowerCase("tr-TR");
    assert.ok(!text.includes("vitrin"), "the owner launches with sales");
  });
});
