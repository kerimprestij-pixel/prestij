// Signed, purpose-bound tokens (src/lib/signed-token.ts): round trip, purpose separation, expiry,
// tampering, malformed input, secret handling; plus the sliding-window math of the durable rate-limit
// store (src/lib/rate-limit.ts, pure).
import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import { describe, test } from "node:test";
import { slidingWaitMs, slidingWindowAt } from "@/lib/rate-limit";
import { createTokenSigner, MAX_TOKEN_LENGTH, signToken, verifyToken } from "@/lib/signed-token";

const SECRET = "unit-test-secret-0123456789abcdef";

function clock(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("signed tokens", () => {
  test("round trip: payload back, no expiry when no ttl is given", () => {
    const signer = createTokenSigner(SECRET);
    const token = signer.signToken("review", { orderId: 12, productId: 3 });
    assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const result = signer.verifyToken<{ orderId: number; productId: number }>("review", token);
    assert.deepEqual(result, { ok: true, payload: { orderId: 12, productId: 3 }, expiresAt: null });
  });

  test("a token for one purpose never verifies for another (HKDF key per purpose)", () => {
    const signer = createTokenSigner(SECRET);
    const token = signer.signToken("newsletter-confirm", { id: 7 });
    assert.deepEqual(signer.verifyToken("newsletter-unsubscribe", token), { ok: false, reason: "invalid" });
    assert.equal(signer.verifyToken("newsletter-confirm", token).ok, true);
  });

  test("another secret does not verify (rotation voids every link)", () => {
    const token = createTokenSigner(SECRET).signToken("review", { orderId: 1 });
    assert.deepEqual(createTokenSigner(`${SECRET}-rotated`).verifyToken("review", token), { ok: false, reason: "invalid" });
  });

  test("expiry: valid until the second it expires, then expired", () => {
    const c = clock(Date.UTC(2026, 10, 10, 9, 0, 0));
    const signer = createTokenSigner(SECRET, { now: c.now });
    const token = signer.signToken("review", { orderId: 5 }, 3600);
    const ok = signer.verifyToken("review", token);
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.expiresAt?.toISOString(), "2026-11-10T10:00:00.000Z");
    c.advance(3599_000);
    assert.equal(signer.verifyToken("review", token).ok, true, "one second before");
    c.advance(1000);
    assert.deepEqual(signer.verifyToken("review", token), { ok: false, reason: "expired" });
  });

  test("tampering with the payload or the signature is detected", () => {
    const signer = createTokenSigner(SECRET);
    const token = signer.signToken("review", { orderId: 12, productId: 3 });
    const [v, body, sig] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ p: { orderId: 13, productId: 3 }, e: null })).toString("base64url");
    assert.deepEqual(signer.verifyToken("review", `${v}.${forgedBody}.${sig}`), { ok: false, reason: "invalid" });
    // Change the first character (the last one carries 2 padding bits, so changing it may not change the bytes).
    const flipped = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
    assert.deepEqual(signer.verifyToken("review", `${v}.${body}.${flipped}`), { ok: false, reason: "invalid" });
    // A second spelling of the same signature bytes (padding bits set) is refused: one token, one string.
    const last = sig.at(-1)!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const respelled = sig.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
    assert.deepEqual(signer.verifyToken("review", `${v}.${body}.${respelled}`), { ok: false, reason: "malformed" });
    // An expiry removed from a signed body is a different body, so the MAC fails too.
    const expiring = signer.signToken("review", { orderId: 1 }, 60);
    const [, eBody, eSig] = expiring.split(".");
    const noExpiry = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(eBody, "base64url").toString()), e: null })).toString("base64url");
    assert.deepEqual(signer.verifyToken("review", `v1.${noExpiry}.${eSig}`), { ok: false, reason: "invalid" });
  });

  test("malformed input is refused without throwing", () => {
    const signer = createTokenSigner(SECRET);
    for (const bad of [undefined, null, 42, "", "abc", "v1.abc", "v2.abc.def", "v1.ab$c.def", `v1.${"a".repeat(MAX_TOKEN_LENGTH)}.x`, "v1.abc.short"]) {
      assert.deepEqual(signer.verifyToken("review", bad), { ok: false, reason: "malformed" }, String(bad));
    }
  });

  test("a correctly signed body that is not the token shape is malformed", () => {
    // Same derivation as the module (documented format): HKDF-SHA256(secret, salt, "purpose:<p>") → HMAC.
    const key = Buffer.from(hkdfSync("sha256", SECRET, "prestij/signed-token/v1", "purpose:review", 32));
    const signed = (json: string) => {
      const body = Buffer.from(json).toString("base64url");
      return `v1.${body}.${createHmac("sha256", key).update(`v1.${body}`).digest("base64url")}`;
    };
    const signer = createTokenSigner(SECRET);
    assert.equal(signer.verifyToken("review", signed(JSON.stringify({ p: { a: 1 }, e: null }))).ok, true, "derivation matches");
    for (const json of ["not json", "[]", JSON.stringify({ p: [1], e: null }), JSON.stringify({ p: { a: 1 }, e: "soon" }), JSON.stringify({ e: null })]) {
      assert.deepEqual(signer.verifyToken("review", signed(json)), { ok: false, reason: "malformed" }, json);
    }
  });

  test("invalid purposes, payloads and ttls throw (programming errors)", () => {
    const signer = createTokenSigner(SECRET);
    assert.throws(() => signer.signToken("Review Link", { a: 1 }));
    assert.throws(() => signer.verifyToken("", "v1.a.b"));
    assert.throws(() => signer.signToken("review", [] as unknown as Record<string, unknown>));
    assert.throws(() => signer.signToken("review", { a: 1 }, 0));
    assert.throws(() => signer.signToken("review", { a: 1 }, Number.NaN));
    assert.throws(() => signer.signToken("review", { big: "x".repeat(MAX_TOKEN_LENGTH) }), /too large/);
  });

  test("a missing or short secret fails closed", () => {
    assert.throws(() => createTokenSigner("").signToken("review", { a: 1 }), /secret/);
    assert.throws(() => createTokenSigner("short").verifyToken("review", "v1.abc." + "A".repeat(43)), /secret/);
  });

  test("the app signer uses BETTER_AUTH_SECRET", () => {
    const saved = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = SECRET;
    try {
      const token = signToken("newsletter-unsubscribe", { id: 9 });
      assert.deepEqual(verifyToken("newsletter-unsubscribe", token), { ok: true, payload: { id: 9 }, expiresAt: null });
      assert.equal(createTokenSigner(SECRET).verifyToken("newsletter-unsubscribe", token).ok, true, "same derivation");
    } finally {
      if (saved === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = saved;
    }
  });
});

