"use client";
// Header account icon (client island, so the header and every static page stay prerendered). Signed
// out (and before the viewer loads): a link to the sign-in page that returns to the current page.
// Signed in: a link to /hesap with the first name beside the icon on wide screens.
//
// No layout shift: on wide screens the greeting is wider than the icon. The width of the signed-in
// link is remembered (./account-link-width) and reserved before first paint on the next page loads,
// so the signed-out look that renders first already takes the same space.

import { UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type MouseEvent } from "react";
import { iconButton } from "@/components/store/shell-styles";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { href, signInHref } from "@/i18n/paths";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_GREETING_QUERY,
  ACCOUNT_WIDTH_VAR,
  accountWidthToStore,
  forgetAccountWidth,
  hasAccountWidth,
  rememberAccountWidth,
  storedAccountWidth,
} from "./account-link-width";

type Props = {
  locale: Locale;
  labels: { signIn: string; account: string; signedIn: string; greeting: string };
  className?: string;
};

/**
 * While a width is reserved (attribute on <html>, set before paint), the signed-out link takes it on
 * wide screens with the icon where the signed-in link shows it, so nothing moves when the viewer loads.
 */
const reservedWhileLoading =
  "xl:[html[data-account-hint]_&]:w-(--prestij-account-w) xl:[html[data-account-hint]_&]:justify-start xl:[html[data-account-hint]_&]:px-3";

export default function AccountLink({ locale, labels, className }: Props) {
  const viewer = useViewer();
  const router = useRouter();
  const signedIn = viewer.ready && viewer.signedIn;
  const name = signedIn ? viewer.firstName : null;
  const contentRef = useRef<HTMLSpanElement>(null);

  // Remember the signed-in width (per language) for the next page loads; forget it once signed out.
  const greeting = name ? format(labels.greeting, { name }) : "";
  useEffect(() => {
    if (!viewer.ready) return;
    if (!signedIn) {
      if (hasAccountWidth()) forgetAccountWidth();
      return;
    }
    let cancelled = false;
    const measure = () => {
      const content = contentRef.current;
      const link = content?.parentElement;
      if (cancelled || !content || !link || !window.matchMedia(ACCOUNT_GREETING_QUERY).matches) return;
      const style = window.getComputedStyle(link);
      const natural = content.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const width = accountWidthToStore(natural);
      const reserved = parseFloat(document.documentElement.style.getPropertyValue(ACCOUNT_WIDTH_VAR)) || null;
      if (width != null && (width !== storedAccountWidth(locale) || width !== reserved)) rememberAccountWidth(locale, width);
    };
    // Measure with the final web font (the fallback face can be a pixel or two narrower or wider).
    if (document.fonts?.ready) void document.fonts.ready.then(measure);
    else measure();
    return () => {
      cancelled = true;
    };
  }, [viewer.ready, signedIn, greeting, locale]);

  if (signedIn) {
    return (
      <Link
        href={href(locale, "account")}
        aria-label={name ? format(labels.signedIn, { name }) : labels.account}
        title={labels.account}
        className={cn(iconButton, "xl:w-auto xl:min-w-(--prestij-account-w) xl:justify-start xl:px-3", className)}
      >
        <span ref={contentRef} className="inline-flex items-center gap-2">
          <span className="relative">
            <UserRound aria-hidden className="size-5" strokeWidth={1.5} />
            <span aria-hidden className="absolute -end-0.5 -bottom-0.5 size-2 rounded-full bg-gold ring-2 ring-bg" />
          </span>
          {greeting ? (
            <span aria-hidden className="hidden max-w-32 truncate text-sm xl:inline">
              {greeting}
            </span>
          ) : null}
        </span>
      </Link>
    );
  }

  // Return to the page the visitor is on (read at click time, so the server HTML stays the same).
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const path = window.location.pathname;
    if (path === href(locale, "signIn") || path === href(locale, "register") || path === href(locale, "home")) return;
    event.preventDefault();
    router.push(signInHref(locale, path + window.location.search));
  };

  return (
    <Link
      href={href(locale, "signIn")}
      onClick={onClick}
      aria-label={labels.signIn}
      title={labels.signIn}
      className={cn(iconButton, !viewer.ready && reservedWhileLoading, className)}
    >
      <UserRound aria-hidden className="size-5" strokeWidth={1.5} />
    </Link>
  );
}
