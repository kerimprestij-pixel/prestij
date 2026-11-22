// Regression tests for the day-3 review fixes (pure parts): per-e-mail sign-in lock, closed admin
// endpoints, trusted IP headers for Better Auth, the route cache handler (tag stamps, no 404 on disk),
// rich-text href checks and link localization, locale-first SEO texts, key-order-insensitive audit
// diffs, IBAN messages and the nested audit diff.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { leafChanges, isNestedValue } from "@/components/panel/audit/labels";
import { localizeBodyLinks, localizedRichTextHtml } from "@/components/sections/localize-links";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import {
  authIpAddressOptions,
  clearSignInFailures,
  DEFAULT_TRUSTED_PROXIES,
  isBlockedAuthPath,
  recordSignInFailure,
  SIGN_IN_FAILURE_RULE,
  signInLockedMinutes,
} from "@/lib/auth-limits";
import { auditChanges, isNoopAudit } from "@/lib/panel/audit";
import { IBAN_CHECKSUM_MESSAGE, IBAN_MESSAGE, ibanInput } from "@/lib/panel/settings/schemas";
import { memoryLimitStore as store, resetRateLimits } from "@/lib/rate-limit";
import { ownLocaleText, seoText } from "@/lib/seo/localized";

const require = createRequire(import.meta.url);
type Stamp = { expired?: number; stale?: number };
const handler = require(path.resolve("cache-handler.cjs")) as {
  laterStamps: (previous: Stamp | undefined, current: Stamp | undefined) => Stamp | undefined;
  isNotFoundPage: (data: unknown) => boolean;
};

describe("sign-in lock per e-mail (independent of the client IP)", () => {
  beforeEach(() => resetRateLimits());

  test("locks after the limit of failures, case-insensitively, and a success clears it", async () => {
    const now = Date.UTC(2026, 10, 9, 12);
    for (let i = 0; i < SIGN_IN_FAILURE_RULE.limit - 1; i++) await recordSignInFailure(store, "Admin@Test.Local", now + i);
    assert.equal(await signInLockedMinutes(store, "admin@test.local", now + 100), 0, "below the limit");
    await recordSignInFailure(store, " admin@test.local ", now + 200);
    const wait = await signInLockedMinutes(store, "ADMIN@TEST.LOCAL", now + 300);
    assert.ok(wait > 0 && wait <= 15, `locked for ${wait} min`);
    assert.equal(await signInLockedMinutes(store, "other@test.local", now + 300), 0, "other accounts are not affected");
    assert.equal(await signInLockedMinutes(store, "admin@test.local", now + SIGN_IN_FAILURE_RULE.windowMs + 300), 0, "the window passes");
    await clearSignInFailures(store, "admin@test.local");
    assert.equal(await signInLockedMinutes(store, "admin@test.local", now + 300), 0, "cleared");
  });

  test("ignores missing or non-string e-mails", async () => {
    await recordSignInFailure(store, undefined);
    await recordSignInFailure(store, 42);
    assert.equal(await signInLockedMinutes(store, undefined), 0);
    assert.equal(await signInLockedMinutes(store, ""), 0);
  });
});

describe("admin plugin endpoints are not served over HTTP", () => {
  test("every spelling of /api/auth/admin/* is blocked", () => {
    for (const p of [
      "/api/auth/admin/set-role",
      "/api/auth/admin/impersonate-user",
      "/api/auth/ADMIN/remove-user",
      "/api/auth//admin/set-user-password",
      "/api/auth/admin%2Fset-role",
      "/api/auth/%61dmin/ban-user",
      "/api/auth/admin",
      "/api/auth/%E0%A4%A",
    ]) {
      assert.equal(isBlockedAuthPath(p), true, p);
    }
  });

  test("sign-in, sign-out and the session stay open", () => {
    for (const p of ["/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/get-session", "/api/auth/administrator-info"]) {
      assert.equal(isBlockedAuthPath(p), false, p);
    }
  });
});

