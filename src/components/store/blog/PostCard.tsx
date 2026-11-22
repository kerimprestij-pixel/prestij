// Blog cards for the listing and "more stories": the lead (featured) post and the regular card.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import type { PostCardData } from "@/lib/data/blog";
import Img from "@/lib/media/Img";
import { ownLocaleText } from "@/lib/seo/localized";
import { cn } from "@/lib/utils";
import { formatPostDate, readingLabel } from "./format";

type CardProps = { post: PostCardData; locale: Locale; messages: Messages };

/** Date · reading time, small caps. */
export function PostMeta({ post, locale, messages, className }: CardProps & { className?: string }) {
  const reading = readingLabel(post.readingMinutes, locale, messages);
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.16em] text-text-muted", className)}>
      <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt, locale)}</time>
      {reading ? (
        <>
          <span aria-hidden className="h-px w-4 bg-gold/70" />
          <span>{reading}</span>
        </>
      ) : null}
    </p>
  );
}

/** Stand-in for a post without a cover: the title's first letter on a quiet surface. */
function CoverPlaceholder({ title }: { title: string }) {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center bg-surface-2 grain">
      <span className="font-heading text-[clamp(4rem,12vw,8rem)] italic leading-none rtl:not-italic text-gold-text/45">{title.trim().charAt(0)}</span>
      <span className="absolute inset-4 border border-gold/25" />
    </div>
  );
}

function Cover({ post, locale, sizes, preload, className }: { post: PostCardData; locale: Locale; sizes: string; preload?: boolean; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-surface-2", className)}>
      {post.cover ? (
        <Img
          media={post.cover}
          // The photo's stored alt text (image search reads it). The card link is the title alone (the
          // image is outside it), so nothing is read twice. A card cover without an alt in the page's
          // language stays decorative instead of falling back to Turkish; the lead keeps the fallback.
          alt={preload ? undefined : ownLocaleText(post.cover.alt, locale)}
          locale={locale}
          sizes={sizes}
          fill
          preload={preload}
          className="transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      ) : (
        <CoverPlaceholder title={localize(post.title, locale)} />
      )}
    </div>
  );
}

/** The newest post, large: image and text side by side from md up. */
export function LeadPost({ post, locale, messages }: CardProps) {
  const title = localize(post.title, locale);
  const excerpt = localize(post.excerpt, locale);
  const link = href(locale, "post", { slug: post.slug });
  return (
    <article className="group relative grid items-center gap-8 md:grid-cols-12 md:gap-12 lg:gap-16">
      <Cover post={post} locale={locale} sizes="(min-width: 768px) 56vw, 92vw" preload className="aspect-[4/3] md:col-span-7" />
      <div className="md:col-span-5">
        <p className="eyebrow mb-5">{messages.blog.featured}</p>
        <h2 className="font-heading text-4xl leading-[1.05] tracking-tight text-balance text-text md:text-5xl">
          <Link
            href={link}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-ring"
          >
            {title}
          </Link>
        </h2>
        {excerpt ? <p className="mt-6 text-base leading-relaxed text-pretty text-text-muted md:text-lg">{excerpt}</p> : null}
        <PostMeta post={post} locale={locale} messages={messages} className="mt-6" />
        <span aria-hidden className={buttonClass("link", "mt-9")}>
          {messages.blog.readStory}
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
        </span>
      </div>
    </article>
  );
}

/** Regular card: image, meta, serif title and a short excerpt; the whole card is the link. */
export default function PostCard({ post, locale, messages, sizes = "(min-width: 1024px) 30vw, (min-width: 640px) 46vw, 92vw" }: CardProps & { sizes?: string }) {
  const title = localize(post.title, locale);
  const excerpt = localize(post.excerpt, locale);
  return (
    <article className="group relative flex h-full flex-col">
      <Cover post={post} locale={locale} sizes={sizes} className="aspect-[4/3]" />
      <PostMeta post={post} locale={locale} messages={messages} className="mt-6" />
      <h3 className="mt-3 font-heading text-2xl leading-snug text-balance text-text md:text-[1.75rem]">
        <Link
          href={href(locale, "post", { slug: post.slug })}
          className="decoration-gold/60 underline-offset-[6px] after:absolute after:inset-0 after:content-[''] group-hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-ring"
        >
          {title}
        </Link>
      </h3>
      {excerpt ? <p className="mt-3 line-clamp-3 text-[0.9375rem] leading-relaxed text-pretty text-text-muted">{excerpt}</p> : null}
    </article>
  );
}
