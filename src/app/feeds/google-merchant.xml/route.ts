// GET /feeds/google-merchant.xml (MERCHANT_FEED_PATH): the Google Merchant Center product feed, also usable
// as a Meta catalog feed. Every read is a cached function the storefront already uses (products and
// categories/media tags, the schedule-aware `campaigns` cache, `settings`), so the response is prerendered
// at build time, refreshed by the same tags as the product pages, and re-read when a campaign starts or
// ends. No request data is read (no `request`, cookies or headers), so it stays static. The path ends in
// ".xml", so src/proxy.ts never localizes or redirects it.
import type { ProductDetail } from "@/lib/data/catalog";
import { siteOrigin } from "@/i18n/paths";
import { getActiveCampaigns } from "@/lib/campaigns/active";
import { getProduct, listProductSlugs } from "@/lib/data/catalog";
import { buildMerchantFeed } from "@/lib/seo/merchant-feed";
import { getSettings } from "@/lib/settings/get-settings";

export async function GET(): Promise<Response> {
  const [slugs, campaigns, general, seo, shipping] = await Promise.all([
    listProductSlugs(),
    getActiveCampaigns(),
    getSettings("general"),
    getSettings("seo"),
    getSettings("shipping"),
  ]);
  // The same product data (and campaign choice) the product pages render; the builder drops samples,
  // noindex and business-only products.
  const products = (await Promise.all(slugs.map((slug) => getProduct(slug)))).filter((p): p is ProductDetail => p !== null);
  const xml = buildMerchantFeed({ products, campaigns, general, seo, shipping }, siteOrigin());
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // A data file for Merchant Center, not a page for web search results.
      "X-Robots-Tag": "noindex",
    },
  });
}
