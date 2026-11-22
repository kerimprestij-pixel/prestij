// Ordered items (from the order snapshots, so later catalog edits never change them) and the totals
// breakdown that was charged.
import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { localize } from "@/i18n/localize";
import type { Messages } from "@/i18n/messages";
import { href } from "@/i18n/paths";
import type { SummaryRow } from "@/lib/cart/view";
import Img from "@/lib/media/Img";
import type { OrderItemView, OrderView } from "@/lib/orders/read";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";
import { cardClass, cardTitleClass } from "./ui";

type OrderItemsProps = { order: OrderView; rows: SummaryRow[]; locale: Locale; messages: Messages };

/** Product page for a line; samples point to their parent product ("lavanta-numune" → "lavanta"). */
function productHref(item: OrderItemView, locale: Locale): string | null {
  const slug = item.productSlug;
  if (!slug) return null;
  if (!item.isSample) return href(locale, "product", { slug });
  const parent = slug.replace(/-numune$/, "");
  return parent === slug ? null : href(locale, "product", { slug: parent });
}

export default function OrderItems({ order, rows, locale, messages }: OrderItemsProps) {
  const m = messages.order.items;
  return (
    <section aria-labelledby="order-items-title" className={cardClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="order-items-title" className={cardTitleClass}>
          {m.title}
        </h2>
        <p className="text-sm text-text-muted">{format(m.count, { count: order.totals.itemCount }, locale)}</p>
      </div>

      <ul className="mt-6 divide-y divide-border border-y border-border">
        {order.items.map((item) => (
          <ItemRow key={item.id} item={item} locale={locale} messages={messages} />
        ))}
      </ul>

      <h3 className="sr-only">{messages.order.summaryTitle}</h3>
      <dl className="mt-6 space-y-3 text-sm">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "flex items-baseline justify-between gap-4",
              row.kind === "total" && "mt-4 border-t border-border pt-4",
              row.kind === "note" && "text-xs",
            )}
          >
            <dt className={cn(row.kind === "total" ? "font-medium text-text" : "text-text-muted")}>{row.label}</dt>
            <dd
              className={cn(
                "shrink-0 tabular-nums",
                row.kind === "total" && "font-heading text-3xl leading-none text-text",
                row.kind === "discount" && "text-emerald-700 dark:text-emerald-400",
                row.kind === "free" && "font-medium text-gold-text",
                row.kind === "default" && "text-text",
                row.kind === "note" && "text-text-muted",
              )}
            >
              {row.amountLabel}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ItemRow({ item, locale, messages }: { item: OrderItemView; locale: Locale; messages: Messages }) {
  const m = messages.order.items;
  const name = localize(item.name, locale);
  const variant = localize(item.variantTitle, locale);
  const link = productHref(item, locale);
  const accent = item.accentColor;
  const alt = item.image ? localize(item.image.alt, locale) || name : name;

  return (
    <li className="flex gap-4 py-5 print:break-inside-avoid">
      <div
        className="relative size-20 shrink-0 rounded-sm bg-surface-2 sm:size-24"
        style={accent ? { backgroundColor: `color-mix(in oklab, ${accent} 16%, var(--surface-2))` } : undefined}
      >
        <div className="absolute inset-0 overflow-hidden rounded-sm">
          {item.image && <Img media={item.image} alt={alt} locale={locale} sizes="96px" fill className="object-contain p-1.5" placeholder={false} />}
        </div>
        <span
          aria-hidden
          className="absolute -end-2 -top-2 grid min-w-6 place-items-center rounded-full bg-brand px-1.5 text-[0.6875rem] leading-6 font-semibold text-brand-contrast tabular-nums print:border print:border-text"
        >
          {item.quantity}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="font-medium leading-snug text-text">
            {link ? (
              <Link href={link} className="underline-offset-4 hover:underline hover:decoration-gold">
                <bdi>{name}</bdi>
              </Link>
            ) : (
              <bdi>{name}</bdi>
            )}
          </p>
          {variant && (
            <p className="mt-0.5 text-sm text-text-muted">
              <bdi>{variant}</bdi>
            </p>
          )}
          {item.isSample && <p className="mt-1 text-xs font-medium text-gold-text">{m.sample}</p>}
          <p className="mt-1 text-sm text-text-muted">
            {item.isSample ? (
              <span>
                {m.quantity}: <span className="tabular-nums">{item.quantity}</span>
              </span>
            ) : (
              <>
                <span className="sr-only">{m.quantity}: </span>
                <span className="tabular-nums">
                  {item.quantity} × {formatPrice(item.unitPrice, locale)}
                </span>
              </>
            )}
            {item.compareAt != null && item.compareAt > item.unitPrice && (
              <s className="ms-2 text-xs tabular-nums text-text-muted/80">{formatPrice(item.compareAt, locale)}</s>
            )}
          </p>
          {item.discount > 0 && (
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              {m.discount}: <span className="tabular-nums">{formatPrice(-item.discount, locale)}</span>
            </p>
          )}
        </div>
        <p className="shrink-0 font-medium text-text tabular-nums sm:text-end">
          <span className="sr-only">{m.lineTotal}: </span>
          {item.isSample && item.lineSubtotal === 0 ? messages.common.free : formatPrice(item.lineSubtotal, locale)}
        </p>
      </div>
    </li>
  );
}
