// /hesap/profil (en/ar: /account/profile): name, phone, preferred language; password change (other
// sessions revoked); commercial e-mail preference; "Hesabımı sil" (anonymization, orders kept).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AccountShell, { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import { KVKK_PAGE_SLUG, privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import { DeleteAccount, MarketingPreference, PasswordForm, PersonalForm, type ProfileLabels } from "@/components/store/account/ProfileForms";
import { db } from "@/db";
import { isLocale, localeNames, locales, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { requireAccountUser } from "@/lib/account/session";
import { marketingState } from "@/lib/account/service";
import { getSettings } from "@/lib/settings/get-settings";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).account.profilePage.title);
}

export default async function ProfilePage({ params }: Pick<PageLocaleProps, "params">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AccountShell locale={locale} active="profile">
      <Suspense fallback={<AccountContentSkeleton />}>
        <Profile locale={locale} />
      </Suspense>
    </AccountShell>
  );
}

async function Profile({ locale }: { locale: Locale }) {
  const user = await requireAccountUser(locale, href(locale, "accountProfile"));
  // newsletter: cached settings (tag `settings`): while it is off the subscribe button is hidden (go-live SR-1).
  const [messages, marketing, newsletter] = await Promise.all([getMessages(locale), marketingState(db, user), getSettings("newsletter")]);
  const p = messages.account.profilePage;
  const labels: ProfileLabels = {
    page: p,
    auth: messages.auth,
    phone: messages.auth.register.phone,
    name: messages.auth.register.name,
    optional: messages.common.optional.toLocaleLowerCase(locale === "tr" ? "tr-TR" : locale),
    newTab: messages.common.opensInNewTab,
    languages: locales.map((value) => ({ value, label: localeNames[value] })),
  };
  return (
    <>
      <AccountPageHeader title={p.title} intro={p.intro} />
      <div className="space-y-6">
        <PersonalForm locale={locale} user={{ name: user.name, email: user.email, phone: user.phone, locale: user.locale }} labels={labels} />
        <PasswordForm locale={locale} email={user.email} labels={labels} />
        <MarketingPreference locale={locale} initial={marketing} labels={labels} newsletterOn={newsletter.enabled} />
        <DeleteAccount locale={locale} email={user.email} labels={labels} kvkkHref={href(locale, "page", { slug: KVKK_PAGE_SLUG })} homeHref={href(locale, "home")} />
      </div>
    </>
  );
}
