// Period links of the Hediye Çarkı overview (?donem=7|30|90), in the panel's segmented style.
// Server-safe (no hooks). FilterTabs writes only ?durum=, hence this small sibling.
import Link from "next/link";
import { WHEEL_PERIODS, wheelOverviewHref, type WheelPeriod } from "@/lib/panel/gift-wheel/filters";
import { cn } from "@/lib/utils";

export default function PeriodTabs({ active }: { active: WheelPeriod | undefined }) {
  return (
    <nav aria-label="Dönem" className="min-w-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {WHEEL_PERIODS.map((days) => {
          const current = days === active;
          return (
            <li key={days}>
              <Link
                href={wheelOverviewHref(days)}
                aria-current={current ? "page" : undefined}
                scroll={false}
                className={cn(
                  "flex items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                Son {days} gün
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
