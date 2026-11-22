// /hesap/sifremi-unuttum (en/ar: /account/forgot-password). Public, noindex. Fully static: the form
// needs no session or query.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AuthShell from "@/components/store/account/AuthShell";
import { privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import { ForgotPasswordForm } from "@/components/store/account/PasswordForms";
import { formCardClass } from "@/components/store/account/styles";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).auth.forgot.metaTitle);
}

export default async function ForgotPasswordPage({ params }: Pick<PageLocaleProps, "params">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages(locale);
  return (
    <AuthShell messages={messages}>
      <div className={formCardClass}>
        <ForgotPasswordForm locale={locale} labels={messages.auth} signInHref={href(locale, "signIn")} />
      </div>
    </AuthShell>
  );
}
