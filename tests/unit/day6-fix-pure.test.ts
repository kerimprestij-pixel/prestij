// Day 6 FIX: the pure parts of the review fixes.
//   D1/D2   Turkish wheel and wheel e-mail texts in "siz"; at most one exclamation mark per text (tr/en/ar);
//   COR-2   the hold end frozen in the spin's prize snapshot (a later holdDays change never moves it);
//   UX-8    validity in days for whole days of 2 or more;
//   SEO-3   a storage refusal of the direct upload is never "session expired";
//   SEO-4   a saved slice whose prize changed gets a new key at save time;
//   UX-7    labels the phone wheel would draw too small;
//   UX-11   which queued uploads can still be cancelled;
//   COR-6   the device prize hint can be dropped;
//   SEO-1   the launch checklist keeps the wheel off while its terms are a draft.
//   npx tsx --test tests/unit/day6-fix-pure.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { putFailureMessage, SESSION_ERROR } from "@/components/panel/media/upload-errors";
import { canCancelUpload } from "@/components/panel/media/upload-queue-model";
import { WHEEL_DIALOG_FALLBACK } from "@/components/store/wheel/labels";
import { parseWheelStore, withoutPrize, withPrize } from "@/components/store/wheel/wheel-storage";
import { defaultMessages } from "@/i18n/messages";
import { rekeyChangedSlices, slicePrizeChanged, slicePrizeSignature, tinySliceLabels } from "@/lib/panel/gift-wheel/slices";
import { launchChecklist, type LaunchChecklistInput } from "@/lib/panel/seo/launch";
import { isSpinHeld, spinHoldUntil, spinHoldUntilOf } from "@/lib/wheel/eligibility";
import { prizeSnapshot, validityText } from "@/lib/wheel/prize";
import { GIFT_WHEEL_DEFAULT_SLICES, type GiftWheelSlice } from "@/lib/wheel/types";

const DAY = 86_400_000;
const LOCALES = ["tr", "en", "ar"] as const;

