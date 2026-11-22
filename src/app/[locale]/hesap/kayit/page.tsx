// /hesap/kayit (en/ar: /account/register). Public auth page, noindex. Registration needs the
// membership agreement (/sayfa/uyelik-sozlesmesi, legal key `membership`) and shows the KVKK notice.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AuthShell, { AuthCardSkeleton } from "@/components/store/account/AuthShell";
import { KVKK_PAGE_SLUG, MEMBERSHIP_PAGE_SLUG, first, privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import RegisterForm from "@/components/store/account/RegisterForm";
import { formCardClass, textLinkClass } from "@/components/store/account/styles";
import WheelAuthBanner from "@/components/store/wheel/WheelAuthBanner";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href, safeReturnPath, signInHref } from "@/i18n/paths";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings/get-settings";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).auth.register.metaTitle);
}

export default async function RegisterPage({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);
  return (
    <AuthShell messages={messages}>
      <Suspense fallback={<AuthCardSkeleton />}>
        <RegisterCard params={params} searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function RegisterCard({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  await connection(); // the session check reads the clock: request time only
  // newsletter: cached settings (tag `settings`, refreshed when the panel saves); the optional commercial
  // e-mail box is shown only while the newsletter is on (registerAction re-checks it).
  const [messages, session, newsletter] = await Promise.all([getMessages(locale), getSession(), getSettings("newsletter")]);
  const sonra = safeReturnPath(first(query.sonra));
  if (session?.user && !session.user.banned) redirect(sonra ?? href(locale, "account"));
  const m = messages.auth.register;
  const signIn = signInHref(locale, sonra);

  return (
    <div className={formCardClass}>
      {/* WHEEL-UI: "Çark hediyeniz: … üyeliğinizi tamamlayınca hesabınıza tanımlanır" for a held spin. */}
      <WheelAuthBanner locale={locale} messages={messages} variant="register" />
      <RegisterForm
        locale={locale}
        sonra={sonra}
        labels={messages.auth}
        membershipHref={href(locale, "page", { slug: MEMBERSHIP_PAGE_SLUG })}
        kvkkHref={href(locale, "page", { slug: KVKK_PAGE_SLUG })}
        signInHref={signIn}
        newTabHint={messages.common.opensInNewTab}
        optionalLabel={messages.common.optional.toLocaleLowerCase(locale === "tr" ? "tr-TR" : locale)}
        newsletterOptIn={newsletter.enabled}
      />
      <p className="mt-8 border-t border-border pt-6 text-center text-sm text-text-muted">
        {m.haveAccount}{" "}
        <Link href={signIn} className={textLinkClass}>
          {m.signIn}
        </Link>
      </p>
    </div>
  );
}
