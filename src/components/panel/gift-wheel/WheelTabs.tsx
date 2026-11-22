// Sub-navigation of /panel/hediye-carki: overview | settings | winners. Server-safe (no hooks).
import Link from "next/link";
import { ChartColumn, Settings2, Trophy } from "lucide-react";
import { WHEEL_PANEL_BASE, WHEEL_SETTINGS_PATH, WHEEL_WINNERS_PATH } from "@/lib/panel/gift-wheel/filters";
import { cn } from "@/lib/utils";

const TABS = [
  { href: WHEEL_PANEL_BASE, label: "Genel bakış", icon: ChartColumn, key: "overview" },
  { href: WHEEL_SETTINGS_PATH, label: "Ayarlar", icon: Settings2, key: "settings" },
  { href: WHEEL_WINNERS_PATH, label: "Kazananlar", icon: Trophy, key: "winners" },
] as const;

export type WheelTabKey = (typeof TABS)[number]["key"];

export default function WheelTabs({ active }: { active: WheelTabKey }) {
  return (
    <nav aria-label="Hediye çarkı bölümleri" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-x-1">
        {TABS.map((tab) => {
          const current = tab.key === active;
          const Icon = tab.icon;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  current ? "border-gold font-medium text-text" : "border-transparent text-text-muted hover:text-text",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
