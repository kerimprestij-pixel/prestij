// Small helpers shared by the /hesap pages (server side).
import "server-only";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a search param. */
export const first = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

/** Account and auth pages are personal: never indexed, no Referer (tokens can be in the URL). */
export function privateMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
    alternates: { canonical: null, languages: {} },
  };
}

/** Slugs of the legal pages the auth forms link to (/sayfa/<slug>; seeded by scripts/seed-data/site.ts). */
export const MEMBERSHIP_PAGE_SLUG = "uyelik-sozlesmesi";
export const KVKK_PAGE_SLUG = "kvkk";

export type PageLocaleProps = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

export type { Locale };
