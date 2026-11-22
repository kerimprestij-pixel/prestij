// Go-live FINAL fixes, pure parts:
//   GC-1  the legal editor's suggested version labels follow the draft notice ("taslak-N" while it is on, an
//         approved-form label such as "2026-11 v1" once it is off), so an approved sales contract is not
//         published under a "taslak…" label by accident (that label keeps the checkout closed); the launch
//         checklist's "Satış sözleşmeleri onaylı" step applies the checkout's own rule;
//   GC-3  the closed-checkout notice does not invite orders by phone or e-mail and promises no cart forever.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import en from "@/i18n/messages/en";
import ar from "@/i18n/messages/ar";
import tr from "@/i18n/messages/tr";
import { checkoutLegalReady } from "@/lib/orders/legal-ready";
import { isDraftLegalVersion } from "@/lib/panel/legal/draft";
import { approvedVersionLabel, legalVersionSuggestions, suggestNextVersion, VERSION_MAX, versionLabelInput } from "@/lib/panel/legal/schemas";
import { checkoutContractsApproved, isDraftLegalVersion as launchIsDraft, launchChecklist, type LaunchChecklistInput } from "@/lib/panel/seo/launch";

// 2026-11-30 22:30 UTC is already 1 December in Istanbul (UTC+3).
const LATE_NOVEMBER_UTC = new Date("2026-11-30T22:30:00Z");
const MID_NOVEMBER = new Date("2026-11-14T10:00:00Z");

describe("GC-1: version label suggestions", () => {
  test("the approved form is the Istanbul month plus the first free v-number", () => {
    assert.equal(approvedVersionLabel(MID_NOVEMBER), "2026-11 v1");
    assert.equal(approvedVersionLabel(LATE_NOVEMBER_UTC), "2026-12 v1", "Istanbul time, not UTC");
    assert.equal(approvedVersionLabel(MID_NOVEMBER, ["taslak-1", "2026-11 V1"]), "2026-11 v2", "used labels are skipped (case-insensitive)");
    const label = approvedVersionLabel(MID_NOVEMBER);
    assert.equal(isDraftLegalVersion(label), false);
    assert.ok(label.length <= VERSION_MAX);
    assert.equal(versionLabelInput.safeParse(label).success, true, "the publish schema accepts it");
  });

  test("after a seeded draft: approved '2026-11 v1', draft 'taslak-2' (the old single suggestion)", () => {
    const s = legalVersionSuggestions("taslak-1", ["taslak-1"], MID_NOVEMBER);
    assert.deepEqual(s, { approved: "2026-11 v1", draft: "taslak-2" });
    assert.equal(s.draft, suggestNextVersion("taslak-1", ["taslak-1"]), "suggestNextVersion itself is unchanged");
    // The checkout opens only with the approved label on both contracts.
    const doc = (version: string) => ({ key: "pre_information", version, title: { tr: "x" }, body: { tr: "<p>x</p>" } });
    assert.equal(checkoutLegalReady({ preInformation: doc(s.draft), distanceSales: doc(s.draft) }), false);
    assert.equal(checkoutLegalReady({ preInformation: doc(s.approved), distanceSales: doc(s.approved) }), true);
  });

  test("after an approved version: the next approved label increments, a new draft gets the next free taslak number", () => {
    assert.deepEqual(legalVersionSuggestions("2026-11 v1", ["taslak-1", "taslak-2", "2026-11 v1"], MID_NOVEMBER), { approved: "2026-11 v2", draft: "taslak-3" });
    assert.deepEqual(legalVersionSuggestions("v1.9", ["v1.9"], MID_NOVEMBER), { approved: "v1.10", draft: "taslak-1" });
  });

  test("no version yet: both forms are offered", () => {
    assert.deepEqual(legalVersionSuggestions(null, [], MID_NOVEMBER), { approved: "2026-11 v1", draft: "taslak-1" });
    assert.deepEqual(legalVersionSuggestions("  ", [], MID_NOVEMBER), { approved: "2026-11 v1", draft: "taslak-1" });
  });

  test("isDraftLegalVersion lives in one tiny module; launch.ts re-exports the same function", () => {
    assert.equal(launchIsDraft, isDraftLegalVersion);
    for (const v of ["taslak-2", "TASLAK 2", " Taslak-9"]) assert.equal(isDraftLegalVersion(v), true, v);
    for (const v of ["2026-11 v1", "v2", "onaylı taslak"]) assert.equal(isDraftLegalVersion(v), false, v);
  });
});

