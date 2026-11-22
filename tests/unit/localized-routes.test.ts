// Day 4 localized routes: second-level segments under hesap / odeme / bulten, the 308 rules for
// wrong-language segments, the /hesap session gate and the safe `sonra` return path.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Locale } from "@/i18n/config";
import {
  LOCALE_CODES,
  SUB_SEGMENTS,
  folderPath,
  href,
  localizePath,
  safeReturnPath,
  signInHref,
  switchLocalePath,
  toSubFolderSegment,
  type StaticRoute,
} from "@/i18n/paths";
import { proxy } from "@/proxy";

/** Every day-4 route: Turkish canonical path and the English one (en and ar share it). */
const DAY4_ROUTES: [StaticRoute, string, string][] = [
  ["account", "/hesap", "/account"],
  ["signIn", "/hesap/giris", "/account/sign-in"],
  ["register", "/hesap/kayit", "/account/register"],
  ["forgotPassword", "/hesap/sifremi-unuttum", "/account/forgot-password"],
  ["resetPassword", "/hesap/sifre-sifirla", "/account/reset-password"],
  ["verifyEmail", "/hesap/dogrula", "/account/verify"],
  ["accountOrders", "/hesap/siparisler", "/account/orders"],
  ["accountAddresses", "/hesap/adresler", "/account/addresses"],
  ["accountProfile", "/hesap/profil", "/account/profile"],
  ["accountFavorites", "/hesap/favoriler", "/account/favorites"],
  ["accountSubscriptions", "/hesap/abonelikler", "/account/subscriptions"],
  ["accountBusiness", "/hesap/kurumsal", "/account/business"],
  ["cardPayment", "/odeme/kart", "/checkout/card"],
  ["newsletterConfirm", "/bulten/onay", "/newsletter/confirm"],
  ["newsletterUnsubscribe", "/bulten/ayril", "/newsletter/unsubscribe"],
];

const expected = (locale: Locale, trPath: string, enPath: string) => `/${locale}${locale === "tr" ? trPath : enPath}`;

const SESSION_COOKIE = "better-auth.session_token=abc.def";

function request(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(path, "http://shop.test"), { method: init.method ?? "GET", headers });
}

