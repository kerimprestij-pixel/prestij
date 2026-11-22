// /hesap/sifre-sifirla?token=… (en/ar: /account/reset-password). Landing page of the reset mail.
// Public, noindex, no Referer (the token is in the URL); the token is read inside Suspense.
import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonClass } from "@/components/sections/button-styles";
import AuthShell, { AuthCardSkeleton } from "@/components/store/account/AuthShell";
import { first, privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import { ResetPasswordForm } from "@/components/store/account/PasswordForms";
import { formCardClass } from "@/components/store/account/styles";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).auth.reset.metaTitle);
}

export default async function ResetPasswordPage({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);
  return (
    <AuthShell messages={messages}>
      <Suspense fallback={<AuthCardSkeleton />}>
        <ResetCard params={params} searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function ResetCard({ params, searchParams }: PageLocaleProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, query] = await Promise.all([getMessages(locale), searchParams]);
  const m = messages.auth.reset;
  const token = first(query.token)?.trim() ?? "";
  // Better Auth's own /api/auth/reset-password/<token> callback redirects here with ?error= for a bad link.
  const valid = token.length > 0 && token.length <= 4096 && !first(query.error);

  return (
    <div className={formCardClass}>
      {valid ? (
        <ResetPasswordForm locale={locale} token={token} labels={messages.auth} forgotHref={href(locale, "forgotPassword")} />
      ) : (
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-gold/12 text-gold-text">
            <KeyRound aria-hidden className="size-7" strokeWidth={1.5} />
          </span>
          <p className="eyebrow mt-6">{m.eyebrow}</p>
          <h1 className="mt-3 font-heading text-4xl leading-tight text-balance text-text">{m.missingHeading}</h1>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-pretty text-text-muted">{m.missingText}</p>
          <Link href={href(locale, "forgotPassword")} className={buttonClass("primary", "mt-8 rtl:tracking-normal")}>
            {m.requestNew}
          </Link>
        </div>
      )}
    </div>
  );
}
