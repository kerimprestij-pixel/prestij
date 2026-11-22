"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky <header> that is transparent at the top of the page and turns into a blurred, hairlined bar
 * once the page scrolls. The state lives in a data attribute, so scrolling never re-renders React.
 */
export default function HeaderScrollShell({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      element.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      ref={ref}
      data-scrolled="false"
      className={cn(
        "sticky top-0 z-40 border-b border-transparent bg-transparent",
        "transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-out motion-reduce:transition-none",
        "data-[scrolled=true]:border-border data-[scrolled=true]:bg-bg/85 data-[scrolled=true]:shadow-[0_8px_30px_-18px_rgb(0_0_0/0.25)] data-[scrolled=true]:backdrop-blur-md data-[scrolled=true]:backdrop-saturate-150",
        className,
      )}
    >
      {children}
    </header>
  );
}
