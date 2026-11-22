// One cart line (drawer and /sepet page). Presentational: every amount and message comes
// pre-formatted in the CartLineView; the parent passes the action callbacks.
import { FlaskConical, Repeat, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { CartLineView } from "@/lib/cart/view";
import Img from "@/lib/media/Img";
import { cn } from "@/lib/utils";
import IssueNote from "./IssueNote";
import type { CartUiLabels } from "./labels";
import QuantityStepper from "./QuantityStepper";

type Props = {
  line: CartLineView;
  locale: Locale;
  labels: CartUiLabels;
  variant: "drawer" | "page";
  /** This line has an action in flight: its amounts are about to change. */
  busy?: boolean;
  highlight?: boolean;
  onQuantity: (line: CartLineView, quantity: number) => void;
  onRemove: (line: CartLineView) => void;
  /** Called when a link inside the line is followed (the drawer closes itself). */
  onNavigate?: () => void;
};

/** Small swatch in the product's own color. */
export function AccentDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full ring-1 ring-black/5 dark:ring-white/10", className)}
      style={{ backgroundColor: color ?? "var(--gold)" }}
    />
  );
}

export default function CartLineItem({ line, locale, labels, variant, busy = false, highlight = false, onQuantity, onRemove, onNavigate }: Props) {
  const hintId = useId();
  const page = variant === "page";
  const fullName = line.variantLabel ? `${line.name} — ${line.variantLabel}` : line.name;
  const atMax = line.included && !line.isSample && line.quantity >= line.maxQuantity && line.maxQuantity > line.minQuantity;
  // Samples carry a gold "free sample" label instead of a price; skip a subtitle that repeats it.
  const sampleNote = line.isSample ? line.priceNote : null;
  const subtitle = line.subtitle && line.subtitle.toLocaleLowerCase(locale) !== sampleNote?.toLocaleLowerCase(locale) ? line.subtitle : null;
  const detail = line.variantLabel || (line.isSample ? null : line.sku);
  const removable = line.issues.some((i) => i.blocking && (i.code === "out_of_stock" || i.code === "unavailable"));

  const thumb = (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-sm bg-surface-2",
        page ? "aspect-[4/5] w-24 sm:w-28" : "aspect-[4/5] w-[4.5rem]",
        !line.included && "opacity-60 grayscale",
      )}
      style={line.image?.dominantColor ? { backgroundColor: line.image.dominantColor } : undefined}
    >
      {line.image ? (
        <Img media={line.image} alt={line.imageAlt} locale={locale} sizes={page ? "112px" : "72px"} fill />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-text-muted">
          {line.isSample ? (
            <FlaskConical aria-hidden className="size-5" strokeWidth={1.25} />
          ) : (
            <ShoppingBag aria-hidden className="size-5" strokeWidth={1.25} />
          )}
        </span>
      )}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5" style={{ backgroundColor: line.accentColor ?? "var(--gold)" }} />
    </div>
  );

  return (
    <li
      data-line-id={line.lineId}
      data-variant-id={line.variantId}
      className={cn(
        "relative isolate flex gap-4",
        // Soft gold wash behind a just-added line; it fades out when the highlight ends.
        "before:absolute before:inset-y-1 before:-inset-x-2 before:-z-10 before:rounded-md before:bg-gold-50/80 before:opacity-0 before:transition-opacity before:duration-700 before:ease-out motion-reduce:before:transition-none dark:before:bg-gold-950/40",
        page ? "py-6 sm:gap-6" : "py-5",
        highlight && "before:opacity-100",
      )}
    >
      {line.href ? (
        <Link href={line.href} onClick={onNavigate} tabIndex={-1} aria-hidden className="shrink-0">
          {thumb}
        </Link>
      ) : (
        thumb
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn("font-heading leading-snug text-text", page ? "text-xl sm:text-2xl" : "text-lg")}>
              {line.href ? (
                <Link
                  href={line.href}
                  onClick={onNavigate}
                  className="rounded-xs transition-colors hover:text-gold-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:hover:text-gold"
                >
                  {line.name}
                </Link>
              ) : (
                line.name
              )}
            </h3>
            {subtitle ? <p className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.16em] text-text-muted">{subtitle}</p> : null}
            {sampleNote ? (
              <p className="mt-1.5 flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-gold-text">
                <AccentDot color={line.accentColor} />
                {sampleNote}
              </p>
            ) : null}
          </div>
          {!line.isSample ? (
            <div className={cn("shrink-0 text-end transition-opacity duration-300", busy && "opacity-40")}>
              <p className={cn("font-medium tabular-nums text-text", page ? "text-base" : "text-sm", !line.included && "text-text-muted line-through")}>
                {line.lineSubtotal.label}
              </p>
            </div>
          ) : null}
        </div>

        {detail ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-text-muted">
            <AccentDot color={line.accentColor} />
            <span className="truncate">{detail}</span>
          </p>
        ) : null}

        {!line.isSample ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-text-muted">
            <span>{format(labels.each, { price: line.unitPrice.label })}</span>
            {line.compareAt ? <s>{line.compareAt.label}</s> : null}
            {line.priceNote ? <span className="text-gold-text">{line.priceNote}</span> : null}
          </p>
        ) : null}

        {line.subscription ? (
          <p data-subscription-plan={line.subscription.planId} className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-gold-text dark:text-gold">
            <Repeat aria-hidden className="mt-0.5 size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0">{line.subscription.note}</span>
          </p>
        ) : null}

        <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", page ? "mt-4" : "mt-3")}>
          {line.isSample ? (
            <span className="text-xs text-text-muted">× {line.quantity}</span>
          ) : (
            <QuantityStepper
              value={line.quantity}
              min={line.minQuantity}
              max={line.maxQuantity}
              disabled={!line.included}
              describedBy={atMax ? hintId : undefined}
              onChange={(quantity) => onQuantity(line, quantity)}
              labels={{
                quantity: format(labels.quantityFor, { name: fullName }),
                decrease: format(labels.decreaseFor, { name: fullName }),
                increase: format(labels.increaseFor, { name: fullName }),
              }}
            />
          )}
          <button
            type="button"
            data-remove-line
            onClick={() => onRemove(line)}
            aria-label={format(labels.removeFor, { name: fullName })}
            className="rounded-xs text-xs text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {labels.remove}
          </button>
        </div>

        {atMax ? (
          <p id={hintId} className="mt-2 text-xs text-text-muted">
            {format(labels.maxReached, { count: line.maxQuantity }, locale)}
          </p>
        ) : null}

        {line.issues.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {line.issues.map((issue) => (
              <IssueNote key={`${issue.code}-${issue.message}`} blocking={issue.blocking}>
                <span>{issue.message}</span>
                {removable && issue.blocking ? (
                  <button
                    type="button"
                    onClick={() => onRemove(line)}
                    className="ms-1 font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {labels.remove}
                  </button>
                ) : null}
              </IssueNote>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
