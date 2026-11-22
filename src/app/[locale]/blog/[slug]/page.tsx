// Blog article (/blog/<slug>). Static: every public post is prerendered; a scheduled post 404s until
// its publish time (its cache entry revalidates then). Moved slugs redirect (redirectIfMoved).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { buttonClass } from "@/components/sections/button-styles";
import { richTextClass } from "@/components/sections/RichText";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { GoldRule } from "@/components/sections/ui";
import BlogPostingStructuredData from "@/components/seo/BlogPostingStructuredData";
import { formatPostDate, localizeBodyLinks, readingLabel } from "@/components/store/blog/format";
import PostCard from "@/components/store/blog/PostCard";
import Breadcrumbs from "@/components/store/Breadcrumbs";
import ArticleSkeleton from "@/components/store/blog/ArticleSkeleton";
import ProductGrid from "@/components/store/ProductGrid";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates, siteOrigin } from "@/i18n/paths";
import { getPublishedPost, listPublishedPosts, listPublishedPostSlugs } from "@/lib/data/blog";
import { listProducts } from "@/lib/data/catalog";
import { getMediaByIds } from "@/lib/data/media";
import { redirectIfMoved } from "@/lib/data/redirects";
import Img from "@/lib/media/Img";
import { seoText } from "@/lib/seo/localized";
import { postKeywords } from "@/lib/seo/structured-data";
import { notFoundMetadata } from "@/lib/seo/not-found-metadata";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { getSettings } from "@/lib/settings/get-settings";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string; slug: string }> };

/** generateStaticParams must return at least one entry; this slug never matches and 404s. */
const PLACEHOLDER_SLUG = "__placeholder__";

// Wait for the complete static page instead of resuming the [slug] fallback shell. Next 16.4 resumes
// that shell with its build-time "use cache" results and no tag check, so the first request after a
// panel edit to a page not yet in the server's memory would show the old content once.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const slugs = await listPublishedPostSlugs();
  return (slugs.length ? slugs : [PLACEHOLDER_SLUG]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const post = await getPublishedPost(slug);
  if (!post) return notFoundMetadata(locale);
  const title = seoText(post.seo?.title, locale, localize(post.title, locale));
  const description = seoText(post.seo?.description, locale, localize(post.excerpt, locale));
  const ogId = post.seo?.ogImageId;
  const image = (ogId ? (await getMediaByIds([ogId]))[ogId] : undefined) ?? post.cover;
  const share = await shareMetadata(locale, {
    title,
    description,
    path: href(locale, "post", { slug }),
    image,
    imageAlt: localize(post.title, locale),
    type: "article",
  });
  return {
    title,
    ...(description ? { description } : {}),
    alternates: localeAlternates(locale, "post", { slug }),
    ...share,
    openGraph: {
      ...share.openGraph,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      ...(post.authorName ? { authors: [post.authorName] } : {}),
      // article:tag only on the Turkish page: the tags are Turkish (blog_posts.tags is not localized).
      ...(postKeywords(post, locale).length ? { tags: postKeywords(post, locale) } : {}),
    },
    ...(post.seo?.noIndex ? { robots: { index: false } } : {}),
  };
}

export default function PostPage({ params }: Props) {
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <Post params={params} />
    </Suspense>
  );
}

