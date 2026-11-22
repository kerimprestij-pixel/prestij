"use client";

import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { NavItem } from "@/lib/data/site";
import { cn } from "@/lib/utils";
import { iconButton, spacedCaps } from "./shell-styles";
import SmartLink from "./SmartLink";

type MobileMenuProps = {
  items: NavItem[];
  /** Smaller links under the main navigation (account, contact…). */
  secondary?: { label: string; href: string }[];
  labels: { open: string; close: string; title: string; navigation: string; newTab: string };
  /** Rendered at the bottom of the sheet (language list, theme toggle). */
  footer?: ReactNode;
  className?: string;
};

const TRANSITION_MS = 320;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/** Slide-in navigation sheet for small screens: focus trap, Esc to close, body scroll lock, RTL aware. */
export default function MobileMenu({ items, secondary = [], labels, footer, className }: MobileMenuProps) {
  const [mounted, setMounted] = useState(false); // sheet is in the DOM
  const [shown, setShown] = useState(false); // sheet is slid in (drives the transition)
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const panelId = useId();
  const titleId = useId();

  const close = useCallback(() => {
    setShown(false);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setMounted(false);
      triggerRef.current?.focus();
    }, TRANSITION_MS);
  }, []);

  const open = () => {
    window.clearTimeout(closeTimer.current);
    setMounted(true);
  };

  // Slide in on the frame after mounting so the transition runs; move focus into the sheet.
  useEffect(() => {
    if (!mounted) return;
    const frame = window.requestAnimationFrame(() => {
      setShown(true);
      const panel = panelRef.current;
      if (panel) (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mounted]);

  // Scroll lock + keyboard handling while the sheet is open.
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "stable";

    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = focusableIn(panel);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
    };
  }, [mounted, close]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const sheet = (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        aria-hidden
        onClick={close}
        className={cn(
          "absolute inset-0 bg-brand-950/45 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // Close after following any link inside the sheet.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) close();
        }}
        className={cn(
          "absolute inset-y-0 start-0 flex w-[min(88vw,24rem)] flex-col bg-bg text-text shadow-2xl outline-none",
          "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          shown ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border ps-6 pe-3">
          <h2 id={titleId} className={cn("text-xs font-medium text-gold-text dark:text-gold", spacedCaps)}>
            {labels.title}
          </h2>
          <button type="button" data-autofocus onClick={close} aria-label={labels.close} className={iconButton}>
            <X aria-hidden className="size-5" strokeWidth={1.5} />
          </button>
        </div>

        <nav aria-label={labels.navigation} className="flex-1 overflow-y-auto overscroll-contain px-6 py-8">
          <ul className="space-y-1">
            {items.map((item, index) => (
              <li key={`${item.href}-${index}`}>
                <SmartLink
                  href={item.href}
                  external={item.external}
                  newTabHint={labels.newTab}
                  className={cn(
                    "block rounded-sm py-2.5 font-heading text-[1.75rem] leading-tight transition-colors hover:text-gold-text dark:hover:text-gold focus-visible:outline-2 focus-visible:outline-ring",
                    item.highlight ? "text-gold-text dark:text-gold" : "text-text",
                  )}
                >
                  {item.label}
                </SmartLink>
                {item.children.length > 0 ? (
                  <ul className="mb-3 mt-1 space-y-0.5 border-s border-border ps-4">
                    {item.children.map((child, childIndex) => (
                      <li key={`${child.href}-${childIndex}`}>
                        <SmartLink
                          href={child.href}
                          external={child.external}
                          newTabHint={labels.newTab}
                          className="block rounded-sm py-1.5 text-[0.95rem] text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {child.label}
                        </SmartLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          {secondary.length > 0 ? (
            <ul className="mt-10 space-y-3 border-t border-border pt-8">
              {secondary.map((link) => (
                <li key={link.href}>
                  <SmartLink
                    href={link.href}
                    className={cn(
                      "text-xs font-medium text-text-muted transition-colors hover:text-text",
                      spacedCaps,
                    )}
                  >
                    {link.label}
                  </SmartLink>
                </li>
              ))}
            </ul>
          ) : null}
        </nav>

        {footer ? <div className="space-y-5 border-t border-border px-6 py-6">{footer}</div> : null}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={labels.open}
        aria-expanded={shown}
        aria-controls={mounted ? panelId : undefined}
        aria-haspopup="dialog"
        className={cn(iconButton, className)}
      >
        <Menu aria-hidden className="size-5" strokeWidth={1.5} />
      </button>
      {mounted ? createPortal(sheet, document.body) : null}
    </>
  );
}
