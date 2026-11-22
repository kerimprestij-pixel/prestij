"use client";
// The PayTR payment iframe inside the brand frame. PayTR's iframeResizer (loaded from the same origin
// as the iframe) keeps it at the form's height; until then a minimum height keeps the form usable.
import Script from "next/script";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

declare global {
  interface Window {
    iFrameResize?: (options: Record<string, unknown>, selector: string) => void;
  }
}

type Props = { src: string; resizerSrc: string; title: string; loadingLabel: string };

/** The iframe may finish loading before hydration (its load event is then missed): stop waiting anyway. */
const LOADER_MAX_MS = 2500;

export default function CardPaymentFrame({ src, resizerSrc, title, loadingLabel }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [resizer, setResizer] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), LOADER_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!resizer || !window.iFrameResize) return;
    try {
      window.iFrameResize({}, "#paytriframe");
    } catch {
      // The minimum height still shows the whole form.
    }
  }, [resizer]);

  return (
    <div className="relative">
      <Script src={resizerSrc} strategy="afterInteractive" onReady={() => setResizer(true)} />
      {!loaded ? (
        <p role="status" className="pointer-events-none absolute inset-x-0 top-16 flex items-center justify-center gap-2 text-sm text-neutral-500">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
          {loadingLabel}
        </p>
      ) : null}
      <iframe
        id="paytriframe"
        src={src}
        title={title}
        onLoad={() => setLoaded(true)}
        allow="payment"
        referrerPolicy="no-referrer"
        className="block min-h-[38rem] w-full border-0 bg-transparent"
      />
    </div>
  );
}
