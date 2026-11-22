// /hesap/giris (en/ar: /account/sign-in). Public auth page, noindex. The frame is static; the form
// reads `sonra` and the session inside Suspense (a signed-in visitor goes straight on).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AuthShell, { AuthCardSkeleton, AuthHeading } from "@/components/store/account/AuthShell";
import { first, privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import SignInForm from "@/components/store/account/SignInForm";
import { formCardClass, textLinkClass, withLink } from "@/components/store/account/styles";
import WheelAuthBanner from "@/components/store/wheel/WheelAuthBanner";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href, safeReturnPath } from "@/i18n/paths";
import { getSession } from "@/lib/session";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).auth.signIn.metaTitle);
}

export default async function SignInPage({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);
  return (
    <AuthShell messages={messages}>
      <Suspense fallback={<AuthCardSkeleton />}>
        <SignInCard params={params} searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SignInCard({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  await connection(); // the session check reads the clock: request time only
  const [messages, session] = await Promise.all([getMessages(locale), getSession()]);
  const sonra = safeReturnPath(first(query.sonra));
  // No server redirect for a signed-in request: right after the form's own sign-in this page is
  // re-rendered in the action response, and the form must still publish the cart count and do a
  // full page load (fresh header and viewer). The form goes on by itself.
  const signedIn = Boolean(session?.user && !session.user.banned);
  const m = messages.auth.signIn;
  const registerHref = href(locale, "register") + (sonra ? `?sonra=${encodeURIComponent(sonra)}` : "");
  const notice = first(query.sifre) === "yenilendi" ? m.resetDone : null;

  return (
    <div className={formCardClass}>
      <AuthHeading eyebrow={m.eyebrow} heading={m.heading} intro={m.intro} />
      {/* WHEEL-UI: "Çark hediyeniz: … giriş yapınca hesabınıza tanımlanır" for a held spin (guests only). */}
      {signedIn ? null : <WheelAuthBanner locale={locale} messages={messages} variant="signIn" />}
      <SignInForm
        locale={locale}
        sonra={sonra}
        labels={messages.auth}
        forgotHref={href(locale, "forgotPassword")}
        notice={notice}
        signedIn={signedIn}
        continueTo={sonra ?? href(locale, "account")}
      />
      <div className="mt-8 space-y-3 border-t border-border pt-6 text-center text-sm text-text-muted">
        <p>
          {m.noAccount}{" "}
          <Link href={registerHref} className={textLinkClass}>
            {m.register}
          </Link>
        </p>
        <p className="text-xs leading-relaxed">
          {withLink(
            m.guest,
            <Link href={href(locale, "orderLookup")} className="text-text underline decoration-border underline-offset-4 hover:decoration-gold">
              {m.guestLink}
            </Link>,
          )}
        </p>
      </div>
    </div>
  );
}
