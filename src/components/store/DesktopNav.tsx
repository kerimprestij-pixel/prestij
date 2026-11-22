import { ChevronDown } from "lucide-react";
import type { NavItem } from "@/lib/data/site";
import { cn } from "@/lib/utils";
import { spacedCaps } from "./shell-styles";
import SmartLink from "./SmartLink";

const linkClass = cn(
  "relative inline-flex items-center gap-1 py-2 text-[0.8125rem] font-medium transition-colors duration-200 motion-reduce:transition-none",
  "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-center after:scale-x-0 after:bg-gold after:transition-transform after:duration-300 motion-reduce:after:transition-none",
  "hover:after:scale-x-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
  spacedCaps,
);

/** Desktop header navigation. Sub-items open on hover and on keyboard focus (focus-within). */
export default function DesktopNav({ items, label, newTabHint }: { items: NavItem[]; label: string; newTabHint: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="hidden lg:block">
      <ul className="flex items-center gap-7 xl:gap-10">
        {items.map((item, index) => (
          <li key={`${item.href}-${index}`} className="group relative">
            <SmartLink
              href={item.href}
              external={item.external}
              newTabHint={newTabHint}
              className={cn(linkClass, item.highlight ? "text-gold-text dark:text-gold" : "text-text/85 hover:text-text")}
            >
              {item.label}
              {item.children.length > 0 ? (
                <ChevronDown
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-3.5 transition-transform duration-200 group-focus-within:rotate-180 group-hover:rotate-180 motion-reduce:transition-none"
                />
              ) : null}
            </SmartLink>

            {item.children.length > 0 ? (
              <div className="invisible absolute start-0 top-full z-50 pt-3 opacity-0 transition-[opacity,translate,visibility] duration-200 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 translate-y-1 motion-reduce:transition-none">
                <ul className="min-w-60 rounded-md border border-border bg-surface p-2 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)]">
                  {item.children.map((child, childIndex) => (
                    <li key={`${child.href}-${childIndex}`}>
                      <SmartLink
                        href={child.href}
                        external={child.external}
                        newTabHint={newTabHint}
                        className={cn(
                          "block rounded-sm px-3.5 py-2.5 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          child.highlight ? "text-gold-text dark:text-gold" : "text-text",
                        )}
                      >
                        {child.label}
                      </SmartLink>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
