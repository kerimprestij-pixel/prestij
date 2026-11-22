// /sitemap.xml: every indexable storefront URL in each enabled locale, with hreflang alternates and
// image entries (product galleries, blog covers). All reads are cached, so the file is prerendered and
// refreshed by the catalog/page/blog/media tags. The list is built by buildSitemap, which the IndexNow
// job uses too.
import type { MetadataRoute } from "next";
import { getSitemapData } from "@/lib/data/sitemap";
import { buildSitemap } from "@/lib/seo/sitemap-entries";
import { getSettings } from "@/lib/settings/get-settings";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [data, { enabled }] = await Promise.all([getSitemapData(), getSettings("locales")]);
  return buildSitemap(data, enabled);
}
