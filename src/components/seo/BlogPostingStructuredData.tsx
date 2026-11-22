// Blog post structured data: a BlogPosting whose author (when the byline is the shop) and publisher are
// the Organization by @id. Server component; cached reads only, so the page stays static.
// Placed in src/app/[locale]/blog/[slug]/page.tsx (CORE); the body is SEO-TECH's.
import type { Locale } from "@/i18n/config";
import type { PostDetail } from "@/lib/data/blog";
import { getMediaById } from "@/lib/data/site";
import { blogPostingJsonLd } from "@/lib/seo/structured-data";
import { getSettings } from "@/lib/settings/get-settings";
import JsonLdScript from "./JsonLdScript";

export type BlogPostingStructuredDataProps = { post: PostDetail; locale: Locale };

export default async function BlogPostingStructuredData({ post, locale }: BlogPostingStructuredDataProps) {
  const general = await getSettings("general");
  const logo = await getMediaById(general.logo.lightId);
  return <JsonLdScript data={blogPostingJsonLd({ post, locale, general, logo })} />;
}
