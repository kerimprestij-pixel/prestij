// Provider credentials and endpoints from the environment (never from the DB, never logged, never
// shown in the panel: only "tanımlı / tanımlı değil"). Read on every call so tests and the payment mock
// can switch them at runtime.
import "server-only";
import { IYZICO_LIVE_URL, IYZICO_SANDBOX_URL } from "./iyzico-crypto";
import { PAYTR_DEFAULT_URL } from "./paytr-crypto";

const env = (name: string) => (process.env[name] ?? "").trim();

export type BaseUrlCheck = { ok: true; url: string; local: boolean } | { ok: false; problem: string };

/**
 * True when the local payment mock may be used: outside production, or in a production build that serves
 * a local origin (NEXT_PUBLIC_SITE_URL on localhost / 127.0.0.1 / *.localhost, e.g. `next start` for an
 * end-to-end check). A live site always has a public origin, so it can never talk to a local mock.
 */
export function localPaymentMockAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    const host = site.hostname;
    return site.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost"));
  } catch {
    return false;
  }
}

/**
 * An optional *_BASE_URL override: https:// anywhere, or http://localhost / http://127.0.0.1 where the
 * local mock is allowed (scripts/payment-mock.mjs; see localPaymentMockAllowed). Path, query and
 * credentials are not allowed.
 */
export function checkBaseUrl(raw: string, fallback: string): BaseUrlCheck {
  if (!raw) return { ok: true, url: fallback, local: false };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: "geçerli bir adres değil" };
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return { ok: false, problem: "yalnızca alan adı olmalı (yol, sorgu veya kullanıcı bilgisi içeremez)" };
  }
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol === "https:") return { ok: true, url: url.origin, local: false };
  if (local && localPaymentMockAllowed()) return { ok: true, url: url.origin, local: true };
  return { ok: false, problem: local ? "canlı ortamda yerel test sunucusu kullanılamaz" : "https:// ile başlamalı" };
}

export type IyzicoEnv = { apiKey: string; secretKey: string; baseUrl: string; local: boolean };
export type PaytrEnv = { merchantId: string; merchantKey: string; merchantSalt: string; baseUrl: string; local: boolean };

/** iyzico keys + the endpoint for the panel's test mode; null when a key is missing or the override is invalid. */
export function iyzicoEnv(testMode: boolean): IyzicoEnv | null {
  const apiKey = env("IYZICO_API_KEY");
  const secretKey = env("IYZICO_SECRET_KEY");
  const base = checkBaseUrl(env("IYZICO_BASE_URL"), testMode ? IYZICO_SANDBOX_URL : IYZICO_LIVE_URL);
  if (!apiKey || !secretKey || !base.ok) return null;
  return { apiKey, secretKey, baseUrl: base.url, local: base.local };
}

/** PayTR keys + endpoint (test mode is a request flag, not another host); null when incomplete. */
export function paytrEnv(): PaytrEnv | null {
  const merchantId = env("PAYTR_MERCHANT_ID");
  const merchantKey = env("PAYTR_MERCHANT_KEY");
  const merchantSalt = env("PAYTR_MERCHANT_SALT");
  const base = checkBaseUrl(env("PAYTR_BASE_URL"), PAYTR_DEFAULT_URL);
  if (!merchantId || !merchantKey || !merchantSalt || !base.ok) return null;
  return { merchantId, merchantKey, merchantSalt, baseUrl: base.url, local: base.local };
}

export type ProviderEnvStatus = {
  provider: "iyzico" | "paytr";
  /** Each variable: defined or not (never the value). */
  variables: { name: string; defined: boolean }[];
  ready: boolean;
  /** Endpoint the site talks to (test / live / local mock), with a Turkish problem when the override is invalid. */
  endpoint: { url: string | null; kind: "sandbox" | "live" | "local" | "custom"; problem: string | null };
};

/** For /panel/ayarlar/odeme: which variables are set and which endpoint is used (no secret values). */
export function providerEnvStatus(testMode: boolean): ProviderEnvStatus[] {
  const defined = (name: string) => ({ name, defined: env(name) !== "" });
  const iyzicoBase = checkBaseUrl(env("IYZICO_BASE_URL"), testMode ? IYZICO_SANDBOX_URL : IYZICO_LIVE_URL);
  const paytrBase = checkBaseUrl(env("PAYTR_BASE_URL"), PAYTR_DEFAULT_URL);
  const kind = (base: BaseUrlCheck, defaultKind: "sandbox" | "live", override: string): ProviderEnvStatus["endpoint"] =>
    base.ok
      ? { url: base.url, kind: base.local ? "local" : override ? "custom" : defaultKind, problem: null }
      : { url: null, kind: "custom", problem: base.problem };
  return [
    {
      provider: "iyzico",
      variables: [defined("IYZICO_API_KEY"), defined("IYZICO_SECRET_KEY"), defined("IYZICO_BASE_URL")],
      ready: iyzicoEnv(testMode) !== null,
      endpoint: kind(iyzicoBase, testMode ? "sandbox" : "live", env("IYZICO_BASE_URL")),
    },
    {
      provider: "paytr",
      variables: [defined("PAYTR_MERCHANT_ID"), defined("PAYTR_MERCHANT_KEY"), defined("PAYTR_MERCHANT_SALT"), defined("PAYTR_BASE_URL")],
      ready: paytrEnv() !== null,
      endpoint: kind(paytrBase, "live", env("PAYTR_BASE_URL")),
    },
  ];
}

/** Origin of the PayTR iframe for the /odeme/kart CSP (frame-src); also used by next.config.ts' twin. */
export function paytrFrameOrigin(): string {
  const base = checkBaseUrl(env("PAYTR_BASE_URL"), PAYTR_DEFAULT_URL);
  return base.ok ? base.url : PAYTR_DEFAULT_URL;
}
