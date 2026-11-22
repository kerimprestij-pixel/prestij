"use client";
// Checkout order summary: line thumbnails and the totals table for the chosen payment method.
// Desktop: always open and sticky. Mobile: a bar with the total that expands the details.
// Renders only pre-formatted values from the CartView (no price math here).

import Link from "next/link";
import { ChevronDown, ShoppingBag } from "lucide-react";
import { useId, useState } from "react";
import { format } from "@/i18n/format";
import type { Locale } from "@/i18n/config";
import type { CartLineView, CartView, SummaryRow } from "@/lib/cart/view";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import type { CheckoutLabels, CommonLabels } from "./types";

type OrderSummaryProps = {
  locale: Locale;
  view: CartView;
  rows: SummaryRow[];
  grandTotalLabel: string;
  labels: CheckoutLabels;
  common: CommonLabels;
  cartHref: string;
};

export default function OrderSummary({ locale, view, rows, grandTotalLabel, labels, common, cartHref }: OrderSummaryProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  const s = labels.summary;

  return (
    <section aria-labelledby={headingId} className="lg:sticky lg:top-28">
      {/* Mobile bar: the total stays visible; the details expand below it. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3 text-start transition-colors hover:border-border-strong/60 lg:hidden"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-text">
          <ShoppingBag aria-hidden className="size-4.5 text-gold-text" strokeWidth={1.5} />
          {open ? s.hide : s.show}
          <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-300", open && "rotate-180")} strokeWidth={1.75} />
        </span>
        <span className="font-heading text-xl text-text">{grandTotalLabel}</span>
      </button>

      <div
        id={panelId}
        className={cn(
          "mt-3 rounded-md border border-border bg-surface p-5 sm:p-6 lg:mt-0 lg:block lg:p-8",
          open ? "block" : "hidden",
        )}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 id={headingId} className="font-heading text-2xl text-text">
            {labels.orderSummary}
          </h2>
          <Link
            href={cartHref}
            className="shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text hover:decoration-gold"
          >
            {s.editCart}
          </Link>
        </div>
        <p className="mt-1 text-sm text-text-muted">{view.itemCountLabel}</p>

        <ul className="mt-6 divide-y divide-border border-y border-border">
          {view.lines.map((line) => (
            <SummaryLine key={line.lineId} line={line} locale={locale} labels={labels} common={common} />
          ))}
        </ul>

        {view.coupon?.status === "invalid" && (
          <p className="mt-4 rounded-sm bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-muted">
            <span dir="ltr" className="font-medium text-text">
              {view.coupon.code}
            </span>
            {" — "}
            {view.coupon.message}
          </p>
        )}

        <SummaryRows rows={rows} className="mt-6" />

        {!view.shipping.free && view.shipping.message && (
          <p className="mt-4 text-xs leading-relaxed text-text-muted">{view.shipping.message}</p>
        )}
      </div>
    </section>
  );
}

function SummaryLine({ line, locale, labels, common }: { line: CartLineView; locale: Locale; labels: CheckoutLabels; common: CommonLabels }) {
  const accent = line.accentColor;
  return (
    <li className={cn("flex gap-4 py-4", !line.included && "opacity-70")}>
      <div
        className="relative size-16 shrink-0 rounded-sm bg-surface-2"
        style={accent ? { backgroundColor: `color-mix(in oklab, ${accent} 16%, var(--surface-2))` } : undefined}
      >
        <div className="absolute inset-0 overflow-hidden rounded-sm">
          {line.image && <Img media={line.image} alt={line.imageAlt} locale={locale} sizes="64px" fill className="object-contain p-1" placeholder={false} />}
        </div>
        <span
          className="absolute -end-2 -top-2 grid min-w-6 place-items-center rounded-full bg-brand px-1.5 text-[0.6875rem] leading-6 font-semibold text-brand-contrast tabular-nums"
          aria-hidden
        >
          {line.quantity}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-medium text-text">{line.name}</p>
        {/* Product type + size: the goods' essential features (e.g. "Duş Jeli · 20 L Bidon"). */}
        {(line.variantLabel || (line.subtitle && !line.isSample)) && (
          <p className="mt-0.5 text-xs text-text-muted">{[line.isSample ? null : line.subtitle, line.variantLabel].filter(Boolean).join(" · ")}</p>
        )}
        <p className="sr-only">{format(labels.summary.quantity, { count: line.quantity }, locale)}</p>
        {line.priceNote && <p className="mt-1 text-xs text-gold-text">{line.priceNote}</p>}
        {line.issues.map((issue, i) => (
          <p key={i} className={cn("mt-1 text-xs leading-snug", issue.blocking ? "text-red-700 dark:text-red-400" : "text-text-muted")}>
            {issue.message}
          </p>
        ))}
      </div>
      <p className="shrink-0 text-sm font-medium text-text tabular-nums">{line.isSample ? common.free : line.lineSubtotal.label}</p>
    </li>
  );
}

export function SummaryRows({ rows, className }: { rows: SummaryRow[]; className?: string }) {
  return (
    <dl className={cn("space-y-2.5 text-sm", className)}>
      {rows.map((row) =>
        row.kind === "total" ? (
          <div key={row.key} className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
            <dt className="text-base font-medium text-text">{row.label}</dt>
            <dd className="font-heading text-3xl text-text">{row.amountLabel}</dd>
          </div>
        ) : row.kind === "note" ? (
          <div key={row.key} className="flex justify-between gap-4 text-xs text-text-muted">
            <dt>{row.label}</dt>
            <dd className="tabular-nums">{row.amountLabel}</dd>
          </div>
        ) : (
          <div key={row.key} className="flex justify-between gap-4">
            <dt className="text-text-muted">{row.label}</dt>
            <dd className={cn("tabular-nums", row.kind === "discount" || row.kind === "free" ? "font-medium text-gold-text" : "text-text")}>
              {row.amountLabel}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
