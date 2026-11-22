// Storefront ROOT layout (renders <html>). Fully static per locale: no cookies/headers here; anything
// visitor-specific is a client island or sits inside <Suspense> further down.
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "../globals.css";
import CartDrawer from "@/components/cart/CartDrawer";
import { cartUiLabels } from "@/components/cart/labels";
import { FavoriteLabelsProvider } from "@/components/store/account/FavoriteButton";
import AnnouncementBar from "@/components/store/AnnouncementBar";
import Footer from "@/components/store/Footer";
import Header from "@/components/store/Header";
import { ShellMessagesProvider } from "@/components/store/ShellMessages";
import ViewerProvider from "@/components/store/viewer/ViewerProvider";
import GiftWheel from "@/components/store/wheel/GiftWheel";
import WhatsAppButton from "@/components/store/WhatsAppButton";
import { defaultLocale, isLocale, localeDir, locales } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href, localeAlternates, siteOrigin } from "@/i18n/paths";
import { fontVariables } from "@/lib/fonts";
import { shareMetadata } from "@/lib/seo/share-metadata";
import { verificationMetadata } from "@/lib/seo/verification-metadata";
import { getSettings } from "@/lib/settings/get-settings";
import ThemeScript from "@/lib/theme/ThemeScript";
import ThemeStyle from "@/lib/theme/ThemeStyle";
import { cn } from "@/lib/utils";

type LocaleLayoutProps = { children: ReactNode; params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1730" },
  ],
};

export async function generateMetadata({ params }: Pick<LocaleLayoutProps, "params">): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : defaultLocale;
  const [seo, general] = await Promise.all([getSettings("seo"), getSettings("general")]);

  const title = localize(seo.defaultTitle, locale) || general.siteName;
  const description = localize(seo.description, locale);
  const template = seo.titleTemplate.includes("%s") ? seo.titleTemplate : `%s | ${general.siteName}`;
  // Search engine ownership meta tags (settings.seo.verification): google, yandex, bing → msvalidate.01.
  const verification = verificationMetadata(seo.verification);

  return {
    metadataBase: new URL(siteOrigin()),
    applicationName: general.siteName,
    title: { default: title, template },
    description,
    // Pages should override this with localeAlternates(locale, route, params) for their own URL.
    alternates: localeAlternates(locale, "home"),
    // Pages replace this with their own shareMetadata(...) (Next does not merge openGraph).
    ...(await shareMetadata(locale, { title, description, path: href(locale, "home") })),
    formatDetection: { telephone: false, address: false, email: false },
    ...(verification ? { verification } : {}),
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);

  return (
    <html
      lang={locale}
      dir={localeDir(locale)}
      className={cn(fontVariables, "antialiased")}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <ThemeScript />
        <ThemeStyle />
      </head>
      <body className="flex min-h-dvh flex-col bg-bg font-body text-text">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-brand-contrast focus:shadow-lg"
        >
          {messages.common.skipToContent}
        </a>
        {/* Signed-in visitor for client islands (header, favorites, business prices): loaded by a
            Server Action after hydration, so this layout and every static page stay prerendered. */}
        <ViewerProvider>
          {/* Cached data (like ThemeStyle), so it renders in the static shell, in document order. */}
          <AnnouncementBar
            locale={locale}
            labels={{
              region: messages.announcement.region,
              dismiss: messages.announcement.dismiss,
              previous: messages.announcement.previous,
              next: messages.announcement.next,
            }}
          />
          <Header locale={locale} messages={messages} />
          <ShellMessagesProvider
            value={{
              locale,
              homeHref: href(locale, "home"),
              errors: {
                generic: messages.errors.generic,
                genericDescription: messages.errors.genericDescription,
                retry: messages.errors.retry,
                goHome: messages.errors.goHome,
              },
            }}
          >
            {/* ACCOUNTS: labels + locale for the favorite hearts on product cards and pages. */}
            <FavoriteLabelsProvider locale={locale} labels={messages.account.favorite}>
              <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
                {children}
              </main>
            </FavoriteLabelsProvider>
          </ShellMessagesProvider>
          <Footer locale={locale} messages={messages} />
          <WhatsAppButton locale={locale} label={messages.whatsapp.label} newTabHint={messages.common.opensInNewTab} />
          {/* Client island: opened by the header cart icon and add to cart; loads the cart on open. */}
          <CartDrawer
            locale={locale}
            labels={cartUiLabels(messages)}
            links={{ cart: href(locale, "cart"), checkout: href(locale, "checkout"), products: href(locale, "products") }}
          />
          {/* WHEEL-UI: gift wheel (cached display-only teaser → tiny client island; dialog loads lazily). */}
          <GiftWheel locale={locale} messages={messages} />
        </ViewerProvider>
      </body>
    </html>
  );
}
