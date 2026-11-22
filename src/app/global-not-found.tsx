// 404 for URLs that match no route at all (outside /tr|/en|/ar, e.g. /api/… or /media/…).
// Only active with `experimental.globalNotFound: true` in next.config.ts; it bypasses every layout,
// so it brings its own styles, fonts and theme. Built-in dictionaries only (no DB dependency).
import type { Metadata } from "next";
import "./globals.css";
import { defaultMessages } from "@/i18n/messages";
import { href, LOCALE_CODES } from "@/i18n/paths";
import { fontVariables } from "@/lib/fonts";
import ThemeScript from "@/lib/theme/ThemeScript";
import ThemeStyle from "@/lib/theme/ThemeStyle";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: `${defaultMessages.tr.errors.notFound} · ${defaultMessages.en.errors.notFound}`,
  robots: { index: false },
};

export default function GlobalNotFound() {
  const { tr } = defaultMessages;
  return (
    <html lang="tr" dir="ltr" className={cn(fontVariables, "antialiased")} suppressHydrationWarning>
      <head>
        <ThemeScript />
        <ThemeStyle />
      </head>
      <body className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-24 text-center font-body text-text">
        <p className="eyebrow">404</p>
        <span aria-hidden className="mt-6 block h-px w-12 bg-gold/60" />
        <h1 className="mt-8 max-w-2xl text-balance font-heading text-4xl leading-tight md:text-6xl">{tr.errors.notFound}</h1>
        <p className="mt-6 max-w-md leading-relaxed text-text-muted">{tr.errors.notFoundDescription}</p>
        <ul className="mt-12 flex flex-wrap justify-center gap-3">
          {LOCALE_CODES.map((locale) => (
            <li key={locale} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
              <a
                href={href(locale, "home")}
                hrefLang={locale}
                className="inline-flex min-h-11 items-center rounded-full border border-border px-6 text-sm transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {defaultMessages[locale].errors.goHome}
              </a>
            </li>
          ))}
        </ul>
      </body>
    </html>
  );
}
