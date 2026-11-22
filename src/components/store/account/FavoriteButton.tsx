"use client";
// The favorite heart: a client island on product cards and the product page (static pages stay
// static: it reads the viewer loaded after hydration, never the session on the server). Signed out,
// it goes to the sign-in page and comes back here. Signed in, it toggles optimistically and rolls
// back on failure. Labels and the locale come from <FavoriteLabelsProvider> in the storefront layout.

import { Heart } from "lucide-react";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { signInHref } from "@/i18n/paths";
import { toggleFavoriteAction } from "@/lib/account/actions";
import { cn } from "@/lib/utils";

type FavoriteLabels = Messages["account"]["favorite"];
type FavoriteContextValue = { locale: Locale; labels: FavoriteLabels };

const FavoriteContext = createContext<FavoriteContextValue | null>(null);

export function FavoriteLabelsProvider({ locale, labels, children }: { locale: Locale; labels: FavoriteLabels; children: ReactNode }) {
  return <FavoriteContext value={{ locale, labels }}>{children}</FavoriteContext>;
}

/**
 * Accessible names follow the APG toggle pattern: the card heart keeps one label naming the product
 * ("Favorilere ekle: Lavanta Latte") and reports its state with aria-pressed; the product page button
 * says its state in its visible text instead (no aria-pressed). Signed out it is a plain button that
 * goes to sign-in.
 */
export default function FavoriteButton({
  productId,
  productName,
  variant = "card",
  className,
}: {
  productId: number;
  /** Shown to screen readers on product cards, so a list of hearts is not five identical buttons. */
  productName?: string;
  variant?: "card" | "detail";
  className?: string;
}) {
  const context = useContext(FavoriteContext);
  const viewer = useViewer();
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  if (!context) return null;
  const { locale, labels } = context;
  const on = viewer.ready && viewer.signedIn && viewer.favoriteProductIds.includes(productId);
  const signedOut = viewer.ready && !viewer.signedIn;
  const base = signedOut ? labels.signIn : labels.add;
  const label = productName ? `${base}: ${productName}` : base;

  const toggle = () => {
    if (!viewer.ready) return;
    if (!viewer.signedIn) {
      window.location.assign(signInHref(locale, window.location.pathname + window.location.search));
      return;
    }
    const next = !on;
    viewer.setFavorite(productId, next);
    startTransition(async () => {
      const result = await toggleFavoriteAction({ productId, favorite: next, locale });
      if (result.ok) {
        setAnnouncement(result.message ?? (next ? labels.added : labels.removed));
      } else {
        viewer.setFavorite(productId, !next);
        setAnnouncement(result.error);
        if (result.sessionExpired) await viewer.refresh();
      }
    });
  };

  const icon = (
    <Heart
      aria-hidden
      strokeWidth={1.6}
      className={cn(
        "size-[1.15rem] transition-[fill,color,transform] duration-300 motion-reduce:transition-none",
        on ? "fill-gold text-gold" : "fill-transparent",
        pending && "scale-90",
      )}
    />
  );

  if (variant === "detail") {
    return (
      <>
        <button
          type="button"
          onClick={toggle}
          aria-busy={pending}
          className={cn(
            "inline-flex min-h-11 items-center gap-2.5 rounded-control text-sm text-text transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring dark:hover:text-text",
            className,
          )}
        >
          {icon}
          <span className="underline decoration-border underline-offset-4">{on ? labels.saved : labels.save}</span>
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={signedOut ? undefined : on}
        aria-label={label}
        title={label}
        aria-busy={pending}
        className={cn(
          "grid size-10 place-items-center rounded-full bg-surface/85 text-text shadow-[0_6px_18px_-10px_rgb(0_0_0/0.45)] backdrop-blur-sm transition-[background-color,color,transform] duration-300 hover:bg-surface hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none dark:hover:text-text",
          className,
        )}
      >
        {icon}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
