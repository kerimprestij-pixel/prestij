// Day 6 follow-up, lead decision D14 (UX-3: dismissal reset by any panel edit): the per-device hints in
// localStorage `prestij:wheel`. "Bir daha gösterme" (hiddenUntil), the auto-open cooldown (promptedAt) and
// the closed chip (chipHiddenUntil) survive panel edits while the round is unchanged; only a new round
// ("Yeni tur başlat") resets them. The minimized icon (collapsed) and the held-prize hint stay tied to the
// full signature. Checked with the real signature function (wheel-teaser.ts) and the launcher's write path
// (parse → change → JSON, as WheelLauncher's updateStore does).
//   npx tsx --test tests/unit/day6-decide-wheel-store.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wheelTeaserSignature } from "@/components/store/wheel/wheel-teaser";
import {
  canAutoOpen,
  heldPrize,
  isChipHidden,
  isTeaserHidden,
  parseWheelStore,
  wheelSignatureRound,
  withChipHidden,
  withNeverShow,
  withPrize,
  withPrompted,
  type WheelStore,
} from "@/components/store/wheel/wheel-storage";
import { defaultGiftWheelSlices, parseSettings } from "@/lib/settings/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);

/** The settings the signature reads, as the panel saves them. */
const settings = (over: Partial<ReturnType<typeof parseSettings<"giftWheel">>> = {}) => ({ ...parseSettings("giftWheel", { enabled: true }), enabled: true, ...over });
const sig = (over: Partial<ReturnType<typeof parseSettings<"giftWheel">>> = {}) => wheelTeaserSignature(settings(over));

/** WheelLauncher's write path: parse the stored JSON for the current signature, change, store. */
const write = (raw: string | null, signature: string, change: (s: WheelStore) => WheelStore) => JSON.stringify(change(parseWheelStore(raw, signature)));

describe("D14: the round part of a signature", () => {
  test('"<round>.<hash>" → the round; anything else → null', () => {
    assert.equal(wheelSignatureRound("3.k2j9xq"), "3");
    assert.equal(wheelSignatureRound("12.0"), "12");
    assert.equal(wheelSignatureRound(sig({ round: 7 })), "7");
    for (const bad of ["k2j9xq", ".abc", "3", "", null, undefined, 3, { sig: "3.a" }]) assert.equal(wheelSignatureRound(bad), null, String(bad));
  });

  test("the teaser signature keeps its round prefix when a slice label is edited, and changes it with the round", () => {
    const before = sig();
    const slices = defaultGiftWheelSlices();
    slices[0] = { ...slices[0], label: { ...slices[0].label, tr: "%5 indirim fırsatı" } };
    const edited = sig({ slices });
    assert.notEqual(edited, before, "an edit changes the signature (the wheel's new face shows)");
    assert.equal(wheelSignatureRound(edited), wheelSignatureRound(before));
    assert.equal(wheelSignatureRound(sig({ round: 2 })), "2");
  });
});

