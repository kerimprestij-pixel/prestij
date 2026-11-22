// Escaping and placeholder filling for e-mails (pure). The rule: a text is HTML-escaped FIRST, then
// its `{placeholder}` tokens are replaced by the (separately escaped) values in a single pass, so a
// value can neither inject markup nor smuggle in another placeholder.
import type { EmailPlaceholderValues } from "./types";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML content and double- or single-quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function valueOf(vars: EmailPlaceholderValues, key: string): string | undefined {
  if (!Object.hasOwn(vars, key)) return undefined;
  const value = vars[key];
  return value === null || value === undefined ? "" : String(value);
}

/** HTML: escape the template, then fill `{key}` with escaped values. Unknown keys stay as written. */
export function fillHtml(template: string, vars: EmailPlaceholderValues): string {
  return escapeHtml(template).replace(PLACEHOLDER, (match, key: string) => {
    const value = valueOf(vars, key);
    return value === undefined ? match : escapeHtml(value);
  });
}

/** Plain text: fill `{key}` in one pass (no escaping; for the text part and headers). */
export function fillText(template: string, vars: EmailPlaceholderValues): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = valueOf(vars, key);
    return value === undefined ? match : value;
  });
}

/** Distinct `{placeholder}` names used in a text, in order of appearance. */
export function findPlaceholders(text: string | null | undefined): string[] {
  const names = new Set<string>();
  for (const [, name] of (text ?? "").matchAll(PLACEHOLDER)) names.add(name);
  return [...names];
}

/** Placeholders in `text` that are not allowed (for validating panel overrides). */
export function unknownPlaceholders(text: string | null | undefined, allowed: readonly string[]): string[] {
  return findPlaceholders(text).filter((name) => !allowed.includes(name));
}

/** C0 controls, DEL and the Unicode line / paragraph separators. */
const CONTROL_CHARS = /[\x00-\x1f\x7f\u2028\u2029]+/g;

/** Whitespace, controls and backslashes: never part of a link we write. */
const UNSAFE_URL_CHARS = /[\s\x00-\x1f\x7f\\]/;

/** One line for a header (subject): no CR/LF or other control characters, collapsed spaces, at most `max` chars. */
export function headerText(value: string, max = 250): string {
  const clean = value
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * A URL that may go into an e-mail link: https (and http only for local hosts), mailto: and tel:.
 * Site paths ("/tr/hesap") are made absolute with `siteUrl`. Anything else (javascript:, data:,
 * protocol-relative, credentials in the URL) → null.
 */
export function safeEmailUrl(raw: string | null | undefined, siteUrl: string): string | null {
  const value = (raw ?? "").trim();
  if (!value || UNSAFE_URL_CHARS.test(value)) return null;
  if (/^(mailto|tel):/i.test(value)) return /^(mailto|tel):[^<>"']+$/i.test(value) ? value : null;
  let url: URL;
  try {
    url = value.startsWith("/") && !value.startsWith("//") ? new URL(value, `${siteUrl}/`) : new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && isLocalHost(url.hostname)) return url.href;
  return null;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost") || hostname.endsWith(".test");
}

/** A CSS color that is safe inside an inline style (hex only). */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) ? value : fallback;
}
