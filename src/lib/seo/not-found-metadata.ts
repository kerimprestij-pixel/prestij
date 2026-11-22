import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";

/**
 * Metadata for a 404 rendered by a route's notFound(): the localized "page not found" title and
 * noindex. [locale]/not-found.tsx's own generateMetadata is not applied to these, so routes return
 * this from generateMetadata when their record is missing. No canonical or hreflang (the layout's
 * defaults point at the home page).
 */
export async function notFoundMetadata(locale: Locale): Promise<Metadata> {
  const messages = await getMessages(locale);
  return { title: messages.errors.notFound, robots: { index: false }, alternates: { canonical: null, languages: {} } };
}
