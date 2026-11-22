// Sub-navigation of /panel/e-bulten: subscribers | campaigns. Server-safe (no hooks).
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/panel/e-bulten", label: "Aboneler", icon: Mail, key: "subscribers" },
  { href: "/panel/e-bulten/kampanyalar", label: "Kampanyalar", icon: Send, key: "campaigns" },
] as const;

export default function NewsletterTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="E-bülten bölümleri" className="border-b border-border">
      <ul className="-mb-px flex gap-1">
        {TABS.map((tab) => {
          const current = tab.key === active;
          const Icon = tab.icon;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
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