describe("Better Auth client IP headers", () => {
  test("Vercel: only the platform header", () => {
    assert.deepEqual(authIpAddressOptions({ VERCEL: "1" }), { ipAddressHeaders: ["x-vercel-forwarded-for"] });
  });
  test("self-hosted default: X-Forwarded-For read past private proxies; never the client-settable Vercel header", () => {
    const options = authIpAddressOptions({});
    assert.deepEqual(options.ipAddressHeaders, ["x-forwarded-for"]);
    assert.deepEqual(options.trustedProxies, [...DEFAULT_TRUSTED_PROXIES]);
  });
  test("a proxy-set header and explicit trusted proxies win", () => {
    assert.deepEqual(authIpAddressOptions({ AUTH_IP_HEADER: "X-Real-IP" }), { ipAddressHeaders: ["x-real-ip"] });
    assert.deepEqual(authIpAddressOptions({ TRUSTED_IP_HEADER: "cf-connecting-ip", AUTH_TRUSTED_PROXIES: "10.1.0.0/16, 10.2.0.1" }), {
      ipAddressHeaders: ["cf-connecting-ip"],
      trustedProxies: ["10.1.0.0/16", "10.2.0.1"],
    });
    assert.deepEqual(authIpAddressOptions({ AUTH_TRUSTED_PROXIES: "192.0.2.10" }).trustedProxies, ["192.0.2.10"]);
  });
});

describe("route cache handler (cache-handler.cjs)", () => {
  test("a tag invalidation never moves back in time (performance clock ahead of Date.now)", () => {
    // DefaultCacheHandler stamped 1000 (performance clock), FileSystemCache then wrote 900 (Date.now).
    assert.deepEqual(handler.laterStamps({ expired: 1000 }, { expired: 900 }), { expired: 1000 });
    // The other way round the later (file system) stamp is kept as it is.
    assert.deepEqual(handler.laterStamps({ expired: 900 }, { expired: 1000 }), { expired: 1000 });
    assert.deepEqual(handler.laterStamps({ expired: 5, stale: 1000 }, { expired: 10, stale: 900 }), { expired: 10, stale: 1000 });
    assert.deepEqual(handler.laterStamps(undefined, { expired: 7 }), { expired: 7 });
  });

  test("only rendered 404 pages skip the disk", () => {
    assert.equal(handler.isNotFoundPage({ kind: "APP_PAGE", status: 404 }), true);
    assert.equal(handler.isNotFoundPage({ kind: "APP_PAGE", status: 200 }), false);
    assert.equal(handler.isNotFoundPage({ kind: "APP_ROUTE", status: 404 }), false);
    assert.equal(handler.isNotFoundPage(null), false);
  });
});

describe("rich text links", () => {
  test("named character references that hide slashes or schemes are dropped", () => {
    for (const href of ["/&sol;evil.example/", "/&bsol;evil.example/", "javascript&colon;alert(1)", "/&NewLine;/evil", "/\\evil.example", "/&#92;evil.example"]) {
      assert.equal(sanitizeHtml(`<a href="${href}">x</a>`), "<a>x</a>", href);
    }
  });

  test("ordinary internal, query and external links survive", () => {
    assert.equal(sanitizeHtml('<a href="/urunler?x=1&amp;y=2">x</a>'), '<a href="/urunler?x=1&amp;y=2">x</a>');
    assert.equal(sanitizeHtml('<a href="https://prestij.example/a">x</a>'), '<a href="https://prestij.example/a" rel="noopener noreferrer" target="_blank">x</a>');
  });

  test("internal links point to the reader's language; external and localized ones are kept", () => {
    const html = '<p><a href="/urunler/portakal">P</a> <a href="/en/products/x">E</a> <a href="https://x.example/">X</a> <a href="#a">A</a></p>';
    const ar = localizedRichTextHtml(html, "ar");
    assert.ok(ar.includes('href="/ar/products/portakal"'), ar);
    assert.ok(ar.includes('href="/en/products/x"'), "already localized");
    assert.ok(ar.includes('href="https://x.example/"') && ar.includes('href="#a"'));
    assert.ok(localizeBodyLinks('<a href="/kategori/el-sabunu">K</a>', "tr").includes('href="/tr/kategori/el-sabunu"'));
    assert.equal(localizedRichTextHtml("Düz metin\n\nİkinci paragraf", "en"), "<p>Düz metin</p><p>İkinci paragraf</p>");
  });
});