describe("D14: what survives a panel edit of the same round", () => {
  const OLD = "4.aaaa";
  const EDITED = "4.bbbb";
  const NEXT_ROUND = "5.aaaa";
  const stored = JSON.stringify({
    sig: OLD,
    collapsed: true,
    hiddenUntil: NOW + 20 * DAY,
    promptedAt: NOW - DAY,
    chipHiddenUntil: NOW + DAY / 2,
    prize: { label: "%10 indirim", holdUntil: new Date(NOW + 3 * DAY).toISOString() },
  });

  test("the same signature keeps every hint", () => {
    const store = parseWheelStore(stored, OLD);
    assert.equal(store.collapsed, true);
    assert.ok(store.prize);
    assert.equal(store.hiddenUntil, NOW + 20 * DAY);
  });

  test("an edited wheel (same round) keeps never-show, the auto-open cooldown and the closed chip; the icon and the prize hint start over", () => {
    const store = parseWheelStore(stored, EDITED);
    assert.deepEqual(store, { sig: EDITED, hiddenUntil: NOW + 20 * DAY, promptedAt: NOW - DAY, chipHiddenUntil: NOW + DAY / 2 });
    assert.equal(isTeaserHidden(store, NOW), true, '"Bir daha gösterme" still holds after the edit');
    assert.equal(canAutoOpen(store, NOW, 7), false, "no automatic opening inside the cooldown");
    assert.equal(isChipHidden(store, NOW), true);
    assert.equal(heldPrize(store, NOW), null, "the held-prize hint follows the full signature");
  });

  test("a new round starts everything over", () => {
    const store = parseWheelStore(stored, NEXT_ROUND);
    assert.deepEqual(store, { sig: NEXT_ROUND });
    assert.equal(isTeaserHidden(store, NOW), false);
    assert.equal(canAutoOpen(store, NOW, 7), true);
  });

  test("wrong types are still dropped, and a stored value without a round prefix starts over", () => {
    assert.deepEqual(parseWheelStore(JSON.stringify({ sig: OLD, hiddenUntil: "soon", promptedAt: null }), EDITED), { sig: EDITED });
    assert.deepEqual(parseWheelStore(JSON.stringify({ sig: "legacy", hiddenUntil: NOW + DAY }), EDITED), { sig: EDITED });
    assert.deepEqual(parseWheelStore(JSON.stringify({ sig: 4, hiddenUntil: NOW + DAY }), EDITED), { sig: EDITED });
    assert.deepEqual(parseWheelStore(JSON.stringify({ hiddenUntil: NOW + DAY }), EDITED), { sig: EDITED });
  });

  test("the launcher's next write saves the kept hints under the new signature", () => {
    const next = write(stored, EDITED, (s) => withPrompted(s, NOW));
    const saved = JSON.parse(next) as WheelStore;
    assert.equal(saved.sig, EDITED);
    assert.equal(saved.hiddenUntil, NOW + 20 * DAY);
    assert.equal(saved.promptedAt, NOW);
    assert.equal(saved.collapsed, undefined);
    assert.deepEqual(parseWheelStore(next, EDITED), saved, "read back unchanged");
  });
});

describe("D14: the whole flow with real signatures (a slice label edited, then a new round)", () => {
  test('"Bir daha gösterme" survives the label edit and goes with "Yeni tur başlat"', () => {
    const round1 = sig({ round: 1 });
    // The visitor hides the wheel for 30 days, then later closes the chip; both under the first signature.
    let raw = write(null, round1, (s) => withNeverShow(s, NOW));
    raw = write(raw, round1, (s) => withChipHidden(s, NOW));
    raw = write(raw, round1, (s) => withPrize(s, { label: "%5 indirim", holdUntil: new Date(NOW + DAY).toISOString() }));

    // The owner edits a slice label in Ayarlar and saves (same round): the signature changes.
    const slices = defaultGiftWheelSlices();
    slices[1] = { ...slices[1], label: { ...slices[1].label, tr: "%10 indirim kazanın" } };
    const edited = sig({ round: 1, slices });
    assert.notEqual(edited, round1);
    const afterEdit = parseWheelStore(raw, edited);
    assert.equal(isTeaserHidden(afterEdit, NOW + 29 * DAY), true, "still hidden on day 29");
    assert.equal(isChipHidden(afterEdit, NOW + DAY - 1), true);
    assert.equal(afterEdit.collapsed, undefined);
    assert.equal(afterEdit.prize, undefined);

    // "Yeni tur başlat": round 2, everyone is eligible again and every hint starts over.
    const round2 = sig({ round: 2, slices });
    const afterRound = parseWheelStore(raw, round2);
    assert.deepEqual(afterRound, { sig: round2 });
    assert.equal(isTeaserHidden(afterRound, NOW + DAY), false);
  });
});
