// Totals table from the view's pre-labelled SummaryRow[], plus the checkout call-to-action.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { buttonClass } from "@/components/sections/button-styles";
import type { SummaryRow } from "@/lib/cart/view";
import { cn } from "@/lib/utils";

type SummaryProps = {
  rows: SummaryRow[];
  /** Totals are being recomputed (an action is in flight). */
  pending?: boolean;
  /** Smaller type for the drawer footer. */
  compact?: boolean;
  /** Row keys to leave out (the drawer skips the VAT note row and shows its own line). */
  omit?: SummaryRow["key"][];
  className?: string;
};

export function CartSummaryRows({ rows, pending = false, compact = false, omit = [], className }: SummaryProps) {
  const shown = rows.filter((r) => !omit.includes(r.key));
  const lines = shown.filter((r) => r.kind !== "note");
  const notes = shown.filter((r) => r.kind === "note");
  return (
    <div className={cn("transition-opacity duration-300", pending && "opacity-50", className)} aria-busy={pending || undefined}>
      <dl className={cn("flex flex-col", compact ? "gap-1.5 text-sm" : "gap-3 text-sm")}>
        {lines.map((row) => (
          <div
            key={row.key}
            className={cn(
              "flex items-baseline justify-between gap-4",
              row.kind === "total" && (compact ? "mt-1.5 border-t border-border pt-3" : "mt-2 border-t border-border pt-4"),
            )}
          >
            <dt className={cn(row.kind === "total" ? "font-medium text-text" : "text-text-muted")}>{row.label}</dt>
            <dd
              className={cn(
                "shrink-0 tabular-nums",
                row.kind === "total" ? cn("font-heading text-text", compact ? "text-2xl" : "text-3xl") : "text-text",
                row.kind === "free" && "font-medium text-gold-text",
              )}
            >
              {row.amountLabel}
            </dd>
          </div>
        ))}
      </dl>
      {notes.map((row) => (
        <p key={row.key} className="mt-1.5 text-end text-xs tabular-nums text-text-muted">
          {row.label}: {row.amountLabel}
        </p>
      ))}
    </div>
  );
}

type CtaProps = {
  href: string;
  label: string;
  allowed: boolean;
  /** Why checkout is blocked (shown under the disabled button). */
  blockedText: string;
  pending?: boolean;
  onNavigate?: () => void;
  className?: string;
};

export function CheckoutCta({ href, label, allowed, blockedText, pending = false, onNavigate, className }: CtaProps) {
  const reasonId = useId();
  const arrow = <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.5} />;
  if (!allowed) {
    return (
      <div className={className}>
        <button type="button" disabled aria-describedby={reasonId} className={buttonClass("primary", "w-full")}>
          {label}
          {arrow}
        </button>
        <p id={reasonId} className="mt-3 text-xs leading-relaxed text-rose-800 dark:text-rose-200">
          {blockedText}
        </p>
      </div>
    );
  }
  return (
    <Link
      href={href}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        // Let an in-flight change land first, so checkout never opens with stale totals.
        if (pending) event.preventDefault();
        else onNavigate?.();
      }}
      className={cn(buttonClass("primary", "group/cta w-full"), pending && "cursor-progress opacity-80", className)}
    >
      {label}
      <span className="transition-transform duration-300 group-hover/cta:translate-x-0.5 motion-reduce:transition-none rtl:group-hover/cta:-translate-x-0.5">
        {arrow}
      </span>
    </Link>
  );
}