describe("sliding-window counter math", () => {
  const W = 60_000;
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % W); // aligned to a window start

  test("windows are aligned to the epoch; the previous window weighs what is left of the current one", () => {
    assert.deepEqual(slidingWindowAt(t0, W), { start: t0, prevStart: t0 - W, weight: 1 });
    assert.deepEqual(slidingWindowAt(t0 + W / 4, W), { start: t0, prevStart: t0 - W, weight: 0.75 });
  });

  test("allowed while current + previous × weight < limit", () => {
    assert.equal(slidingWaitMs({ now: t0, windowMs: W, limit: 3, current: 2, previous: 0 }), 0);
    assert.equal(slidingWaitMs({ now: t0 + W / 2, windowMs: W, limit: 3, current: 1, previous: 2 }), 0, "1 + 2×0.5 = 2 < 3");
    assert.ok(slidingWaitMs({ now: t0 + W / 2, windowMs: W, limit: 3, current: 2, previous: 2 }) > 0, "2 + 1 = 3");
  });

  test("a full window waits until the next one starts (plus the share the old count still weighs)", () => {
    const wait = slidingWaitMs({ now: t0 + 10_000, windowMs: W, limit: 3, current: 3, previous: 0 });
    assert.equal(wait, W - 10_000 + 1);
    // Over the limit (e.g. counted by another instance just before): 6 in a window of limit 3 → half
    // of the next window must pass first.
    assert.equal(slidingWaitMs({ now: t0, windowMs: W, limit: 3, current: 6, previous: 0 }), W + W / 2 + 1);
  });

  test("only the previous window blocks: wait until enough of it slid out", () => {
    // limit 3, current 1, previous 4 at the window start → need 4 × weight < 2 → weight < 0.5.
    assert.equal(slidingWaitMs({ now: t0, windowMs: W, limit: 3, current: 1, previous: 4 }), W / 2 + 1);
    const later = t0 + W / 2 + 1;
    assert.equal(slidingWaitMs({ now: later, windowMs: W, limit: 3, current: 1, previous: 4 }), 0);
  });
});
