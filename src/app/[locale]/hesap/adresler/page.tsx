// /hesap/adresler (en/ar: /account/addresses): the customer's address book (delivery + invoice data,
// defaults). Every change goes through a Server Action that re-checks the session and ownership.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AccountShell, { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import AddressBook from "@/components/store/account/AddressBook";
import { privateMetadata, type PageLocaleProps } from "@/components/store/account/page-helpers";
import { db } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { MAX_ADDRESSES, listAddresses } from "@/lib/account/addresses";
import { requireAccountUser } from "@/lib/account/session";

export async function generateMetadata({ params }: Pick<PageLocaleProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).account.addressBook.title);
}

export default async function AddressesPage({ params }: Pick<PageLocaleProps, "params">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AccountShell locale={locale} active="addresses">
      <Suspense fallback={<AccountContentSkeleton />}>
        <Addresses locale={locale} />
      </Suspense>
    </AccountShell>
  );
}

async function Addresses({ locale }: { locale: Locale }) {
  const user = await requireAccountUser(locale, href(locale, "accountAddresses"));
  const [messages, addresses] = await Promise.all([getMessages(locale), listAddresses(db, user.id)]);
  const b = messages.account.addressBook;
  return (
    <>
      <AccountPageHeader title={b.title} intro={b.intro} />
      <AddressBook
        locale={locale}
        addresses={addresses}
        labels={{
          book: b,
          form: messages.checkout.form,
          phone: messages.checkout.phone,
          individual: messages.checkout.individual,
          corporate: messages.checkout.corporate,
          optional: messages.common.optional.toLocaleLowerCase(locale === "tr" ? "tr-TR" : locale),
          close: messages.common.close,
          maxAddresses: MAX_ADDRESSES,
        }}
      />
    </>
  );
}
