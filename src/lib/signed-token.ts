// Signed, purpose-bound links without a DB lookup: review links, newsletter confirm / unsubscribe,
// subscription "skip" links. HMAC-SHA256 with a key derived per purpose from BETTER_AUTH_SECRET via HKDF,
// so a token minted for one purpose never verifies for another, and rotating the secret voids them all.
//
// Token: "v1.<base64url(JSON {p: payload, e: expiry epoch seconds | null})>.<base64url(HMAC)>". The
// payload is readable by whoever holds the link (signed, not encrypted): put ids in it, never personal
// data. Verification is timing-safe and checks the expiry. Single use (e.g. one review per order line)
// is the caller's job, usually through a unique index.
//
// No "server-only" import so unit tests can load it; it reads the secret from process.env only when a
// token is signed or verified (never available in client bundles).
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export type TokenPayload = Record<string, unknown>;
export type VerifyTokenResult<T extends TokenPayload = TokenPayload> =
  | { ok: true; payload: T; expiresAt: Date | null }
  | { ok: false; reason: "malformed" | "invalid" | "expired" };

const VERSION = "v1";
const HKDF_SALT = "prestij/signed-token/v1";
/** Lower-case label such as "review", "newsletter-confirm", "newsletter-unsubscribe". */
const PURPOSE_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
/** Longer input is refused before any crypto work. */
export const MAX_TOKEN_LENGTH = 2048;
/** Longest allowed lifetime (ten years); `undefined` means "does not expire". */
const MAX_TTL_SECONDS = 10 * 365 * 24 * 3600;

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

function assertPurpose(purpose: string): void {
  if (!PURPOSE_PATTERN.test(purpose)) throw new Error(`signed-token: invalid purpose "${purpose}"`);
}

export type TokenSigner = {
  signToken(purpose: string, payload: TokenPayload, ttlSeconds?: number): string;
  verifyToken<T extends TokenPayload = TokenPayload>(purpose: string, token: unknown): VerifyTokenResult<T>;
};

/**
 * A signer bound to one secret (tests pass their own secret and clock; the app uses `signToken` /
 * `verifyToken` below, which use BETTER_AUTH_SECRET).
 */
export function createTokenSigner(secret: string | (() => string), options: { now?: () => number } = {}): TokenSigner {
  const now = options.now ?? Date.now;
  const keys = new Map<string, Buffer>();
  const keyFor = (purpose: string): Buffer => {
    let key = keys.get(purpose);
    if (!key) {
      const value = typeof secret === "function" ? secret() : secret;
      if (!value || value.length < 16) throw new Error("signed-token: the signing secret is missing or too short");
      key = Buffer.from(hkdfSync("sha256", value, HKDF_SALT, `purpose:${purpose}`, 32));
      keys.set(purpose, key);
    }
    return key;
  };
  const mac = (purpose: string, body: string) => createHmac("sha256", keyFor(purpose)).update(`${VERSION}.${body}`).digest();

  return {
    signToken(purpose, payload, ttlSeconds) {
      assertPurpose(purpose);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("signed-token: payload must be an object");
      let expiry: number | null = null;
      if (ttlSeconds !== undefined) {
        if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) throw new Error("signed-token: invalid ttlSeconds");
        expiry = Math.floor(now() / 1000) + Math.ceil(ttlSeconds);
      }
      const body = b64url(JSON.stringify({ p: payload, e: expiry }));
      const token = `${VERSION}.${body}.${b64url(mac(purpose, body))}`;
      if (token.length > MAX_TOKEN_LENGTH) throw new Error("signed-token: payload too large");
      return token;
    },

    verifyToken<T extends TokenPayload = TokenPayload>(purpose: string, token: unknown): VerifyTokenResult<T> {
      assertPurpose(purpose);
      if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== VERSION || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
        return { ok: false, reason: "malformed" };
      }
      const [, body, sig] = parts;
      const given = Buffer.from(sig, "base64url");
      // Canonical encoding only (the last character carries padding bits): one token, one spelling.
      if (given.toString("base64url") !== sig) return { ok: false, reason: "malformed" };
      const expected = mac(purpose, body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };

      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      } catch {
        return { ok: false, reason: "malformed" };
      }
      if (!decoded || typeof decoded !== "object") return { ok: false, reason: "malformed" };
      const { p, e } = decoded as { p?: unknown; e?: unknown };
      if (!p || typeof p !== "object" || Array.isArray(p) || (e !== null && typeof e !== "number")) return { ok: false, reason: "malformed" };
      if (typeof e === "number" && Math.floor(now() / 1000) >= e) return { ok: false, reason: "expired" };
      return { ok: true, payload: p as T, expiresAt: typeof e === "number" ? new Date(e * 1000) : null };
    },
  };
}

const appSigner = createTokenSigner(() => process.env.BETTER_AUTH_SECRET ?? "");

/**
 * Signs `payload` for `purpose`. `ttlSeconds` omitted = the link does not expire (unsubscribe links).
 * Throws when BETTER_AUTH_SECRET is missing (fail closed).
 */
export function signToken(purpose: string, payload: TokenPayload, ttlSeconds?: number): string {
  return appSigner.signToken(purpose, payload, ttlSeconds);
}

/**
 * Verifies a token for `purpose` (timing-safe, expiry checked). The payload is only as trustworthy as
 * its signature: validate its shape (zod) and re-read every id from the DB.
 */
export function verifyToken<T extends TokenPayload = TokenPayload>(purpose: string, token: unknown): VerifyTokenResult<T> {
  return appSigner.verifyToken<T>(purpose, token);
}
