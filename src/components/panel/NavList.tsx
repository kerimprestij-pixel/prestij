import Link from "next/link";
import type { StaffRole } from "@/lib/session";
import { cn } from "@/lib/utils";
import { navForRole, PANEL_NAV } from "./nav-config";
import NavPendingHint from "./NavPendingHint";

type NavListProps = {
  /** href of the current section, or null while the path is unknown (prerendered shell). */
  activeHref: string | null;
  /** Hides items above this role (nav-config minRole). null/undefined = role not known yet: every item. */
  role?: StaffRole | null;
  onNavigate?: () => void;
  /** Small server-rendered counters by item href (e.g. orders waiting for staff). */
  badges?: NavBadges;
};

export type NavBadges = Partial<Record<string, React.ReactNode>>;

/** Grouped sidebar links. Hook-free so it can also serve as the Suspense fallback. */
export default function NavList({ activeHref, role, onNavigate, badges }: NavListProps) {
  const groups = role ? navForRole(role) : PANEL_NAV;
  return (
    <nav aria-label="Panel bölümleri" className="space-y-6">
      {groups.map((group, index) => (
        <div key={group.title ?? index}>
          {group.title ? (
            <p className="px-3 pb-2 text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-text-muted">
              {group.title}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === activeHref;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring motion-reduce:transition-none",
                      active ? "bg-surface-2 font-medium text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    {active ? <span aria-hidden className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-gold" /> : null}
                    <Icon
                      aria-hidden
                      strokeWidth={1.75}
                      className={cn("size-4 shrink-0", active ? "text-gold-text" : "text-text-muted group-hover:text-text")}
                    />
                    <span className="truncate">{item.label}</span>
                    {badges?.[item.href] ?? null}
                    <NavPendingHint />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
