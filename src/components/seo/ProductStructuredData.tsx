// Product page structured data: a ProductGroup with one Product per sellable variant (or one Product),
// offers with the campaign-aware price, shipping for one unit and the campaign's end date; day 6: one
// VideoObject per product video, each in its own document, `about` the product node. Server
// component; cached reads only (settings, messages and the live campaigns that getProduct already
// read), so the page stays static. Placed in src/app/[locale]/urunler/[slug]/page.tsx (CORE); body:
// SEO-TECH, videos: VIDEO-STORE.
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { getActiveCampaigns } from "@/lib/campaigns/active";
import type { ProductDetail } from "@/lib/data/catalog";
import type { ProductReviewsData } from "@/lib/reviews/types";
import { productGroupJsonLd, productVideosJsonLd } from "@/lib/seo/structured-data";
import { getSettings } from "@/lib/settings/get-settings";
import JsonLdScript from "./JsonLdScript";

export type ProductStructuredDataProps = {
  product: ProductDetail;
  locale: Locale;
  /** The page's approved reviews (`reviewBlock.data`), so the markup matches what the page shows. */
  reviews: ProductReviewsData | null;
};

/** ISO end of the product's running campaign (priceValidUntil), from the same cached read getProduct used. */
async function campaignEndsAt(product: ProductDetail): Promise<string | null> {
  if (!product.campaign) return null;
  const { campaigns } = await getActiveCampaigns();
  const endsAt = campaigns.find((c) => c.id === product.campaign?.id)?.endsAt;
  if (!endsAt) return null;
  const date = new Date(endsAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default async function ProductStructuredData({ product, locale, reviews }: ProductStructuredDataProps) {
  const [general, shipping, seo, endsAt, messages] = await Promise.all([
    getSettings("general"),
    getSettings("shipping"),
    getSettings("seo"),
    campaignEndsAt(product),
    getMessages(locale),
  ]);
  const productDoc = productGroupJsonLd({ product, locale, reviews, general, shipping, seo, campaignEndsAt: endsAt });
  const videoDocs = productVideosJsonLd({ product, locale, videoLabel: messages.product.video, productNodeId: productDoc?.["@id"] ?? null });
  return (
    <>
      <JsonLdScript data={productDoc} />
      {videoDocs.map((doc) => (
        <JsonLdScript key={doc["@id"]} data={doc} />
      ))}
    </>
  );
}
