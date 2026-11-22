// NEXT_PUBLIC_SITE_URL checks (go-live CF-5, CF-10). Pure, with no imports: next.config.ts loads this file at
// build time (relative import, compiled by Next's config loader) and the panel's launch checklist uses it too.
// Unit-tested in tests/unit/golive-config.test.ts.

/** Why a value cannot be a live site's address: unset, unparsable, not https://, or a local host. */
export type PublicSiteUrlProblem = "missing" | "invalid" | "not_https" | "local";

/** localhost, *.localhost, the IPv4 loopback range, ::1 and 0.0.0.0 (a URL's hostname, lower case). */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]" ||
    host === "::1" ||
    host === "0.0.0.0"
  );
}

/** Null when `raw` can be the public address of a live site (https:// on a non-local host). */
export function publicSiteUrlProblem(raw: string | null | undefined): PublicSiteUrlProblem | null {
  const value = (raw ?? "").trim();
  if (!value) return "missing";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:") return "not_https";
  if (!url.hostname || isLocalHostname(url.hostname)) return "local";
  return null;
}

/** Turkish explanations for the panel (the value itself is shown next to them, it is not a secret). */
export const SITE_URL_PROBLEM_TEXT: Record<PublicSiteUrlProblem, string> = {
  missing: "NEXT_PUBLIC_SITE_URL tanımlı değil.",
  invalid: "NEXT_PUBLIC_SITE_URL geçerli bir adres değil.",
  not_https: "Site adresi https:// ile başlamıyor.",
  local: "Site adresi yerel bir adres (localhost); ziyaretçiler ve ödeme kuruluşları ulaşamaz.",
};

/**
 * The build guard: on a Vercel production build (VERCEL_ENV=production) NEXT_PUBLIC_SITE_URL must be the
 * live https address, because it is baked into canonicals, the sitemap, e-mail links and payment return
 * URLs. Returns the error message for the build log, or null (always null outside Vercel production, so
 * local builds, previews and `next start` checks on *.localhost keep working).
 */
export function productionSiteUrlError(env: Record<string, string | undefined>): string | null {
  if ((env.VERCEL_ENV ?? "").trim() !== "production") return null;
  const problem = publicSiteUrlProblem(env.NEXT_PUBLIC_SITE_URL);
  if (!problem) return null;
  const why = {
    missing: "it is not set",
    invalid: "it is not a valid URL",
    not_https: "it does not start with https://",
    local: "it points at a local host",
  }[problem];
  return (
    `NEXT_PUBLIC_SITE_URL cannot be used for a production build: ${why}. ` +
    "Set it to the live address (e.g. https://www.example.com.tr, no trailing slash) in the Vercel project's " +
    "Environment Variables (Production), then redeploy without the build cache."
  );
}
