// Day 6 CONTENT: the go-live steps of the "Yayına çıkınca" checklist (src/lib/panel/seo/launch.ts): media
// storage on Supabase with a test upload on the live site, the gift wheel slices, the lawyer's review of the
// wheel campaign terms. Order, links, done flags from the inputs the panel page passes, status lines, copy.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isDraftLegalVersion,
  launchChecklist,
  mediaStorageState,
  WHEEL_TERMS_LEGAL_KEY,
  type LaunchChecklistInput,
  type LaunchStep,
} from "@/lib/panel/seo/launch";
import { LEGAL_KEY_PATTERN } from "@/lib/panel/legal/schemas";

const base: LaunchChecklistInput = {
  origin: "https://prestij.com.tr",
  verification: { google: "", bing: "", yandex: "" },
  socialLinks: 0,
  indexNow: "missing",
  address: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E, Kocasinan / Kayseri",
};
const step = (steps: LaunchStep[], key: string) => {
  const found = steps.find((s) => s.key === key);
  assert.ok(found, key);
  return found;
};

describe("mediaStorageState", () => {
  test("local by default, supabase only with both keys, incomplete or invalid otherwise", () => {
    assert.equal(mediaStorageState({}), "local");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: "" }), "local");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: " Local " }), "local");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }), "supabase");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: "SUPABASE", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }), "supabase");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://x.supabase.co" }), "incomplete");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: "supabase", SUPABASE_URL: " ", SUPABASE_SERVICE_ROLE_KEY: "k" }), "incomplete");
    assert.equal(mediaStorageState({ STORAGE_DRIVER: "s3" }), "invalid");
  });
});

describe("isDraftLegalVersion", () => {
  test("taslak labels (the seeded one and the editor's suggestions) are drafts; other labels are not", () => {
    for (const v of ["taslak-1", "taslak-2", "Taslak-3", " TASLAK 4"]) assert.equal(isDraftLegalVersion(v), true, v);
    for (const v of ["2026-12 v1", "v1", "onaylı-1", "1"]) assert.equal(isDraftLegalVersion(v), false, v);
  });
});

describe("day-6 go-live steps", () => {
  test("media storage opens the 'before' group; the wheel steps form the 'wheel' group (FIX B-F9), with their panel links", () => {
    const all = launchChecklist(base);
    const steps = ["media-storage", "gift-wheel-slices", "wheel-terms-review"].map((key) => step(all, key));
    assert.equal(all[0].key, "media-storage");
    assert.deepEqual(steps.map((s) => s.group), ["before", "wheel", "wheel"], "the wheel stays off at go-live, so its steps do not block it");
    assert.equal(all.length, 19, "the six go-live steps (CF-9/CF-10, sales contracts), the two SR-6 sales steps and the eight search-engine steps");
    assert.deepEqual(
      steps.map((s) => [s.panelHref, s.panelLabel]),
      [
        ["/panel/medya", "Medya"],
        ["/panel/hediye-carki/ayarlar", "Hediye Çarkı ayarları"],
        ["/panel/yasal/wheel_terms", "Kampanya koşulları"],
      ],
    );
    assert.match(WHEEL_TERMS_LEGAL_KEY, LEGAL_KEY_PATTERN);
    for (const s of steps) {
      assert.ok(s.title && s.steps.length >= 3, s.key);
      for (const link of s.links) assert.match(link.url, /^https:\/\//, `${s.key}: ${link.url}`);
    }
    assert.deepEqual(step(steps, "media-storage").links, [{ label: "Supabase", url: "https://supabase.com/dashboard" }]);
  });

  test("no badge while the page does not pass the inputs", () => {
    const steps = launchChecklist(base);
    for (const key of ["media-storage", "gift-wheel-slices", "wheel-terms-review"]) assert.equal(step(steps, key).done, null, key);
  });

  test("media storage: done only with Supabase configured; a status line for a broken setup", () => {
    const done = (mediaStorage: LaunchChecklistInput["mediaStorage"]) => step(launchChecklist({ ...base, mediaStorage }), "media-storage");
    assert.equal(done("supabase").done, true);
    assert.equal(done("local").done, false);
    assert.equal(done("incomplete").done, false);
    assert.equal(done("invalid").done, false);
    assert.ok(done("incomplete").steps.some((l) => l.includes("SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik")));
    assert.ok(done("invalid").steps.some((l) => l.includes("local veya supabase olmalı")));
    assert.equal(done("local").steps.length, done("supabase").steps.length, "no extra line when the driver is valid");
    const text = done("local").steps.join(" ");
    for (const name of ["STORAGE_DRIVER", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"]) assert.ok(text.includes(name), name);
    assert.match(text, /deneme fotoğrafı ve kısa bir MP4 deneme videosu/);
    assert.match(text, /sonra iki dosyayı da silin/);
  });

  test("gift wheel slices: never ticked by the panel; a line says whether the wheel is on", () => {
    const wheel = (giftWheelEnabled?: boolean) => step(launchChecklist({ ...base, giftWheelEnabled }), "gift-wheel-slices");
    assert.equal(wheel(true).done, null);
    assert.equal(wheel(false).done, null);
    assert.ok(wheel(true).steps.some((l) => l.startsWith("Çark şu anda sitede açık")));
    assert.ok(wheel(false).steps.some((l) => l.startsWith("Çark şu anda kapalı")));
    assert.equal(wheel().steps.length, 3);
    assert.match(wheel().steps[0], /altı örnek dilim/);
  });

  test("wheel terms: done once a non-draft version is current; a line when the document is missing", () => {
    const terms = (wheelTermsVersion?: string | null) => step(launchChecklist({ ...base, wheelTermsVersion }), "wheel-terms-review");
    assert.equal(terms("taslak-1").done, false);
    assert.equal(terms("taslak-2").done, false);
    assert.equal(terms("2026-12 v1").done, true);
    assert.equal(terms(null).done, false);
    assert.ok(terms(null).steps[0].includes("henüz eklenmemiş"));
    assert.equal(terms("taslak-1").steps.length, 4); // FIX SEO-1: "keep the wheel off until approved" is its own line
    assert.match(terms("taslak-1").steps[0], /Avukat onayı gelene kadar çarkı .* kapalı tutun/);
    const text = terms("taslak-1").steps.join(" ");
    assert.match(text, /taslak — avukat onayı bekliyor/);
    assert.match(text, /çekiliş/);
    assert.match(text, /hatırlatma e-postası/);
    assert.match(text, /Çerez Politikası/);
    assert.match(text, /sürüm adı “taslak” ile başlamasın/);
  });

  test("plain Turkish copy without promises, and no secret is ever part of a step", () => {
    const steps = launchChecklist({ ...base, mediaStorage: "incomplete", giftWheelEnabled: true, wheelTermsVersion: null }).filter((s) =>
      ["media-storage", "gift-wheel-slices", "wheel-terms-review"].includes(s.key),
    );
    const text = JSON.stringify(steps).toLocaleLowerCase("tr-TR");
    assert.ok(!/garanti|1\. sıra|ilk sıra|birinci/.test(text));
    assert.ok(!/\.supabase\.co\b/.test(text), "no project URL");
    assert.ok(!/!/.test(text), "no exclamation marks");
  });
});
