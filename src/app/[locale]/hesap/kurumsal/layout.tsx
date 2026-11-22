// The account frame (navigation beside the content) around /hesap/kurumsal, like every other /hesap
// page (src/components/store/account/AccountShell.tsx, ACCOUNTS). Static: no session read here.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import AccountShell from "@/components/store/account/AccountShell";
import { isLocale } from "@/i18n/config";

export default async function BusinessAccountLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AccountShell locale={locale} active="business">
      {children}
    </AccountShell>
  );
}
