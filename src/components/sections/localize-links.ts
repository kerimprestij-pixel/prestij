// Internal links in panel-authored rich text are stored canonical and locale-less (`/urunler/x`, from
// the link picker). On the storefront they must point to the reader's language: otherwise a reader on
// /ar is sent through the proxy's locale redirect, which follows the cookie / Accept-Language, not the
// page they were reading. Pure (unit-tested).
import type { Locale } from "@/i18n/config";
import { isLocaleCode, localizePath } from "@/i18n/paths";
import { richTextHtml } from "./sanitize-html";

/**
 * Sanitized HTML → internal links (`/urunler/x`) point to the reader's language (`/en/products/x`).
 * External, anchor, mailto and tel links, and paths that already carry a locale, are left as they are.
 */
export function localizeBodyLinks(html: string, locale: Locale): string {
  return html.replace(/<a href="(\/(?!\/)[^"]*)"/g, (match, path: string) => {
    const first = path.split(/[/?#]/)[1] ?? "";
    if (isLocaleCode(first)) return match;
    return `<a href="${localizePath(locale, path)}"`;
  });
}

/** richTextHtml (sanitized HTML or plain-text paragraphs) with internal links localized. */
export function localizedRichTextHtml(text: string | null | undefined, locale: Locale): string {
  return localizeBodyLinks(richTextHtml(text), locale);
}
