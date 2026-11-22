"use client";
// "Hesap oluştur" on the guest order page (client island: only for visitors who are not signed in).
// The order's e-mail goes to the register form through sessionStorage, never through the URL; once
// the customer verifies that address, this order is linked to the new account.

import { ArrowRight, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/sections/button-styles";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import { cn } from "@/lib/utils";
import { REGISTER_EMAIL_KEY } from "./storage-keys";

type Props = {
  email: string;
  registerHref: string;
  labels: { title: string; text: string; button: string };
  className?: string;
};

export default function CreateAccountCta({ email, registerHref, labels, className }: Props) {
  const viewer = useViewer();
  if (!viewer.ready || viewer.signedIn) return null;
  const remember = () => {
    try {
      window.sessionStorage.setItem(REGISTER_EMAIL_KEY, email);
    } catch {
      // storage unavailable: the form simply starts empty
    }
  };
  return (
    <section className={cn("rounded-md border border-gold/40 bg-gold/5 p-5 sm:p-6 print:hidden", className)}>
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-gold-text">
          <UserRoundPlus className="size-4.5" strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-2xl leading-tight text-text">{labels.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{labels.text}</p>
          <Link href={registerHref} onClick={remember} className={buttonClass("secondary", "mt-4 min-h-11 bg-surface px-5 rtl:tracking-normal")}>
            {labels.button}
            <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
          </Link>
        </div>
      </div>
    </section>
  );
}
