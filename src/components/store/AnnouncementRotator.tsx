"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AnnouncementVariant } from "@/lib/data/site";
import { cn } from "@/lib/utils";
import { ANNOUNCEMENT_DISMISS_KEY, ANNOUNCEMENT_HIDDEN_ATTR } from "./announcement-dismiss";
import SmartLink from "./SmartLink";

export type RotatorItem = {
  id: number;
  text: string;
  href: string | null;
  external: boolean;
  variant: AnnouncementVariant;
};

export type AnnouncementLabels = { region: string; dismiss: string; previous: string; next: string };

const ROTATE_MS = 6000;
const FADE_MS = 220;

const VARIANT_CLASS: Record<AnnouncementVariant, string> = {
  brand: "surface-inverse bg-brand text-brand-contrast",
  accent: "bg-gold text-gold-contrast",
  neutral: "border-b border-border bg-surface-2 text-text",
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** The announcement text (also on the invisible copies that reserve the height). */
const textClass = "col-start-1 row-start-1 min-w-0 text-center font-medium leading-snug tracking-[0.04em] rtl:tracking-normal";

const controlClass =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-80 transition hover:bg-current/10 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-current motion-reduce:transition-none";

/**
 * One announcement at a time. Several rotate gently (paused on hover/focus, never with reduced motion,
 * and for good once the visitor uses the arrows). Dismissal is remembered per announcement set.
 */
export default function AnnouncementRotator({
  items,
  signature,
  labels,
}: {
  items: RotatorItem[];
  signature: string;
  labels: AnnouncementLabels;
}) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Server snapshot "true": no rotation until the client knows the visitor's preference.
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
  const fadeTimer = useRef<number | undefined>(undefined);
  const count = items.length;

  // The pre-paint script may have hidden the bar for an older dismissed set; never hide a new one.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY) !== signature) {
        document.documentElement.removeAttribute(ANNOUNCEMENT_HIDDEN_ATTR);
      }
    } catch {
      document.documentElement.removeAttribute(ANNOUNCEMENT_HIDDEN_ATTR);
    }
  }, [signature]);

  const step = useCallback(
    (delta: number) => {
      window.clearTimeout(fadeTimer.current);
      const advance = () => setIndex((i) => (((i + delta) % count) + count) % count);
      if (reducedMotion) {
        advance();
        return;
      }
      setFading(true);
      fadeTimer.current = window.setTimeout(() => {
        advance();
        setFading(false);
      }, FADE_MS);
    },
    [count, reducedMotion],
  );

  useEffect(() => {
    if (count < 2 || paused || interacted || reducedMotion || dismissed) return;
    const id = window.setInterval(() => step(1), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [count, paused, interacted, reducedMotion, dismissed, step]);

  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);

  if (dismissed || count === 0) return null;
  const current = items[Math.min(index, count - 1)];

  const dismiss = () => {
    try {
      window.localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, signature);
    } catch {
      // Without storage the bar simply returns on the next visit.
    }
    document.documentElement.setAttribute(ANNOUNCEMENT_HIDDEN_ATTR, "");
    setDismissed(true);
  };

  const manual = (delta: number) => {
    setInteracted(true);
    step(delta);
  };

  return (
    <div
      role="region"
      aria-label={labels.region}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      className={cn(
        "relative text-xs transition-colors duration-500 motion-reduce:transition-none print:hidden",
        "[html[data-announcement-hidden]_&]:hidden",
        VARIANT_CLASS[current.variant],
      )}
    >
      <div className="container-x flex min-h-10 items-center gap-2 py-1.5">
        <div className="flex w-[3.75rem] shrink-0 justify-start">
          {count > 1 ? (
            <button type="button" onClick={() => manual(-1)} aria-label={labels.previous} className={controlClass}>
              <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" strokeWidth={1.5} />
            </button>
          ) : null}
        </div>

        {/* Every announcement sits in the same grid cell; the others are invisible copies, so the bar is
            always as tall as its longest text and the page below never moves when the text rotates
            (a long one wraps to two lines on phones). On Arabic phones the bar keeps two lines' height
            anyway: the Arabic faces load late (not preloaded) and a text can go from two lines to one and
            back as each face arrives, which would move the whole page. */}
        <div className="grid min-w-0 flex-1 max-sm:rtl:min-h-[3em]">
          {count > 1
            ? items.map((item) => (
                <p key={item.id} aria-hidden className={cn(textClass, "invisible")}>
                  {item.text}
                </p>
              ))
            : null}
          <p
            aria-live={interacted ? "polite" : "off"}
            className={cn(textClass, "self-center transition-opacity duration-200 motion-reduce:transition-none", fading ? "opacity-0" : "opacity-100")}
          >
            {current.href ? (
              <SmartLink
                href={current.href}
                external={current.external}
                className="underline decoration-current/40 underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              >
                {current.text}
              </SmartLink>
            ) : (
              current.text
            )}
          </p>
        </div>

        <div className="flex w-[3.75rem] shrink-0 items-center justify-end gap-1">
          {count > 1 ? (
            <button type="button" onClick={() => manual(1)} aria-label={labels.next} className={controlClass}>
              <ChevronRight aria-hidden className="size-4 rtl:rotate-180" strokeWidth={1.5} />
            </button>
          ) : null}
          <button type="button" onClick={dismiss} aria-label={labels.dismiss} className={controlClass}>
            <X aria-hidden className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
