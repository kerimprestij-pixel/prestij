"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { LOCALE_COOKIE, href, switchLocalePath } from "@/i18n/paths";
import { cn } from "@/lib/utils";

export type LanguageOption = { code: Locale; name: string };

type LanguageSwitcherProps = {
  current: Locale;
  languages: LanguageOption[];
  /** Accessible name, e.g. "Dil seçin". */
  label: string;
  /** "menu": compact header dropdown. "list": inline row (mobile menu). */
  variant?: "menu" | "list";
  className?: string;
};

/** The current page in another language, read from the real browser URL (correct behind proxy rewrites). */
function currentPathIn(target: Locale): string {
  const { pathname, search, hash } = window.location;
  return switchLocalePath(`${pathname}${search}${hash}`, target);
}

function rememberLocale(code: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
}

/** Switches language while staying on the same page (segments are translated, e.g. urunler ↔ products). */
export default function LanguageSwitcher({ current, languages, label, variant = "menu", className }: LanguageSwitcherProps) {
  const computeTargets = (): Partial<Record<Locale, string>> =>
    Object.fromEntries(languages.map(({ code }) => [code, currentPathIn(code)]));

  // The "list" variant lives in the client-only mobile sheet, so it can read the URL on mount. Elsewhere
  // (and on the server) links start at each locale's home page and are refreshed when the menu opens.
  const [targets, setTargets] = useState<Partial<Record<Locale, string>>>(() =>
    variant === "list" && typeof window !== "undefined" ? computeTargets() : {},
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentName = languages.find((l) => l.code === current)?.name ?? current;
  const linkFor = (code: Locale) => targets[code] ?? href(code, "home");

  if (variant === "list") {
    return (
      <nav aria-label={label} className={className}>
        <ul className="flex flex-wrap gap-2">
          {languages.map(({ code, name }) => {
            const active = code === current;
            return (
              <li key={code}>
                <Link
                  href={linkFor(code)}
                  hrefLang={code}
                  lang={code}
                  aria-current={active ? "true" : undefined}
                  onClick={() => rememberLocale(code)}
                  className={cn(
                    "inline-flex min-h-10 items-center rounded-full border px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "border-brand bg-brand text-brand-contrast"
                      : "border-border text-text hover:border-gold",
                  )}
                >
                  {name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${currentName}`}
        onClick={() => {
          if (!open) setTargets(computeTargets());
          setOpen((value) => !value);
        }}
        className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium uppercase tracking-[0.14em] text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <Globe aria-hidden className="size-4" strokeWidth={1.5} />
        <span dir="ltr">{current}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
          strokeWidth={1.5}
        />
      </button>

      {open ? (
        <div
          id={listId}
          className="absolute end-0 top-full z-50 mt-2 min-w-48 overflow-hidden rounded-md border border-border bg-surface p-1.5 shadow-[0_18px_50px_-20px_rgb(0_0_0/0.35)]"
        >
          <ul>
            {languages.map(({ code, name }) => {
              const active = code === current;
              return (
                <li key={code}>
                  <Link
                    href={linkFor(code)}
                    hrefLang={code}
                    lang={code}
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      rememberLocale(code);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between gap-6 rounded-sm px-3 py-2.5 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      active ? "font-medium text-brand dark:text-text" : "text-text",
                    )}
                  >
                    <span>{name}</span>
                    {active ? <Check aria-hidden className="size-4 text-gold" strokeWidth={1.75} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
