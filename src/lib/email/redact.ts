// Secret links in stored e-mails (pure: unit tests import it). The e-mail log (/panel/e-postalar,
// every staff role) shows the stored body, but several of our links work as a credential for whoever
// holds them: password reset and e-mail verification (account takeover), newsletter confirm and
// unsubscribe, review links, subscription skip links and guest order links. The log therefore never
// shows their values, and the two account templates are never sent again from the log.

/** Query parameters whose value is a credential in our e-mail links. */
export const SECRET_LINK_PARAMS = ["token", "t", "degerlendir", "atla"] as const;

/**
 * Templates whose link signs the reader in or changes the password. Their stored body is scrubbed once
 * the mail is sent, and "Tekrar gönder" refuses them (the customer asks for a fresh link on the site).
 */
export const AUTH_LINK_TEMPLATES: ReadonlySet<string> = new Set(["account_verify", "password_reset"]);

/** What a secret value is replaced with. */
export const REDACTED_VALUE = "gizlendi";

// A separator (raw, HTML-escaped or percent-encoded inside another parameter such as `sonra`), the
// parameter name, "=" (raw or %3D) and the value up to the next separator, quote, tag or space.
const SEPARATOR = String.raw`(\?|&amp;|&#38;|&#x26;|&|%3F|%26)`;
const VALUE = String.raw`(?:%(?!26|23)[0-9a-f]{2}|[^&#"'<>\s%])+`;
const PATTERN = new RegExp(`${SEPARATOR}(${SECRET_LINK_PARAMS.join("|")})(=|%3D)${VALUE}`, "gi");

/** `body` with every secret link parameter's value replaced by REDACTED_VALUE (HTML, text or a header). */
export function redactEmailSecrets(body: string): string {
  if (!body) return body;
  return body.replace(PATTERN, (_match, separator: string, name: string, equals: string) => `${separator}${name}${equals}${REDACTED_VALUE}`);
}

/** True when `body` holds at least one secret link value. */
export function hasEmailSecrets(body: string): boolean {
  return redactEmailSecrets(body) !== body;
}
