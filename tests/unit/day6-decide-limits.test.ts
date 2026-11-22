// Day 6 follow-up, lead decision D13 (SEC-2: guests re-spinning after dropping the cookie), the pure part:
//   - the wheel's per-IP spin limit is 3 per 24 h (claims stay 3 per 24 h);
//   - the wheel's limit address: IPv6 by its /64 prefix, IPv4-mapped IPv6 as IPv4, IPv4 unchanged;
//   - only the wheel keys use it (the shared client-IP helper and the other areas' limits are untouched);
//   - no published text (terms draft, wheel messages, panel help) states a spin count.
// The DB side (counters shared inside a /64, the fourth spin refused) is tests/db/day6-decide-wheel.test.ts.
//   npx tsx --test tests/unit/day6-decide-limits.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { defaultMessages } from "@/i18n/messages";
import { clientIpFrom } from "@/lib/rate-limit";
import { wheelLimitAddress } from "@/lib/wheel/limit-address";
import { WHEEL_RATE_LIMITS } from "@/lib/wheel/types";
import { WHEEL_TERMS_LEGAL_DOCUMENT } from "../../scripts/seed-data/legal";

const DAY = 86_400_000;
const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("D13: the limits", () => {
  test("3 spins and 3 claims per connection and 24 hours", () => {
    assert.deepEqual(WHEEL_RATE_LIMITS.spinsPerIp, { limit: 3, windowMs: DAY });
    assert.deepEqual(WHEEL_RATE_LIMITS.claimsPerIp, { limit: 3, windowMs: DAY });
  });
});

describe("D13: the address a wheel limit counts", () => {
  test("IPv4 stays as it is", () => {
    assert.equal(wheelLimitAddress("203.0.113.7"), "203.0.113.7");
    assert.equal(wheelLimitAddress("  203.0.113.7 "), "203.0.113.7");
    assert.equal(wheelLimitAddress("10.0.0.1"), "10.0.0.1");
  });

  test("IPv6 counts by its /64 prefix in one canonical spelling", () => {
    const net = "2001:db8:a:b::/64";
    for (const ip of [
      "2001:db8:a:b::1",
      "2001:db8:a:b:ffff:ffff:ffff:ffff",
      "2001:0DB8:000A:000B:1:2:3:4",
      "2001:db8:a:b:0:0:0:0",
      "[2001:db8:a:b::5]",
      "[2001:db8:a:b::5]:443",
      "2001:db8:a:b::1%eth0",
    ]) {
      assert.equal(wheelLimitAddress(ip), net, ip);
    }
    assert.equal(wheelLimitAddress("2001:db8:a:c::1"), "2001:db8:a:c::/64", "the next /64 is another key");
    assert.equal(wheelLimitAddress("2001:db8::1"), "2001:db8:0:0::/64");
    assert.equal(wheelLimitAddress("::1"), "0:0:0:0::/64");
    assert.equal(wheelLimitAddress("fe80::1%eth0"), "fe80:0:0:0::/64");
    assert.equal(wheelLimitAddress("2001:db8:1:2:3:4:192.0.2.1"), "2001:db8:1:2::/64", "an embedded IPv4 tail");
  });

  test("IPv4-mapped IPv6 counts as the IPv4 address", () => {
    assert.equal(wheelLimitAddress("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(wheelLimitAddress("::FFFF:203.0.113.7"), "203.0.113.7");
    assert.equal(wheelLimitAddress("0:0:0:0:0:ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(wheelLimitAddress("::ffff:cb00:7107"), "203.0.113.7", "the hex spelling");
    assert.equal(wheelLimitAddress("[::ffff:203.0.113.7]:8080"), "203.0.113.7");
    assert.equal(wheelLimitAddress("::ffff:0:203.0.113.7"), "0:0:0:0::/64", "IPv4-translated (::ffff:0:a.b.c.d) is not IPv4-mapped");
  });

  test("anything that is not an IP address is kept as it is (never merged)", () => {
    for (const value of ["unknown", "", "day6-test-fix-claim-abc", "1.2.3.4:5678", "2001:db8::1::2", "2001:db8:a:b:c:d:e:f:1", "::ffff:300.1.1.1", "gggg::1", "1:2:3:4:5:6:7::8:9"]) {
      assert.equal(wheelLimitAddress(value), value.trim(), JSON.stringify(value));
    }
  });
});

describe("D13: only the wheel keys change", () => {
  test("the shared client-IP helper still returns the plain address (other areas' limits untouched)", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.1, 2001:db8:a:b::77" });
    assert.equal(clientIpFrom(headers), "2001:db8:a:b::77");
    assert.doesNotMatch(src("src/lib/rate-limit.ts"), /limit-address/);
    assert.doesNotMatch(src("src/lib/request-ip.ts"), /limit-address/);
  });

  test("both wheel keys go through the address rule; the spin row's IP hash keeps the full address", () => {
    const limits = src("src/lib/wheel/limits.ts");
    assert.match(limits, /wheelClaimLimitKey = \(ip: string\) => `wheel-claim:ip:\$\{wheelLimitAddress\(ip\)\}`/);
    assert.match(limits, /wheelSpinLimitKey = \(ip: string\) => `wheel:ip:\$\{wheelLimitAddress\(ip\)\}`/);
    assert.match(src("src/lib/wheel/service.ts"), /ipHash: hashWheelIp\(input\.ip\)/);
    // loadWheel's read-only pre-check uses the same key function as the spin route.
    assert.match(src("src/lib/wheel/actions.ts"), /checkLimits\(\[\[wheelSpinLimitKey\(/);
  });
});

describe("D13: no published text states the number of spins", () => {
  // A number followed by a count word ("10 kez", "3 spins", "3 مرات"); Unicode-aware end (an ASCII \b fails on Arabic).
  const spinCount = /\d+\s*(kez|kere|defa|çevirme|spins?|times|مرات|مرة)(?!\p{L})/iu;

  test("the terms draft (tr/en/ar) says only that the count may be limited", () => {
    for (const l of ["tr", "en", "ar"] as const) {
      const body = WHEEL_TERMS_LEGAL_DOCUMENT.body[l] ?? "";
      assert.doesNotMatch(body, /\b10\s*(çevirme|spins?)/i, l);
      assert.doesNotMatch(body.replace(/<[^>]+>/g, " "), spinCount, l);
    }
    assert.match(WHEEL_TERMS_LEGAL_DOCUMENT.body.tr, /çevirme ve ödül alma sayısı sınırlandırılabilir/);
  });

  test("the wheel messages and the panel's wheel help state no count either", () => {
    for (const l of ["tr", "en", "ar"] as const) {
      const w = defaultMessages[l].wheel;
      assert.doesNotMatch(w.errors.spin_limit, /\d/, l);
      assert.doesNotMatch(w.errors.claim_limit, /\d/, l);
    }
    for (const file of ["src/components/panel/gift-wheel/WheelSettingsForm.tsx", "src/lib/panel/seo/launch.ts", "src/app/panel/(dashboard)/hediye-carki/ayarlar/page.tsx"]) {
      assert.doesNotMatch(src(file), /\b(10|on)\s*(kez|kere|defa)?\s*çevir/iu, file);
    }
  });
});
