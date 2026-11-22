"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore, type MouseEvent } from "react";
import { openCartDrawer } from "@/components/cart/cart-store";
import { format } from "@/i18n/format";
import { href as buildHref, isLocaleCode } from "@/i18n/paths";
import { cn } from "@/lib/utils";
import { CART_COUNT_EVENT, CART_COUNT_STORAGE_KEY, readStoredCartCount } from "./cart-count";
import { iconButton } from "./shell-styles";

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CART_COUNT_STORAGE_KEY) onChange();
  };
  window.addEventListener(CART_COUNT_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CART_COUNT_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

type CartLinkProps = {
  href: string;
  /** e.g. "Sepet" */
  label: string;
  /** e.g. "Sepet, {count} ürün" (may use plural syntax, see format()) */
  labelWithCount: string;
  /** Locale for plural rules. */
  locale: string;
  className?: string;
};

/** True on the cart and checkout pages, where the full page is the better place to edit the cart. */
function onCartOrCheckout(locale: string, cartHref: string): boolean {
  const path = window.location.pathname.replace(/\/+$/, "");
  const checkout = isLocaleCode(locale) ? buildHref(locale, "checkout") : null;
  return path === cartHref || (checkout != null && (path === checkout || path.startsWith(`${checkout}/`)));
}

/**
 * Header cart icon with a live item-count badge (0 on the server, restored on the client). A plain
 * click opens the cart drawer; it stays a real link for no-JS, new-tab and modified clicks, and on the
 * cart/checkout pages.
 */
export default function CartLink({ href, label, labelWithCount, locale, className }: CartLinkProps) {
  const count = useSyncExternalStore(subscribe, readStoredCartCount, () => 0);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (onCartOrCheckout(locale, href)) return;
    if (openCartDrawer({ returnFocus: event.currentTarget })) event.preventDefault();
  };

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={count > 0 ? format(labelWithCount, { count }, locale) : label}
      className={cn(iconButton, className)}
    >
      <ShoppingBag aria-hidden className="size-5" strokeWidth={1.5} />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -end-0.5 top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-gold px-1 text-[0.625rem] font-semibold leading-none text-gold-contrast tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
