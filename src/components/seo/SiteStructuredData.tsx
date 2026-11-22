// Home page: the shop (OnlineStore, with the store-wide return policy) and the site (WebSite), one
// <script> each. Server component; reads cached data only (settings, the logo, whether the returns page
// is published), so the page stays static. Placed in src/app/[locale]/page.tsx (CORE); body: SEO-TECH.
import type { Locale } from "@/i18n/config";
import { href } from "@/i18n/paths";
import { getPage } from "@/lib/data/pages";
import { getMediaById } from "@/lib/data/site";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/structured-data";
import { getSettings } from "@/lib/settings/get-settings";
import JsonLdScript from "./JsonLdScript";

/** The legal page that shows the return conditions (seeded by scripts/seed-data/site.ts, legal key `returns`). */
export const RETURNS_PAGE_SLUG = "iade-ve-degisim";

export type SiteStructuredDataProps = { locale: Locale };

export default async function SiteStructuredData({ locale }: SiteStructuredDataProps) {
  const [general, seo, locales, returnsPage] = await Promise.all([
    getSettings("general"),
    getSettings("seo"),
    getSettings("locales"),
    getPage(RETURNS_PAGE_SLUG),
  ]);
  const logo = await getMediaById(general.logo.lightId);
  const returnsPath = returnsPage ? href(locale, "page", { slug: RETURNS_PAGE_SLUG }) : null;
  return (
    <>
      <JsonLdScript data={organizationJsonLd({ locale, general, seo, logo, languages: locales.enabled, returnsPath })} />
      <JsonLdScript data={webSiteJsonLd({ locale, general, seo, languages: locales.enabled })} />
    </>
  );
}
