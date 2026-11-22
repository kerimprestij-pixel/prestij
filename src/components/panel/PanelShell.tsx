"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Menu, Search, X } from "lucide-react";
import ThemeToggle from "@/components/store/ThemeToggle";
import type { StaffRole } from "@/lib/session";
import { cn } from "@/lib/utils";
import { openCommandPalette } from "./ui/command-palette-store";
import { useCommandShortcutLabel } from "./ui/CommandPalette";
import Toaster from "./ui/Toaster";
import type { NavBadges } from "./NavList";
import SidebarNav from "./SidebarNav";
import Wordmark from "./Wordmark";

const DESKTOP_QUERY = "(min-width: 1024px)";

type PanelShellProps = {
  /** Server-rendered user menu (already wrapped in Suspense by the layout). */
  userMenu: React.ReactNode;
  /** Server-rendered sidebar counters by nav href (each wrapped in Suspense by the layout). */
  navBadges?: NavBadges;
  /** The Ctrl/⌘+K command palette (needs the role, so the layout renders it inside Suspense). */
  commandPalette?: React.ReactNode;
  /** The viewer's staff role (an unawaited promise from the layout): the sidebar hides items above it. */
  navRole?: Promise<StaffRole | null>;
  children: React.ReactNode;
};

/** Panel chrome: sidebar (drawer below lg), top bar, search (command palette), toasts and the main content area. */
export default function PanelShell({ userMenu, navBadges, commandPalette, navRole, children }: PanelShellProps) {
  const shortcut = useCommandShortcutLabel();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    // The drawer turns visible at once on open (only the slide is animated), so the close button can
    // usually take focus now. A browser that has not restyled the drawer yet ignores focus() on a
    // still-hidden element, so retry briefly until focus is inside the drawer.
    const aside = asideRef.current;
    const focusClose = () => {
      if (aside?.contains(document.activeElement)) return;
      closeButtonRef.current?.focus();
    };
    focusClose();
    const retries = [50, 150, 300, 600, 1000, 1500].map((ms) => setTimeout(focusClose, ms));
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false); // focus returns to the menu button in the cleanup below
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onViewport = () => desktop.matches && setOpen(false);

    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onViewport);
    return () => {
      retries.forEach(clearTimeout);
      root.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onViewport);
      // Closed with focus inside the drawer (or lost to <body>): back to the button that opened it. The
      // page is no longer inert here (cleanups run after the commit).
      const active = document.activeElement;
      if (!desktop.matches && (!active || active === document.body || aside?.contains(active))) menuButtonRef.current?.focus();
    };
  }, [open]);

  return (
    <div className="min-h-dvh bg-bg text-text lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <a
        href="#panel-main"
        className="sr-only z-[60] rounded-md bg-surface px-3 py-2 text-sm font-medium text-text shadow focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        İçeriğe geç
      </a>

      <div
        aria-hidden
        onClick={close}
        className={cn(
          "fixed inset-0 z-40 bg-[#03265F]/35 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        ref={asideRef}
        id="panel-sidebar"
        aria-label="Panel menüsü"
        aria-modal={open || undefined}
        role={open ? "dialog" : undefined}
        className={cn(
          "fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col border-e border-border bg-surface",
          "duration-300 ease-out motion-reduce:transition-none",
          "lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:max-w-none lg:translate-x-0",
          // Opening: visible immediately (focus can move in); closing: stays visible until the slide ends.
          open ? "visible translate-x-0 transition-transform" : "invisible -translate-x-full transition-[transform,visibility] rtl:translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
          <Link
            href="/panel"
            onClick={close}
            className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <Wordmark caption="Yönetim Paneli" />
            <span className="sr-only">Genel Bakış</span>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            className="grid size-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
          >
            <X aria-hidden className="size-5" />
            <span className="sr-only">Menüyü kapat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-5">
          <SidebarNav onNavigate={close} badges={navBadges} role={navRole} />
        </div>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <a
            href="/tr"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 rounded text-xs text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Mağazayı yeni sekmede aç
          </a>
        </div>
      </aside>

      {/* While the drawer is open (below lg) the page behind it is inert: Tab stays in the drawer. */}
      <div className="flex min-w-0 flex-col" inert={open || undefined}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/70 sm:px-6 lg:px-10">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-controls="panel-sidebar"
            aria-expanded={open}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
            <span className="sr-only">Menüyü aç</span>
          </button>

          <div role="search" className="min-w-0 max-w-md flex-1">
            <button
              type="button"
              onClick={openCommandPalette}
              aria-haspopup="dialog"
              aria-label="Panelde ara"
              aria-keyshortcuts="Control+K Meta+K"
              className="relative flex h-9 w-full items-center rounded-lg border border-border bg-surface ps-9 pe-16 text-start text-sm text-text-muted transition-[border-color,box-shadow] hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
            >
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
              <span className="truncate">
                <span className="sm:hidden">Ara…</span>
                <span className="hidden sm:inline">Sipariş, ürün veya sayfa ara…</span>
              </span>
              <kbd
                aria-hidden
                className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[0.625rem] font-medium tracking-wider text-text-muted sm:inline"
              >
                {shortcut}
              </kbd>
            </button>
          </div>

          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <a
              href="/tr"
              target="_blank"
              rel="noopener"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring md:inline-flex"
            >
              Siteyi görüntüle
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
            <ThemeToggle labels={{ light: "Açık tema", dark: "Koyu tema", system: "Sistem teması" }} />
            {userMenu}
          </div>
        </header>

        <main id="panel-main" tabIndex={-1} className="flex-1 px-4 py-8 outline-none sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
      {commandPalette}
      <Toaster />
    </div>
  );
}