function location(response: Response): string | null {
  const value = response.headers.get("location");
  if (!value) return null;
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function rewrittenTo(response: Response): string | null {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
}

describe("href: every day-4 route in every locale", () => {
  for (const [route, trPath, enPath] of DAY4_ROUTES) {
    for (const locale of LOCALE_CODES) {
      test(`${route} (${locale})`, () => {
        assert.equal(href(locale, route), expected(locale, trPath, enPath));
      });
    }
  }

  test("accountOrder takes the order number (encoded, never translated)", () => {
    assert.equal(href("tr", "accountOrder", { orderNumber: "PR-261001" }), "/tr/hesap/siparisler/PR-261001");
    assert.equal(href("en", "accountOrder", { orderNumber: "PR-261001" }), "/en/account/orders/PR-261001");
    assert.equal(href("ar", "accountOrder", { orderNumber: "PR 1/2" }), "/ar/account/orders/PR%201%2F2");
  });

  test("routes from earlier days are unchanged", () => {
    assert.equal(href("en", "paymentSimulator"), "/en/checkout/simulator");
    assert.equal(href("tr", "paymentSimulator"), "/tr/odeme/simulator");
    assert.equal(href("ar", "checkout"), "/ar/checkout");
    assert.equal(href("en", "business"), "/en/business");
    assert.equal(href("en", "order", { orderNumber: "PR-261001" }), "/en/order/PR-261001");
    assert.equal(href("tr", "product", { slug: "lavanta" }), "/tr/urunler/lavanta");
  });

  test("SUB_SEGMENTS has one English spelling per Turkish sub-folder (no duplicates)", () => {
    for (const map of Object.values(SUB_SEGMENTS)) {
      const english = Object.values(map);
      assert.equal(new Set(english).size, english.length);
    }
  });
});

describe("localizePath / switchLocalePath with second-level segments", () => {
  for (const [route, trPath, enPath] of DAY4_ROUTES) {
    test(`${route}: canonical and English inputs map to every locale`, () => {
      for (const locale of LOCALE_CODES) {
        const want = expected(locale, trPath, enPath);
        assert.equal(localizePath(locale, trPath), want, `from ${trPath}`);
        assert.equal(localizePath(locale, `/en${enPath}`), want, `from /en${enPath}`);
        assert.equal(localizePath(locale, `/ar${enPath}?x=1`), `${want}?x=1`);
      }
    });
  }

  test("deeper segments and unknown sub-paths pass through", () => {
    assert.equal(localizePath("en", "/hesap/siparisler/PR-261001"), "/en/account/orders/PR-261001");
    assert.equal(localizePath("tr", "/en/account/orders/PR-261001#top"), "/tr/hesap/siparisler/PR-261001#top");
    assert.equal(localizePath("en", "/odeme/simulator?order=PR-1"), "/en/checkout/simulator?order=PR-1");
    assert.equal(localizePath("en", "/hesap/bilinmeyen"), "/en/account/bilinmeyen");
    // A sub-segment of another folder is not translated (kurumsal is a top-level folder too).
    assert.equal(localizePath("en", "/urunler/kurumsal"), "/en/products/kurumsal");
    assert.equal(localizePath("en", "/kurumsal"), "/en/business");
  });

  test("switching language keeps the page", () => {
    assert.equal(switchLocalePath("/en/account/forgot-password", "tr"), "/tr/hesap/sifremi-unuttum");
    assert.equal(switchLocalePath("/tr/bulten/ayril?t=abc", "ar"), "/ar/newsletter/unsubscribe?t=abc");
  });

  test("toSubFolderSegment / folderPath", () => {
    assert.equal(toSubFolderSegment("hesap", "sign-in"), "giris");
    assert.equal(toSubFolderSegment("hesap", "giris"), "giris");
    assert.equal(toSubFolderSegment("hesap", "PR-1"), null);
    assert.equal(toSubFolderSegment("urunler", "giris"), null);
    assert.deepEqual(folderPath("/en/account/orders/PR-1?x=1"), { locale: "en", path: "/hesap/siparisler/PR-1" });
    assert.deepEqual(folderPath("/ar"), { locale: "ar", path: "/" });
    assert.equal(folderPath("/hesap"), null);
  });
});

describe("safeReturnPath / signInHref", () => {
  test("accepts local paths with query and hash", () => {
    assert.equal(safeReturnPath("/tr/hesap/siparisler"), "/tr/hesap/siparisler");
    assert.equal(safeReturnPath("/en/account/orders?page=2#x"), "/en/account/orders?page=2#x");
    assert.equal(safeReturnPath(" /tr/odeme "), "/tr/odeme");
  });

  test("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example/",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/%2F%2Fevil.example",
      "/%5cevil.example",
      "javascript:alert(1)",
      "tr/hesap",
      "/tr/hesap\nSet-Cookie: x=1",
      "/tr/\thesap",
      "",
      "/".padEnd(600, "a"),
    ]) {
      assert.equal(safeReturnPath(bad), null, JSON.stringify(bad));
    }
    assert.equal(safeReturnPath(undefined), null);
    assert.equal(safeReturnPath(["/tr"]), null);
  });

  test("signInHref encodes a safe return path and drops an unsafe one", () => {
    assert.equal(signInHref("en", "/en/account/orders"), "/en/account/sign-in?sonra=%2Fen%2Faccount%2Forders");
    assert.equal(signInHref("tr", "https://evil.example"), "/tr/hesap/giris");
    assert.equal(signInHref("ar"), "/ar/account/sign-in");
  });
});

