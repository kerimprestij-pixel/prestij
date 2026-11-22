// Secret link values never reach the panel's e-mail log (src/lib/email/redact.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AUTH_LINK_TEMPLATES, hasEmailSecrets, REDACTED_VALUE, redactEmailSecrets } from "@/lib/email/redact";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jIn0.c2lnbmF0dXJlLXZhbHVl";
const RESET = "Rk7tq2ZsPwXy9LmN4bVc8aDe";
const ORDER = "0c4bd1f2-55aa-4c3e-9f00-6a1b2c3d4e5f";

describe("redactEmailSecrets", () => {
  test("HTML: the href and the visible fallback URL, raw and &amp;-escaped separators", () => {
    const url = `https://prestij.com.tr/en/account/verify?token=${JWT}&amp;sonra=%2Fen%2Fcheckout`;
    const html = `<a href="${url}" target="_blank">Verify</a><p>Or open:<br><a href="${url}">${url}</a></p>`;
    const out = redactEmailSecrets(html);
    assert.ok(!out.includes(JWT));
    assert.equal(out.split(`token=${REDACTED_VALUE}&amp;sonra=%2Fen%2Fcheckout`).length - 1, 3, "every copy, the rest of the URL kept");
  });

  test("plain text, every secret parameter name, and the List-Unsubscribe header", () => {
    const text = [
      `Reset: https://prestij.com.tr/tr/hesap/sifre-sifirla?token=${RESET}`,
      `Order: https://prestij.com.tr/tr/siparis/PR-261001?t=${ORDER}&new=1`,
      "Review: https://prestij.com.tr/tr/urunler/lavanta?degerlendir=v1.abc.def#degerlendirmeler",
      "Skip: https://prestij.com.tr/tr/hesap/abonelikler?atla=v1.xyz.123",
    ].join("\n");
    const out = redactEmailSecrets(text);
    for (const secret of [RESET, ORDER, "v1.abc.def", "v1.xyz.123"]) assert.ok(!out.includes(secret), secret);
    assert.ok(out.includes("&new=1") && out.includes("#degerlendirmeler"), "other parameters and anchors stay");
    const header = "<https://prestij.com.tr/api/newsletter/unsubscribe?t=abc.def>, <mailto:info@prestij.com.tr?subject=unsubscribe>";
    assert.equal(redactEmailSecrets(header), `<https://prestij.com.tr/api/newsletter/unsubscribe?t=${REDACTED_VALUE}>, <mailto:info@prestij.com.tr?subject=unsubscribe>`);
  });

  test("a token percent-encoded inside another parameter (sonra) is hidden too", () => {
    const out = redactEmailSecrets(`https://x.test/tr/hesap/dogrula?token=${JWT}&sonra=%2Ftr%2Fsiparis%2FPR-1%3Ft%3D${ORDER}`);
    assert.ok(!out.includes(JWT) && !out.includes(ORDER));
  });

  test("bodies without secrets are unchanged; the account templates are flagged", () => {
    const plain = '<a href="https://prestij.com.tr/tr/urunler?sirala=yeni">Ürünler</a> tutar=10';
    assert.equal(redactEmailSecrets(plain), plain);
    assert.equal(hasEmailSecrets(plain), false);
    assert.equal(hasEmailSecrets(`?token=${RESET}`), true);
    assert.equal(hasEmailSecrets(redactEmailSecrets(`?token=${RESET}`)), false, "idempotent");
    assert.deepEqual([...AUTH_LINK_TEMPLATES].sort(), ["account_verify", "password_reset"]);
  });
});