describe("GC-1: launch checklist step 'Satış sözleşmeleri onaylı'", () => {
  const base: LaunchChecklistInput = {
    origin: "https://www.prestij.example",
    verification: { google: "", bing: "", yandex: "" },
    socialLinks: 0,
    indexNow: "missing",
    address: "",
  };
  const step = (input: Partial<LaunchChecklistInput>) => {
    const found = launchChecklist({ ...base, ...input }).find((s) => s.key === "checkout-contracts");
    assert.ok(found);
    return found;
  };

  test("sits right after the seller identity step and links to Yasal Metinler", () => {
    const keys = launchChecklist(base).map((s) => s.key);
    assert.equal(keys.indexOf("checkout-contracts"), keys.indexOf("seller-identity") + 1);
    const s = step({});
    assert.equal(s.done, null, "no badge without the input");
    assert.equal(s.panelHref, "/panel/yasal");
    assert.equal(s.title, "Satış sözleşmeleri onaylı");
  });

  test("open while a contract is missing or labelled taslak, with the reason; done with approved labels", () => {
    const drafts = step({ checkoutContracts: { preInformation: "taslak-1", distanceSales: "taslak-1" } });
    assert.equal(drafts.done, false);
    assert.ok(drafts.steps.some((l) => l.includes("Ön Bilgilendirme Formu") && l.includes("“taslak-1”")));
    assert.ok(drafts.steps.some((l) => l.includes("Mesafeli Satış Sözleşmesi") && l.includes("taslak sayılıyor")));
    const missing = step({ checkoutContracts: { preInformation: null, distanceSales: "2026-11 v1" } });
    assert.equal(missing.done, false);
    assert.ok(missing.steps.some((l) => l.includes("yürürlükte bir sürümü yok")));
    assert.equal(step({ checkoutContracts: { preInformation: "2026-11 v1", distanceSales: "2026-11 v1" } }).done, true);
    assert.equal(checkoutContractsApproved({ preInformation: "2026-11 v1", distanceSales: "TASLAK 2" }), false);
  });

  test("the rule equals checkoutLegalReady for every combination", () => {
    const labels = [null, "taslak-1", "Taslak 2", "2026-11 v1"];
    for (const a of labels) {
      for (const b of labels) {
        const doc = (version: string | null) => (version === null ? null : { key: "pre_information", version, title: { tr: "x" }, body: { tr: "<p>x</p>" } });
        assert.equal(
          checkoutContractsApproved({ preInformation: a, distanceSales: b }),
          checkoutLegalReady({ preInformation: doc(a), distanceSales: doc(b) }),
          `${a} / ${b}`,
        );
      }
    }
  });

  test("plain formal Turkish, no exclamation marks", () => {
    const text = JSON.stringify(step({ checkoutContracts: { preInformation: "taslak-1", distanceSales: null } }));
    assert.ok(!text.includes("!"));
    assert.match(text, /yayınlayın/);
  });
});

describe("GC-3: closed-checkout notice", () => {
  test("invites questions, not orders by phone or e-mail, and promises the cart only for a while", () => {
    assert.equal(tr.checkout.page.closedText, "Satış sözleşmelerimiz hazırlanıyor; bu süre içinde siteden sipariş alamıyoruz. Sepetiniz bir süre saklanır. Sorularınız için bize ulaşabilirsiniz.");
    assert.doesNotMatch(tr.checkout.page.closedText, /Sipariş vermek/);
    assert.doesNotMatch(en.checkout.page.closedText, /place an order/i);
    assert.match(en.checkout.page.closedText, /kept for a while/);
    assert.doesNotMatch(ar.checkout.page.closedText, /للطلب/);
    assert.match(ar.checkout.page.closedText, /لفترة/);
    assert.equal(tr.checkout.page.closedContact, "Bize ulaşın");
  });
});