async function Post({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const post = await getPublishedPost(slug);
  if (!post) {
    await redirectIfMoved(locale, `/blog/${slug}`);
    notFound();
  }

  const [messages, related, allPosts, general] = await Promise.all([
    getMessages(locale),
    post.relatedProductIds.length > 0 ? listProducts({ ids: post.relatedProductIds }) : Promise.resolve([]),
    listPublishedPosts(),
    getSettings("general"),
  ]);

  const title = localize(post.title, locale);
  // A post without an author name is signed by the shop (the structured data names the organization too).
  const author = post.authorName?.trim() || general.siteName;
  const excerpt = localize(post.excerpt, locale);
  const body = localizeBodyLinks(sanitizeHtml(localize(post.body, locale)), locale);
  const reading = readingLabel(post.readingMinutes, locale, messages);
  const date = formatPostDate(post.publishedAt, locale);
  const order = new Map(post.relatedProductIds.map((id, i) => [id, i]));
  const products = [...related].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const more = allPosts.filter((p) => p.id !== post.id).slice(0, 3);
  const portraitCover = Boolean(post.cover?.width && post.cover.height && post.cover.height > post.cover.width);

  return (
    <article>
      <header className="container-x pt-8 md:pt-10">
        <Breadcrumbs
          label={messages.nav.breadcrumb}
          siteUrl={siteOrigin()}
          items={[
            { label: messages.common.home, href: href(locale, "home") },
            { label: messages.blog.title, href: href(locale, "blog") },
            { label: title },
          ]}
        />
        <div className="mx-auto max-w-3xl pt-12 text-center md:pt-20">
          <p className="eyebrow">
            <time dateTime={post.publishedAt}>{date}</time>
          </p>
          <h1 className="mt-6 font-heading text-[2.75rem] leading-[1.04] tracking-tight text-balance text-text md:text-7xl">{title}</h1>
          {excerpt ? (
            <p className="mx-auto mt-8 max-w-2xl font-heading text-xl leading-relaxed text-pretty text-text-muted italic rtl:not-italic md:text-2xl">{excerpt}</p>
          ) : null}
          {author || reading ? (
            <p className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.16em] text-text-muted">
              {author ? <Byline template={messages.blog.writtenBy} author={author} /> : null}
              {author && reading ? <span aria-hidden className="h-px w-4 bg-gold/70" /> : null}
              {reading ? <span>{reading}</span> : null}
            </p>
          ) : null}
        </div>
      </header>

      {post.cover ? (
        <figure className="container-x mt-12 md:mt-16">
          <div
            className={cn(
              "relative mx-auto max-w-6xl overflow-hidden rounded-md bg-surface-2 md:aspect-[16/9]",
              // Portrait photos (most product shots are 2:3): a 4:5 crop on phones, where the column is narrow.
              portraitCover ? "aspect-[4/5] sm:aspect-[3/2]" : "aspect-[3/2]",
            )}
          >
            {portraitCover ? (
              // From tablets up the portrait photo is shown whole, centred on its own blurred placeholder,
              // instead of cropped to a band of the bottle and upscaled: in the 3:2 (16:9 from md) frame it
              // is 0.44 (0.375) of the frame's width.
              <Img
                media={post.cover}
                locale={locale}
                sizes="(min-width: 1280px) 27rem, (min-width: 768px) 38vw, (min-width: 640px) 45vw, 100vw"
                fill
                preload
                className="sm:object-contain"
              />
            ) : (
              <Img media={post.cover} locale={locale} sizes="(min-width: 1280px) 72rem, 100vw" fill preload />
            )}
          </div>
        </figure>
      ) : (
        <GoldRule className="mx-auto mt-14" />
      )}

      <div className="container-x py-14 md:py-20">
        <div
          className={cn(
            richTextClass,
            "mx-auto max-w-2xl md:text-[1.1875rem] md:leading-[1.8]",
            // Editorial drop cap on the opening paragraph (Latin scripts only; Arabic letters join).
            "ltr:[&>p:first-child]:first-letter:float-left ltr:[&>p:first-child]:first-letter:me-3 ltr:[&>p:first-child]:first-letter:mt-1.5 ltr:[&>p:first-child]:first-letter:font-heading ltr:[&>p:first-child]:first-letter:text-[4.25rem] ltr:[&>p:first-child]:first-letter:leading-[0.8] ltr:[&>p:first-child]:first-letter:text-gold-text",
          )}
          dangerouslySetInnerHTML={{ __html: body }}
        />
        <footer className="mx-auto mt-16 flex max-w-2xl flex-wrap items-center justify-between gap-4 border-t border-border pt-8">
          <Link href={href(locale, "blog")} className={buttonClass("link")}>
            <ArrowLeft aria-hidden className="size-4 transition-transform duration-300 group-hover/link:-translate-x-1 rtl:-scale-x-100 rtl:group-hover/link:translate-x-1" />
            {messages.blog.backToBlog}
          </Link>
          <p className="text-xs uppercase tracking-[0.16em] text-text-muted">
            {messages.blog.publishedOn}: <time dateTime={post.publishedAt}>{date}</time>
          </p>
        </footer>
      </div>

      {products.length > 0 ? (
        <section className="border-t border-border">
          <div className="container-x py-16 md:py-24">
            <h2 className="mb-10 font-heading text-3xl text-text md:mb-14 md:text-4xl">{messages.blog.relatedProducts}</h2>
            <ProductGrid products={products} locale={locale} fromLabel={messages.product.from} regularPriceLabel={messages.campaign.regularPrice} columns={products.length >= 4 ? 4 : 3} />
          </div>
        </section>
      ) : null}

      {more.length > 0 ? (
        <section className="border-t border-border bg-surface/60">
          <div className="container-x py-16 md:py-24">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-6 md:mb-14">
              <h2 className="font-heading text-3xl text-text md:text-4xl">{messages.blog.moreStories}</h2>
              <Link href={href(locale, "blog")} className={buttonClass("link")}>
                {messages.blog.backToBlog}
                <ArrowRight aria-hidden className="size-4 transition-transform duration-300 group-hover/link:translate-x-1 rtl:-scale-x-100 rtl:group-hover/link:-translate-x-1" />
              </Link>
            </div>
            <ul className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10">
              {more.map((p) => (
                <li key={p.id}>
                  <PostCard post={p} locale={locale} messages={messages} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <BlogPostingStructuredData post={post} locale={locale} />
    </article>
  );
}

/** "Yazan: {author}" with the name set in the serif, as written (never upper-cased: names keep their casing). */
function Byline({ template, author }: { template: string; author: string }) {
  const [before, after = ""] = template.includes("{author}") ? template.split("{author}") : [`${template} `];
  return (
    <span>
      {before}
      <span className="font-heading text-[0.9375rem] tracking-normal text-text normal-case italic rtl:not-italic">{author}</span>
      {after}
    </span>
  );
}
