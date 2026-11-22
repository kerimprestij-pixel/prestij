"use client";
import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { SETTINGS_BASE, SETTINGS_PAGES, settingsHref } from "./settings-pages";

const ITEMS = [
  { href: SETTINGS_BASE, label: "Genel bakış", icon: LayoutGrid },
  ...SETTINGS_PAGES.map((p) => ({ href: settingsHref(p.slug), label: p.label, icon: p.icon })),
];

function List({ active }: { active: string | null }) {
  const listRef = useRef<HTMLUListElement>(null);

  // On small screens the list scrolls sideways: keep the current page in view.
  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && listRef.current && listRef.current.scrollWidth > listRef.current.clientWidth) {
      current.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [active]);

  return (
    <nav aria-label="Ayar bölümleri" className="relative -mx-4 min-w-0 sm:mx-0 lg:sticky lg:top-24">
      <ul
        ref={listRef}
        className="flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:px-0 lg:flex-col lg:overflow-visible lg:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {ITEMS.map((item) => {
          const current = item.href === active;
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring motion-reduce:transition-none lg:border-transparent",
                  current
                    ? "border-border bg-surface font-medium text-text shadow-[0_1px_2px_rgb(3_38_95/0.05)] lg:border-border"
                    : "border-transparent text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {current ? <span aria-hidden className="absolute inset-y-2 start-0 hidden w-0.5 rounded-full bg-gold lg:block" /> : null}
                <Icon aria-hidden strokeWidth={1.75} className={cn("size-4 shrink-0", current ? "text-gold-text" : "text-text-muted")} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActiveList() {
  const pathname = usePathname();
  // Sub-pages (e.g. /panel/ayarlar/e-posta/<template>) keep their section marked.
  const active =
    ITEMS.find((i) => i.href === pathname)?.href ??
    ITEMS.find((i) => i.href !== SETTINGS_BASE && pathname.startsWith(`${i.href}/`))?.href ??
    (pathname.startsWith(`${SETTINGS_BASE}/`) ? null : SETTINGS_BASE);
  return <List active={active} />;
}

/** Settings sub-navigation: a sticky column on wide screens, a sideways-scrolling row on phones. */
export default function SettingsNav() {
  return (
    <Suspense fallback={<List active={null} />}>
      <ActiveList />
    </Suspense>
  );
}
