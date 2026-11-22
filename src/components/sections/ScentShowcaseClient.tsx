"use client";

// The four scents. Hovering, focusing or tapping a scent morphs the whole section to that product's
// color (the --p-* variables change and background/accents transition), crossfades the large image
// and swaps the copy. Radiogroup semantics with roving focus; arrow keys follow the reading
// direction; swipe on the stage on touch screens; motion is dropped for prefers-reduced-motion.
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Locale } from "@/i18n/config";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { buttonClass } from "./button-styles";

export type ScentItem = {
  id: number;
  name: string;
  subtitle: string;
  tagline: string;
  description: string;
  href: string;
  accent: string;
  /** productScopeStyle(accent), computed on the server. */
  scopeStyle: CSSProperties;
  image: MediaLike | null;
  imageAlt: string;
};

const css = `@keyframes prestij-scent-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.prestij-scent-in>*{animation:prestij-scent-in .7s cubic-bezier(.16,1,.3,1) both}
.prestij-scent-in>:nth-child(2){animation-delay:.05s}.prestij-scent-in>:nth-child(3){animation-delay:.1s}
.prestij-scent-in>:nth-child(4){animation-delay:.15s}.prestij-scent-in>:nth-child(5){animation-delay:.2s}
@media (prefers-reduced-motion: reduce){.prestij-scent-in>*{animation:none}}`;

const MORPH = "transition-[background-color,color,border-color,opacity] duration-[900ms] ease-out motion-reduce:transition-none";

export default function ScentShowcaseClient({
  items,
  label,
  ctaLabel,
  locale,
  heading,
}: {
  items: ScentItem[];
  /** Accessible name of the radiogroup (the section title). */
  label: string;
  ctaLabel: string;
  locale: Locale;
  heading: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const panelId = useId();
  const count = items.length;
  const current = items[active] ?? items[0];

  const rtl = () => document.documentElement.dir === "rtl";

  const select = (index: number, focus: boolean) => {
    const next = (index + count) % count;
    setActive(next);
    const el = radios.current[next];
    if (focus && el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = rtl() ? -1 : 1;
    const keys: Record<string, number> = {
      ArrowRight: active + step,
      ArrowLeft: active - step,
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: count - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    select(keys[e.key], true);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(e.clientY - start.y)) return;
    const towardsNext = rtl() ? dx > 0 : dx < 0;
    select(active + (towardsNext ? 1 : -1), false);
  };

  return (
    <section
      className={cn("product-scope relative isolate overflow-hidden bg-product-soft", MORPH)}
      style={current.scopeStyle}
    >
      <style href="prestij-scent" precedence="default">
        {css}
      </style>

      {/* Soft color fields that drift with the active scent. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className={cn("absolute -start-[15%] top-[8%] size-[80vmin] rounded-full bg-product opacity-25 blur-[120px]", MORPH)} />
        <div className={cn("absolute -end-[20%] -bottom-[25%] size-[70vmin] rounded-full bg-product-strong opacity-15 blur-[140px]", MORPH)} />
      </div>

      <div className="container-x py-20 md:py-28 lg:py-32">
        {heading}

        <div className="mt-12 grid gap-10 md:mt-16 lg:mt-20 lg:grid-cols-12 lg:items-center lg:gap-x-12 lg:gap-y-16">
          {/* Stage */}
          <div
            className="touch-pan-y lg:col-span-6 lg:row-start-1"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (swipe.current = null)}
          >
            <div className="relative mx-auto aspect-[4/5] w-full max-w-md lg:max-w-[34rem]">
              <div aria-hidden className={cn("absolute -inset-3 rounded-t-full border border-product/50 md:-inset-4", MORPH)} />
              <div className="absolute inset-0 overflow-hidden rounded-t-full bg-product/20">
                {items.map((item, i) =>
                  item.image ? (
                    <div
                      key={item.id}
                      aria-hidden={i !== active}
                      className={cn(
                        "absolute inset-0 transition-[opacity,transform] duration-[900ms] ease-out motion-reduce:transition-none",
                        i === active ? "scale-100 opacity-100" : "scale-[1.05] opacity-0",
                      )}
                    >
                      <Img
                        media={item.image}
                        alt={i === active ? item.imageAlt : ""}
                        locale={locale}
                        sizes="(min-width: 1024px) 40vw, (min-width: 640px) 28rem, 90vw"
                        fill
                      />
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </div>

          {/* Scent picker */}
          <div
            role="radiogroup"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:col-span-12 lg:row-start-2 lg:grid-cols-4 lg:gap-4"
          >
            {items.map((item, i) => {
              const checked = i === active;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    radios.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-controls={panelId}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => select(i, false)}
                  onFocus={() => setActive(i)}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setActive(i);
                  }}
                  className={cn(
                    "group/tile relative flex w-[15.5rem] shrink-0 snap-start items-center gap-4 rounded-md border p-3 text-start sm:w-auto",
                    "transition-[background-color,border-color,box-shadow] duration-500 motion-reduce:transition-none",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    checked
                      ? "border-product bg-surface/80 shadow-[0_18px_40px_-24px_rgb(0_0_0/0.35)]"
                      : "border-text/10 bg-surface/30 hover:bg-surface/60",
                  )}
                >
                  <span className="relative size-14 shrink-0 overflow-hidden rounded-full bg-surface-2 ring-1 ring-black/5">
                    {item.image && <Img media={item.image} alt="" locale={locale} sizes="56px" fill />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.accent }} />
                      <span className="truncate font-heading text-xl text-text">{item.name}</span>
                    </span>
                    {item.subtitle && (
                      <span className="mt-1 block truncate text-[0.7rem] uppercase tracking-[0.16em] text-text-muted">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Copy for the active scent */}
          <div id={panelId} className="lg:col-span-5 lg:col-start-8 lg:row-start-1">
            <div key={current.id} className="prestij-scent-in flex flex-col items-start">
              {current.subtitle && <p className={cn("eyebrow text-product-strong", MORPH)}>{current.subtitle}</p>}
              <h3 className="mt-4 font-heading text-5xl leading-none tracking-tight text-text md:text-6xl xl:text-7xl">
                {current.name}
              </h3>
              {current.tagline && <p className="mt-5 font-heading text-xl italic text-text-muted md:text-2xl">{current.tagline}</p>}
              {current.description && (
                <p className="mt-6 max-w-md text-base leading-relaxed text-pretty text-text-muted">{current.description}</p>
              )}
              <Link href={current.href} className={buttonClass("product", "group/link mt-10")}>
                <span>
                  {ctaLabel}
                  <span className="sr-only"> — {current.name}</span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 transition-transform duration-300 group-hover/link:translate-x-1 rtl:-scale-x-100 rtl:group-hover/link:-translate-x-1"
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
