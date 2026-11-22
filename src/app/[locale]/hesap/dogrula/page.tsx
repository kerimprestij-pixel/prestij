// /hesap/dogrula (en/ar: /account/verify): landing page of the verification e-mail
// (?token=<jwt>[&sonra=<local path>]). Public (excluded from the proxy's /hesap gate), noindex and
// no-referrer (the token is in the URL). Built by CORE-COMMS, framed like the other auth pages by
// ACCOUNTS. The token is read inside Suspense, so the frame stays static.
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import VerifyEmailForm from "@/components/store/account/VerifyEmailForm";
import AuthShell, { AuthCardSkeleton } from "@/components/store/account/AuthShell";
import { privateMetadata } from "@/components/store/account/page-helpers";
import { formCardClass } from "@/components/store/account/styles";
import { buttonClass } from "@/components/sections/button-styles";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href, safeReturnPath, signInHref } from "@/i18n/paths";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  return privateMetadata(messages.auth.verify.title);
}

export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);
  return (
    <AuthShell messages={messages}>
      <Suspense fallback={<AuthCardSkeleton />}>
        <Verify params={params} searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

async function Verify({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, query] = await Promise.all([getMessages(locale), searchParams]);
  const m = messages.auth.verify;
  const token = first(query.token)?.trim() || null;
  const sonra = safeReturnPath(first(query.sonra));
  // Better Auth's own /api/auth/verify-email redirects here with ?error= when its link is used.
  const error = first(query.error);
  const errorText = error === "TOKEN_EXPIRED" ? m.expired : error ? m.invalid : null;
  const signIn = signInHref(locale, sonra);

  return (
    <div className={`${formCardClass} text-center`}>
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-gold/12 text-gold-text">
        <MailCheck aria-hidden className="size-7" strokeWidth={1.5} />
      </span>
      <p className="eyebrow mt-6">{m.title}</p>
      {token && !errorText ? (
        <>
          <h1 className="mt-3 font-heading text-4xl leading-tight text-balance text-text">{m.heading}</h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-pretty text-text-muted">{m.intro}</p>
          <div className="mt-8 text-start">
            <VerifyEmailForm locale={locale} token={token} sonra={sonra} signInHref={signIn} labels={m} />
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-3 font-heading text-4xl leading-tight text-balance text-text">{m.missingHeading}</h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-pretty text-text-muted">{errorText ?? m.missingText}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href={signIn} className={buttonClass("primary", "rtl:tracking-normal")}>
              {m.goToSignIn}
            </Link>
            <Link href={href(locale, "home")} className={buttonClass("secondary", "rtl:tracking-normal")}>
              {messages.errors.goHome}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
