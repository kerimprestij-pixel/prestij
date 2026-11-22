// "Abonelikler | Planlar" switch at the top of /panel/abonelikler (server-safe, links only).
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SUBSCRIPTIONS_BASE } from "./labels";

export default function SectionTabs({ active }: { active: "list" | "plans" }) {
  const tabs = [
    { key: "list", label: "Abonelikler", href: SUBSCRIPTIONS_BASE },
    { key: "plans", label: "Planlar", href: `${SUBSCRIPTIONS_BASE}/planlar` },
  ] as const;
  return (
    <nav aria-label="Abonelik bölümleri" className="border-b border-border">
      <ul className="-mb-px flex gap-6">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={active === t.key ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-0.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active === t.key ? "border-gold text-text" : "border-transparent text-text-muted hover:text-text",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
