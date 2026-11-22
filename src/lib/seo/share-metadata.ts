// Open Graph + Twitter card metadata for storefront pages.
// Next replaces (never merges) `openGraph` and `twitter` per segment, so every page that sets them
// must set all of it; this helper does, falling back to the site defaults from settings.
import "server-only";
import type { Metadata } from "next";
import { locales, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { getMediaById } from "@/lib/data/site";
import type { MediaLike } from "@/lib/media/types";
import { getSettings } from "@/lib/settings/get-settings";

const OG_LOCALE: Record<Locale, string> = { tr: "tr_TR", en: "en_US", ar: "ar_AR" };

export type ShareInput = {
  title: string;
  /** Falls back to the site description (settings.seo). */
  description?: string | null;
  /** Public path of the page, e.g. href(locale, "product", { slug }); resolved against metadataBase. */
  path: string;
  /** Falls back to the site's default share image (settings.seo.ogImageId). */
  image?: MediaLike | null;
  imageAlt?: string;
  type?: "website" | "article";
};

export async function shareMetadata(locale: Locale, input: ShareInput): Promise<Pick<Metadata, "openGraph" | "twitter">> {
  const [general, seo] = await Promise.all([getSettings("general"), getSettings("seo")]);
  const image = input.image ?? (await getMediaById(seo.ogImageId));
  const description = input.description || localize(seo.description, locale) || undefined;
  const images = image
    ? [{ url: image.url, width: image.width ?? undefined, height: image.height ?? undefined, alt: input.imageAlt ?? input.title }]
    : undefined;

  return {
    openGraph: {
      type: input.type ?? "website",
      siteName: general.siteName,
      locale: OG_LOCALE[locale],
      alternateLocale: locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      url: input.path,
      title: input.title,
      description,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: input.title,
      description,
      images: images?.map((i) => i.url),
    },
  };
}
