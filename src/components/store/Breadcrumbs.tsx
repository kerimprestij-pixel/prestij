import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { jsonLd } from "./format";

export type Crumb = { label: string; href?: string };

/** Breadcrumb trail with BreadcrumbList JSON-LD. The last item is the current page. */
export default function Breadcrumbs({
  items,
  label,
  siteUrl,
  className,
}: {
  items: Crumb[];
  /** Accessible name of the nav landmark (messages.nav.breadcrumb). */
  label: string;
  /** Absolute origin for JSON-LD URLs, e.g. https://prestij.com.tr */
  siteUrl?: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  const structured = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: siteUrl ? new URL(item.href, siteUrl).toString() : item.href } : {}),
    })),
  };

  return (
    <nav aria-label={label} className={cn("text-xs text-text-muted", className)}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} className="uppercase tracking-[0.14em] transition-colors hover:text-text">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="uppercase tracking-[0.14em] text-text">
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight aria-hidden className="size-3 opacity-60 rtl:-scale-x-100" />}
            </li>
          );
        })}
      </ol>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
    </nav>
  );
}
