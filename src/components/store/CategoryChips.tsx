import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import type { CategoryData } from "@/lib/data/catalog";
import { cn } from "@/lib/utils";

/** Category filter chips linking to the static category pages; the first chip is "all products". */
export default function CategoryChips({
  categories,
  locale,
  activeSlug,
  allLabel,
  label,
  className,
}: {
  categories: CategoryData[];
  locale: Locale;
  /** null = the all-products page. */
  activeSlug: string | null;
  allLabel: string;
  /** Accessible name for the nav landmark. */
  label: string;
  className?: string;
}) {
  const visible = categories.filter((c) => c.productCount > 0 || c.slug === activeSlug);
  if (visible.length === 0) return null;
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-5 text-xs font-medium whitespace-nowrap uppercase tracking-[0.14em] transition-colors duration-300",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      active ? "border-text bg-text text-bg" : "border-border text-text hover:border-text/40",
    );

  return (
    <nav aria-label={label} className={className}>
      <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <li className="shrink-0">
          <Link href={href(locale, "products")} className={chip(activeSlug === null)} aria-current={activeSlug === null ? "page" : undefined}>
            {allLabel}
          </Link>
        </li>
        {visible.map((c) => {
          const active = c.slug === activeSlug;
          return (
            <li key={c.id} className="shrink-0">
              <Link href={href(locale, "category", { slug: c.slug })} className={chip(active)} aria-current={active ? "page" : undefined}>
                {c.accentColor && <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: c.accentColor }} />}
                {localize(c.name, locale)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
