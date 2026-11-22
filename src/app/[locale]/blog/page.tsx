// Blog listing (/blog; en/ar: /blog too). Static: the post list is cached (tag `blog`) and revalidates
// at the next scheduled post's publish time. With no posts yet it shows an editorial "coming soon".
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Feather } from "lucide-react";
import { buttonClass } from "@/components/sections/button-styles";
import { GoldRule } from "@/components/sections/ui";
import PostCard, { LeadPost } from "@/components/store/blog/PostCard";
import Breadcrumbs from "@/components/store/Breadcrumbs";
import ListingHeader from "@/components/store/ListingHeader";
import { ListingSkeleton } from "@/components/store/ListingSkeleton";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { href, localeAlternates, siteOrigin } from "@/i18n/paths";
import { listPublishedPosts } from "@/lib/data/blog";
import { shareMetadata } from "@/lib/seo/share-metadata";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  // Search-result texts (panel-editable under Metinler); the visible title and intro are the fallback.
  const title = messages.blog.metaTitle || messages.blog.title;
  const description = messages.blog.metaDescription || messages.blog.intro;
  return {
    title,
    description,
    alternates: localeAlternates(locale, "blog"),
    ...(await shareMetadata(locale, { title, description, path: href(locale, "blog") })),
  };
}

export default function BlogPage({ params }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <Blog params={params} />
    </Suspense>
  );
}

async function Blog({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, posts] = await Promise.all([getMessages(locale), listPublishedPosts()]);
  const [lead, ...rest] = posts;

  return (
    <>
      <ListingHeader
        locale={locale}
        eyebrow={messages.blog.eyebrow}
        title={messages.blog.title}
        intro={messages.blog.intro}
        breadcrumbs={
          <Breadcrumbs
            label={messages.nav.breadcrumb}
            siteUrl={siteOrigin()}
            items={[{ label: messages.common.home, href: href(locale, "home") }, { label: messages.blog.title }]}
          />
        }
      />
      {lead ? (
        <>
          <section className="container-x py-14 md:py-20" aria-label={messages.blog.featured}>
            <LeadPost post={lead} locale={locale} messages={messages} />
          </section>
          {rest.length > 0 ? (
            <section className="border-t border-border">
              <div className="container-x py-16 md:py-24">
                <h2 className="mb-10 font-heading text-3xl text-text md:mb-14 md:text-4xl">{messages.blog.latest}</h2>
                <ul className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10 lg:gap-y-20">
                  {rest.map((post) => (
                    <li key={post.id}>
                      <PostCard post={post} locale={locale} messages={messages} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <ComingSoon locale={locale} messages={messages} />
      )}
    </>
  );
}

function ComingSoon({ locale, messages }: { locale: Locale; messages: Messages }) {
  return (
    <section className="container-x py-20 md:py-32">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <span aria-hidden className="grid size-16 place-items-center rounded-full border border-gold/50 text-gold-text">
          <Feather className="size-6 rtl:-scale-x-100" strokeWidth={1.25} />
        </span>
        <h2 className="mt-10 font-heading text-5xl italic leading-none rtl:not-italic text-text md:text-6xl">{messages.blog.comingSoon}</h2>
        <GoldRule className="my-8" />
        <p className="max-w-md text-base leading-relaxed text-pretty text-text-muted md:text-lg">{messages.blog.emptyDescription}</p>
        <Link href={href(locale, "products")} className={buttonClass("secondary", "mt-10")}>
          {messages.blog.exploreCollection}
        </Link>
      </div>
    </section>
  );
}