/** Every string leaf of an object, with its dotted path. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

describe("D1 / D2: wheel copy", () => {
  // Second-person singular ("sen") words that must not appear in sentence texts any more. Unicode-aware word
  // edges (an ASCII word boundary would split "kazandığınız" right after "kazandığın").
  const SEN_WORDS = [
    "hediyen",
    "hediyeni",
    "kodun",
    "seni",
    "misin",
    "kazandın",
    "kazandığın",
    "aldın",
    "çevirdin",
    "olursun",
    "bulabilirsin",
    "tanımlayabilirsin",
    "dene",
    "hesabına",
    "sepetine",
    "sepetinde",
    "kaldır",
    "alıyorsun",
    "girebilirsin",
    "üye ol",
    "giriş yap",
  ];
  const SEN = SEN_WORDS.map((w) => new RegExp(String.raw`(?<!\p{L})` + w + String.raw`(?!\p{L})`, "iu"));
  const tr = [...leaves(defaultMessages.tr.wheel, "wheel"), ...leaves(defaultMessages.tr.email.wheel, "email.wheel")];

  test("the Turkish wheel and wheel e-mail texts use formal 'siz'", () => {
    for (const [path, text] of tr) {
      for (const pattern of SEN) assert.doesNotMatch(text, pattern, `${path}: ${text}`);
    }
    // First-person buttons stay (lead decision D1).
    assert.equal(defaultMessages.tr.wheel.claim.claimCta, "Hediyemi al");
    assert.equal(defaultMessages.tr.email.wheel.prize.button, "Sepetime git");
    // Typical siz forms are there.
    assert.match(defaultMessages.tr.wheel.dialog.terms, /olursunuz/);
    assert.match(defaultMessages.tr.wheel.errors.network, /deneyin\.$/);
    assert.match(defaultMessages.tr.email.wheel.prize.intro, /kazandığınız .* hesabınıza/);
  });

  test("the offline fallback still equals the dictionary", () => {
    for (const l of LOCALES) assert.equal(WHEEL_DIALOG_FALLBACK[l].network, defaultMessages[l].wheel.errors.network);
  });

  test("at most one exclamation mark per text (D2), only in a greeting or a thank-you", () => {
    for (const l of LOCALES) {
      for (const [path, text] of [...leaves(defaultMessages[l].wheel, "wheel"), ...leaves(defaultMessages[l].email.wheel, "email.wheel")]) {
        const marks = (text.match(/!/g) ?? []).length;
        assert.ok(marks <= 1, `${l} ${path}: ${text}`);
        if (marks === 1) assert.ok(["wheel.result.title", "wheel.account.used"].includes(path), `${l} ${path}: only greetings and thanks`);
      }
    }
  });

  test("new keys exist with the same placeholders in tr/en/ar", () => {
    for (const l of LOCALES) {
      const w = defaultMessages[l].wheel;
      assert.match(w.result.pending, /\{date\}/, l);
      assert.match(w.banner.verify, /\{date\}/, l);
      assert.match(w.account.pending, /\{date\}/, l);
      assert.match(w.result.validityDays, /\{days/, l);
      assert.match(w.dialog.minOrderNote, /\{list\}/, l);
      assert.match(w.dialog.minOrderItem, /\{prize\}/, l);
      assert.match(w.dialog.minOrderItem, /\{amount\}/, l);
      assert.ok(w.result.checkInbox.trim(), l);
      // UX-4: the account card's text no longer promises an unconditional auto-apply.
      assert.doesNotMatch(w.account.active, /; sepette otomatik uygulanır|applied automatically in your cart/);
    }
    // UX-8: "bağlantı" alone reads as "link"; the subtitle says gift, not discount (free shipping is a prize too).
    assert.match(defaultMessages.tr.wheel.errors.spin_limit, /^Bu internet bağlantısından/);
    assert.match(defaultMessages.tr.wheel.dialog.subtitle, /hediyeyi/);
    assert.match(defaultMessages.en.wheel.dialog.subtitle, /the gift you win/);
    assert.match(defaultMessages.ar.wheel.dialog.subtitle, /الهدية التي تربحها/);
    assert.match(defaultMessages.tr.wheel.dialog.everySliceWins, /herkes bir kez/);
  });
});

describe("COR-2: the hold end is frozen with the spin", () => {
  const createdAt = new Date("2026-11-09T03:15:00Z");
  const frozen = { createdAt, prize: { holdUntil: spinHoldUntil(createdAt, 7).toISOString() } };
  const legacy = { createdAt, prize: {} };
  const now = new Date("2026-11-12T12:00:00Z"); // 3.4 days after the spin

  test("the snapshot's end wins over the current holdDays; older rows fall back to it", () => {
    assert.equal(spinHoldUntilOf(frozen, 2).toISOString(), "2026-11-16T03:15:00.000Z");
    assert.equal(spinHoldUntilOf(frozen, 14).toISOString(), "2026-11-16T03:15:00.000Z");
    assert.equal(spinHoldUntilOf(legacy, 2).toISOString(), "2026-11-11T03:15:00.000Z");
    assert.equal(spinHoldUntilOf({ createdAt, prize: { holdUntil: "nope" } }, 7).toISOString(), "2026-11-16T03:15:00.000Z");
  });

  test("lowering holdDays does not void a held spin; raising it does not promise more than the cookie lives", () => {
    assert.equal(isSpinHeld({ status: "bound", couponId: null, ...frozen }, 2, now), true);
    assert.equal(isSpinHeld({ status: "spun", couponId: null, ...legacy }, 2, now), false);
    assert.equal(isSpinHeld({ status: "spun", couponId: null, ...frozen }, 14, new Date(Date.parse("2026-11-16T03:15:00Z") + 1)), false);
    assert.equal(isSpinHeld({ status: "claimed", couponId: 5, ...frozen }, 7, now), false);
  });

  test("the prize snapshot itself carries no time (the spin adds holdUntil)", () => {
    assert.equal("holdUntil" in prizeSnapshot(GIFT_WHEEL_DEFAULT_SLICES[0]), false);
  });
});

describe("UX-8: validity in days", () => {
  test("whole days of two or more read in days, everything else in hours", () => {
    const r = (l: (typeof LOCALES)[number]) => defaultMessages[l].wheel.result;
    assert.equal(validityText(72, "tr", r("tr")), "Hesabınıza tanımlandıktan sonra 3 gün geçerli.");
    assert.equal(validityText(720, "tr", r("tr")), "Hesabınıza tanımlandıktan sonra 30 gün geçerli.");
    assert.equal(validityText(24, "tr", r("tr")), "Hesabınıza tanımlandıktan sonra 24 saat geçerli.");
    assert.equal(validityText(60, "en", r("en")), "Valid for 60 hours after it is added to your account.");
    assert.equal(validityText(48, "en", r("en")), "Valid for 2 days after it is added to your account.");
    assert.match(validityText(96, "ar", r("ar")), /4 أيام/);
  });
});

describe("SEO-3: refused file PUTs", () => {
  test("401 is 'session expired' only from our own route", () => {
    assert.equal(putFailureMessage("/panel/api/media/uploads/local?ticket=x", 401, ""), SESSION_ERROR);
    const storage = putFailureMessage("https://abc.supabase.co/storage/v1/object/upload/sign/media/k?token=t", 401, JSON.stringify({ message: "No API key found in request" }));
    assert.notEqual(storage, SESSION_ERROR);
    assert.match(storage, /^Depolama dosyayı reddetti \(HTTP 401\): No API key found in request\. /);
    assert.match(storage, /Fotoğraf ve video depolama/);
  });

  test("storage bodies: message, else error, else nothing; our own route keeps its JSON error", () => {
    assert.match(putFailureMessage("https://x/", 400, JSON.stringify({ error: "invalid_mime_type" })), /\(HTTP 400\): invalid_mime_type\./);
    assert.match(putFailureMessage("https://x/", 500, "<html>oops</html>"), /^Depolama dosyayı reddetti \(HTTP 500\)\. /);
    assert.equal(putFailureMessage("https://x/", 413, ""), "Dosya depolamanın boyut sınırını aşıyor.");
    assert.equal(putFailureMessage("/panel/api/media/uploads/local", 400, JSON.stringify({ error: "Dosya bozuk." })), "Dosya bozuk.");
    assert.match(putFailureMessage("/panel/api/media/uploads/local", 502, "x"), /^Dosya gönderilemedi \(HTTP 502\)/);
    assert.ok(putFailureMessage("https://x/", 400, JSON.stringify({ message: "a".repeat(500) })).length < 400, "long storage text is cut");
  });
});

describe("SEO-4: a changed prize gets a new key at save time", () => {
  const saved: GiftWheelSlice[] = GIFT_WHEEL_DEFAULT_SLICES.map((s) => ({ ...s, label: { ...s.label } }));

  test("type, value or minimum basket change → new key from the label; label, weight and tone changes keep it", () => {
    const edited = saved.map((s) => ({ ...s, label: { ...s.label } }));
    edited[1] = { ...edited[1], value: 25, label: { tr: "%25 indirim", en: "25% off", ar: "خصم 25%" } };
    edited[2] = { ...edited[2], weight: 99, tone: "ink", label: { tr: "Kargo bizden" } };
    edited[4] = { ...edited[4], minOrderTotal: 40000 };
    assert.equal(slicePrizeChanged(saved, edited[1]), true);
    assert.equal(slicePrizeChanged(saved, edited[2]), false);
    const next = rekeyChangedSlices(saved, edited);
    assert.equal(next[1].key, "25-indirim");
    assert.equal(next[2].key, "ucretsiz-kargo");
    assert.notEqual(next[4].key, "indirim-50-tl");
    assert.ok(!saved.some((s) => s.key === next[4].key), "never a saved slice's key");
    assert.equal(new Set(next.map((s) => s.key)).size, next.length, "keys stay unique");
    assert.equal(rekeyChangedSlices(saved, saved), saved, "nothing changed → same array");
  });

  test("a label that collides gets a suffix; free shipping ignores its value", () => {
    const edited = saved.map((s) => ({ ...s }));
    edited[0] = { ...edited[0], value: 15, label: { tr: "%15 indirim" } };
    const next = rekeyChangedSlices(saved, edited);
    assert.match(next[0].key, /^15-indirim(-\d+)?$/);
    assert.equal(slicePrizeSignature({ type: "free_shipping", value: 7, minOrderTotal: 0 }), slicePrizeSignature({ type: "free_shipping", value: 0, minOrderTotal: 0 }));
  });
});

describe("UX-7: labels too small for a phone", () => {
  test("the default labels fit; long or unbreakable ones are flagged per language", () => {
    const tr = GIFT_WHEEL_DEFAULT_SLICES.map((s) => s.label.tr);
    assert.deepEqual(tinySliceLabels({ tr, en: GIFT_WHEEL_DEFAULT_SLICES.map((s) => s.label.en ?? "") }), tr.map(() => []));
    const long = [...tr.slice(0, 5), "Ücretsiz kargo ve %5 indirim birlikte", "Bir", "İki"];
    const flagged = tinySliceLabels({ tr: long });
    assert.deepEqual(flagged[5], ["tr"]);
    assert.deepEqual(flagged[0], []);
    const word = tinySliceLabels({ en: ["Supercalifragilisticexpialidocious", "a", "b", "c"] });
    assert.deepEqual(word[0], ["en"]);
  });
});

describe("UX-11: cancellable uploads", () => {
  test("waiting and uploading files can be cancelled until their bytes are up", () => {
    assert.equal(canCancelUpload({ status: "waiting", phase: null, progress: 0 }), true);
    assert.equal(canCancelUpload({ status: "uploading", phase: "preparing", progress: 0 }), true);
    assert.equal(canCancelUpload({ status: "uploading", phase: "uploading", progress: 0.4 }), true);
    assert.equal(canCancelUpload({ status: "uploading", phase: "uploading", progress: 1 }), false);
    assert.equal(canCancelUpload({ status: "uploading", phase: "processing", progress: 1 }), false);
    assert.equal(canCancelUpload({ status: "done", phase: null, progress: 1 }), false);
    assert.equal(canCancelUpload({ status: "cancelled", phase: null, progress: 0 }), false);
  });
});

describe("COR-6: the device prize hint", () => {
  test("withoutPrize forgets the label and keeps the other hints", () => {
    const store = withPrize({ sig: "s", collapsed: true, promptedAt: 5 }, { label: "%10 indirim", holdUntil: "2026-11-20T00:00:00Z" });
    const next = withoutPrize(store);
    assert.deepEqual(next, { sig: "s", collapsed: true, promptedAt: 5 });
    assert.equal(parseWheelStore(JSON.stringify(next), "s").prize, undefined);
  });
});

describe("SEO-1: the wheel stays off while its terms are a draft", () => {
  const base: LaunchChecklistInput = {
    origin: "https://prestij.com.tr",
    verification: { google: "", bing: "", yandex: "" },
    socialLinks: 0,
    indexNow: "missing",
    address: "Kayseri",
  };
  const slices = (input: Partial<LaunchChecklistInput>) => launchChecklist({ ...base, ...input }).find((s) => s.key === "gift-wheel-slices")!;

  test("wheel on + draft terms → switch it off before launch; approved terms → the old optional note", () => {
    assert.ok(slices({ giftWheelEnabled: true, wheelTermsVersion: "taslak-1" }).steps.some((l) => /yayına almadan önce .* çarkı kapatın/.test(l)));
    assert.ok(slices({ giftWheelEnabled: true, wheelTermsVersion: null }).steps.some((l) => /avukat onaylı değil/.test(l)));
    assert.ok(slices({ giftWheelEnabled: true, wheelTermsVersion: "2026-12 v1" }).steps.some((l) => /kapatmak isterseniz/.test(l)));
    assert.ok(!slices({ giftWheelEnabled: false, wheelTermsVersion: "taslak-1" }).steps.some((l) => /avukat onaylı değil/.test(l)));
  });

  test("the storage step quotes the message the panel really shows", () => {
    const storage = launchChecklist(base).find((s) => s.key === "media-storage")!;
    assert.ok(storage.steps.some((l) => l.includes("Depolama dosyayı reddetti (HTTP 401)")));
    assert.ok(!storage.steps.some((l) => l.includes("“apikey” eksik")));
  });
});

test("DAY constant sanity (keeps the helpers honest)", () => {
  assert.equal(spinHoldUntil(new Date(0), 1).getTime(), DAY);
});
