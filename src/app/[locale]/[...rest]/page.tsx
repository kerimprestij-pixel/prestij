import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { defaultLocale, isLocale } from "@/i18n/config";
import { notFoundMetadata } from "@/lib/seo/not-found-metadata";

/**
 * The localized "page not found" title and noindex (not-found.tsx's own metadata is not applied
 * here). Reads the root param only, so the unmatched segments stay out of the metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const value: unknown = await rootLocale();
  return notFoundMetadata(isLocale(value) ? value : defaultLocale);
}

// Any unmatched URL under /tr, /en or /ar lands here, so the localized not-found.tsx renders inside
// the storefront layout (header, footer, correct lang/dir) instead of the bare framework 404.
export default function UnmatchedRoute(): never {
  notFound();
}