describe("proxy: second-level segments", () => {
  for (const [route, trPath, enPath] of DAY4_ROUTES) {
    if (route === "cardPayment") continue; // /odeme/** without a cart cookie: see below
    const isPublic = !trPath.startsWith("/hesap") || ["signIn", "register", "forgotPassword", "resetPassword", "verifyEmail"].includes(route);
    const cookie = isPublic ? undefined : SESSION_COOKIE;

    test(`${route}: canonical URLs are served (en/ar rewritten to the Turkish folders)`, () => {
      const tr = proxy(request(`/tr${trPath}`, { cookie }));
      assert.equal(tr.headers.get("location"), null);
      assert.equal(rewrittenTo(tr), null);
      for (const locale of ["en", "ar"] as const) {
        const res = proxy(request(`/${locale}${enPath}`, { cookie }));
        assert.equal(res.headers.get("location"), null, `${locale}${enPath} must not redirect`);
        assert.equal(rewrittenTo(res), `/${locale}${trPath}`);
      }
    });

    test(`${route}: wrong-language segments get a 308 to the canonical URL`, () => {
      const enUnderTr = proxy(request(`/tr${enPath}`, { cookie }));
      assert.equal(enUnderTr.status, 308);
      assert.equal(location(enUnderTr), `/tr${trPath}`);
      for (const locale of ["en", "ar"] as const) {
        const trUnderEn = proxy(request(`/${locale}${trPath}`, { cookie }));
        assert.equal(trUnderEn.status, 308);
        assert.equal(location(trUnderEn), `/${locale}${enPath}`);
      }
    });
  }

  test("mixed spellings are fixed in one hop", () => {
    const a = proxy(request("/en/account/giris?sonra=%2Fen"));
    assert.equal(a.status, 308);
    assert.equal(location(a), "/en/account/sign-in?sonra=%2Fen");
    const b = proxy(request("/tr/hesap/sign-in"));
    assert.equal(b.status, 308);
    assert.equal(location(b), "/tr/hesap/giris");
    const c = proxy(request("/ar/hesap/forgot-password"));
    assert.equal(c.status, 308);
    assert.equal(location(c), "/ar/account/forgot-password");
  });

  test("/odeme/kart: a page load without a cart cookie is not sent to the cart (only /odeme itself is)", () => {
    const tr = proxy(request("/tr/odeme/kart?order=PR-1"));
    assert.equal(tr.headers.get("location"), null);
    const en = proxy(request("/en/checkout/card?order=PR-1"));
    assert.equal(rewrittenTo(en), "/en/odeme/kart");
    const wrong = proxy(request("/en/checkout/kart"));
    assert.equal(wrong.status, 308);
    assert.equal(location(wrong), "/en/checkout/card");
    const checkout = proxy(request("/en/checkout"));
    assert.equal(checkout.status, 307);
    assert.equal(location(checkout), "/en/cart");
  });

  test("deeper account paths are rewritten with the order number untouched", () => {
    const res = proxy(request("/en/account/orders/PR-261001", { cookie: SESSION_COOKIE }));
    assert.equal(rewrittenTo(res), "/en/hesap/siparisler/PR-261001");
  });
});

describe("proxy: /hesap session gate", () => {
  test("account pages without a session cookie go to sign-in with ?sonra", () => {
    const cases: [string, string][] = [
      ["/tr/hesap", "/tr/hesap/giris"],
      ["/tr/hesap/siparisler?sayfa=2", "/tr/hesap/giris"],
      ["/en/account/orders/PR-261001", "/en/account/sign-in"],
      ["/ar/account/business", "/ar/account/sign-in"],
      ["/en/account/profile", "/en/account/sign-in"],
    ];
    for (const [path, signIn] of cases) {
      const res = proxy(request(path));
      assert.equal(res.status, 307, path);
      const target = new URL(res.headers.get("location")!);
      assert.equal(target.pathname, signIn);
      assert.equal(target.searchParams.get("sonra"), path);
      assert.equal(safeReturnPath(target.searchParams.get("sonra")), path, "the gate's own value passes the return-path check");
      assert.equal(res.headers.get("cache-control"), "private, no-store");
    }
  });

  test("auth pages stay public", () => {
    for (const path of [
      "/tr/hesap/giris",
      "/tr/hesap/kayit",
      "/tr/hesap/sifremi-unuttum",
      "/tr/hesap/sifre-sifirla?token=x",
      "/tr/hesap/dogrula?token=x",
      "/en/account/sign-in",
      "/en/account/register",
      "/ar/account/forgot-password",
      "/ar/account/reset-password",
      "/en/account/verify?token=x",
    ]) {
      assert.equal(proxy(request(path)).headers.get("location"), null, path);
    }
  });

  test("a session cookie (also the __Secure- one) lets account pages through", () => {
    assert.equal(proxy(request("/tr/hesap", { cookie: SESSION_COOKIE })).headers.get("location"), null);
    assert.equal(proxy(request("/tr/hesap/profil", { cookie: "__Secure-better-auth.session_token=abc" })).headers.get("location"), null);
  });

  test("Server Actions (POST) reach the page; it re-checks the session itself", () => {
    const res = proxy(request("/tr/hesap/profil", { method: "POST", headers: { "next-action": "abc" } }));
    assert.equal(res.headers.get("location"), null);
  });

  test("the gate does not touch other folders or the panel", () => {
    assert.equal(proxy(request("/tr/urunler")).headers.get("location"), null);
    assert.equal(proxy(request("/tr/bulten/onay?t=x")).headers.get("location"), null);
    assert.equal(proxy(request("/en/newsletter/unsubscribe?t=x")).headers.get("location"), null);
    const panel = proxy(request("/panel/siparisler"));
    assert.equal(new URL(panel.headers.get("location")!).pathname, "/panel/giris");
  });
});
