// Status filter links (?durum=…) in the panel's segmented style. Server-safe (no hooks).
import Link from "next/link";
import { formatNumber } from "@/components/panel/labels";
import { cn } from "@/lib/utils";

export type FilterTab = { param: string | null; label: string };

export default function FilterTabs({
  base,
  tabs,
  active,
  counts,
  label,
  extraQuery,
}: {
  base: string;
  tabs: readonly FilterTab[];
  /** undefined while the search params are unknown (prerendered fallback): nothing is marked. */
  active: string | null | undefined;
  /** Count per tab param ("" for the null tab). */
  counts?: Record<string, number>;
  label: string;
  /** Other params to keep (e.g. the search text). */
  extraQuery?: Record<string, string | null | undefined>;
}) {
  const hrefFor = (param: string | null) => {
    const qs = new URLSearchParams();
    if (param) qs.set("durum", param);
    for (const [k, v] of Object.entries(extraQuery ?? {})) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <nav aria-label={label} className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((tab) => {
          const current = active !== undefined && tab.param === active;
          const n = counts?.[tab.param ?? ""];
          return (
            <li key={tab.param ?? "all"}>
              <Link
                href={hrefFor(tab.param)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {tab.label}
                {n != null ? (
                  <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums", current ? "bg-brand-contrast/15" : "bg-surface-2")}>
                    {formatNumber(n)}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