describe("locale-first SEO texts", () => {
  test("a Turkish-only SEO title no longer wins over the translated name", () => {
    const seo = { tr: "Yalnız Türkçe SEO başlığı" };
    assert.equal(seoText(seo, "tr", "Ad"), "Yalnız Türkçe SEO başlığı");
    assert.equal(seoText(seo, "en", "Content page EN"), "Content page EN");
    assert.equal(seoText({ tr: "TR", ar: "عنوان" }, "ar", "اسم"), "عنوان");
    assert.equal(seoText(seo, "en"), "Yalnız Türkçe SEO başlığı", "Turkish SEO text as the last resort");
    assert.equal(seoText(null, "en", "", "  ", "Yedek"), "Yedek");
  });

  test("text shown on the page itself never falls back to Turkish", () => {
    assert.equal(ownLocaleText({ tr: "Türkçe giriş." }, "ar"), "");
    assert.equal(ownLocaleText({ tr: "Türkçe giriş.", en: " English intro. " }, "en"), "English intro.");
  });
});

describe("audit diffs", () => {
  test("jsonb key order (ar, en, tr) is not a change; a no-op update is not written", () => {
    const stored = { name: { ar: "ص", en: "Hand soap", tr: "El sabunu" }, isVisible: true };
    const parsed = { name: { tr: "El sabunu", en: "Hand soap", ar: "ص" }, isVisible: true };
    const changes = auditChanges(stored, parsed);
    assert.deepEqual(changes, { before: {}, after: {} });
    assert.equal(isNoopAudit({ action: "update", entity: "category", entityId: 1, ...changes }), true);
    assert.equal(isNoopAudit({ action: "update", entity: "category", before: { a: 1 }, after: { a: 2 } }), false);
    assert.equal(isNoopAudit({ action: "delete", entity: "category", before: {}, after: {} }), false);
    assert.equal(isNoopAudit({ action: "update", entity: "settings" }), false, "no snapshot at all is kept");
  });

  test("nested values show only the changed leaves with readable paths", () => {
    const before = [{ href: "/urunler", label: { tr: "Ürünler X", en: "Products" }, children: [] }];
    const after = [{ href: "/urunler", label: { tr: "Ürünler", en: "Products" }, children: [] }];
    assert.equal(isNestedValue(before), true);
    assert.equal(isNestedValue({ tr: "x" }), false, "localized values have their own view");
    assert.equal(isNestedValue([1, 2]), false, "simple lists have their own view");
    const { changes, more } = leafChanges(before, after);
    assert.equal(more, 0);
    assert.deepEqual(changes, [{ path: "1. öğe › Etiket › Türkçe", before: "Ürünler X", after: "Ürünler" }]);
  });
});

describe("IBAN messages", () => {
  test("a wrong check digit gets its own message", () => {
    const bad = ibanInput.safeParse("TR12 0006 2000 0001 2345 6789 01");
    assert.equal(bad.success, false);
    assert.equal(bad.error?.issues[0]?.message, IBAN_CHECKSUM_MESSAGE);
    assert.equal(ibanInput.safeParse("TR12 0006").error?.issues[0]?.message, IBAN_MESSAGE);
    assert.equal(ibanInput.safeParse("TR33 0006 1005 1978 6457 8413 26").success, true);
  });
});
