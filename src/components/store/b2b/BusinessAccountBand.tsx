"use client";
// The business account call to action at the end of /kurumsal (static page, client island). Signed-out
// visitors and customers without an application see "apply"; a pending, approved or rejected
// application changes the text and the link. Before the viewer has loaded it shows the "apply" look.
import { ArrowRight, BadgeCheck, Building2, Hourglass, RotateCcw } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/sections/button-styles";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Messages } from "@/i18n/messages";

export default function BusinessAccountBand({
  labels,
  applyHref,
  productsHref,
}: {
  labels: Messages["b2b"]["band"];
  applyHref: string;
  productsHref: string;
}) {
  const viewer = useViewer();
  const status = viewer.ready && viewer.signedIn ? viewer.companyStatus : null;
  const view =
    status === "approved"
      ? { icon: BadgeCheck, title: labels.approvedTitle, text: labels.approvedText, cta: labels.shop, href: productsHref }
      : status === "pending"
        ? { icon: Hourglass, title: labels.pendingTitle, text: labels.pendingText, cta: labels.viewStatus, href: applyHref }
        : status === "rejected"
          ? { icon: RotateCcw, title: labels.rejectedTitle, text: labels.rejectedText, cta: labels.viewStatus, href: applyHref }
          : { icon: Building2, title: labels.title, text: labels.text, cta: labels.apply, href: applyHref };
  const Icon = view.icon;

  return (
    <section aria-labelledby="business-account-band" className="border-t border-border bg-surface/60">
      <div className="container-x flex flex-col gap-8 py-14 md:flex-row md:items-center md:justify-between md:py-16">
        <div className="flex max-w-2xl items-start gap-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-gold/45 text-gold-text">
            <Icon aria-hidden className="size-5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">{labels.eyebrow}</p>
            <h2 id="business-account-band" className="mt-3 font-heading text-3xl leading-tight text-balance text-text md:text-4xl">
              {view.title}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-pretty text-text-muted">{view.text}</p>
          </div>
        </div>
        <Link href={view.href} className={buttonClass("primary", "shrink-0 self-start md:self-auto rtl:tracking-normal")}>
          {view.cta}
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
        </Link>
      </div>
    </section>
  );
}
