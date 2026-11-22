"use client";

// The cart as an inline-end sheet (right in LTR, left in RTL). Loaded lazily by <CartDrawer> (the
// small island in the storefront layout), which forwards the openCartDrawer() requests (header cart
// icon, add to cart) to `register`. Loads the cart with the getCart action on open, edits it
// optimistically, traps focus, closes on Escape / backdrop / Back, returns focus to the trigger and
// announces every change politely.
import { CircleCheck, CircleExclamationPoint, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { iconButton } from "@/components/store/shell-styles";
import type { Locale } from "@/i18n/config";
import type { CartLineView } from "@/lib/cart/view";
import { cn } from "@/lib/utils";
import CartEmpty from "./CartEmpty";
import CartLineItem from "./CartLineItem";
import { CartLinesSkeleton } from "./CartSkeleton";
import { CartSummaryRows, CheckoutCta } from "./CartSummary";
import type { CartDrawerRequest } from "./cart-store";
import { keepFocusAfterRemoval } from "./focus-after-remove";
import FreeShippingProgress from "./FreeShippingProgress";
import IssueNote, { noteTone } from "./IssueNote";
import type { CartLinks, CartUiLabels } from "./labels";
import SamplePicker, { samplePickerShown } from "./SamplePicker";
import { useCartController, type CartMessage } from "./use-cart-controller";
import WheelPrizeNote from "./WheelPrizeNote";

export type CartDrawerSheetProps = {
  locale: Locale;
  labels: CartUiLabels;
  links: CartLinks;
  /** Hands the shell the function that handles an open request (again if it changes; null on unmount). */
  register: (open: ((request: CartDrawerRequest) => void) | null) => void;
};

const TRANSITION_MS = 380;
const HIGHLIGHT_MS = 1800;
const NOTICE_MS = 6000;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function CartDrawerSheet({ locale, labels, links, register }: CartDrawerSheetProps) {
  const cart = useCartController({ locale, initialView: null, genericError: labels.generic });
  const { view, pending, busyLineIds, message, loadFailed, say, load, clearMessage, setQuantity, remove, addSample, applyCoupon } = cart;

  const [mounted, setMounted] = useState(false); // sheet is in the DOM
  const [shown, setShown] = useState(false); // sheet is slid in
  const [openCount, setOpenCount] = useState(0); // re-runs the slide-in when reopened mid-close
  const [highlight, setHighlight] = useState<number | null>(null);
  const [hiddenNoticeId, setHiddenNoticeId] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const highlightTimer = useRef<number | undefined>(undefined);
  const titleId = useId();

  const close = useCallback(
    (restoreFocus = true) => {
      setShown(false);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(
        () => {
          setMounted(false);
          clearMessage();
          const target = returnFocus.current;
          returnFocus.current = null;
          if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
        },
        prefersReducedMotion() ? 0 : TRANSITION_MS,
      );
    },
    [clearMessage],
  );

  // Open requests from the header icon and the add-to-cart button (forwarded by the shell).
  useEffect(() => {
    register((request) => {
      window.clearTimeout(closeTimer.current);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnFocus.current = request.returnFocus ?? (panelRef.current?.contains(active) ? returnFocus.current : active);
      setMounted(true);
      setOpenCount((n) => n + 1);
      if (request.notice) say(request.notice, "success");
      if (request.highlightVariantId != null) {
        setHighlight(request.highlightVariantId);
        window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
      }
      if (!request.fresh) load();
    });
    return () => register(null);
  }, [register, load, say]);

  // Slide in on the frame after mounting; move focus into the dialog.
  useEffect(() => {
    if (!mounted) return;
    const frame = window.requestAnimationFrame(() => {
      setShown(true);
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mounted, openCount]);

  // Scroll lock, focus trap, Escape and browser Back while open.
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
        if (event.defaultPrevented) return; // e.g. a quantity field reverting its draft
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = focusableIn(panel);
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPopState = () => close(false);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
    };
  }, [mounted, close]);

  // Bring the line that was just added into view (it may sit below the fold of the list).
  useEffect(() => {
    if (highlight == null || !shown || !view) return;
    const row = panelRef.current?.querySelector<HTMLElement>(`[data-variant-id="${highlight}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [highlight, shown, view]);

  // Visible notices fade away after a while (the live region keeps the text for screen readers).
  useEffect(() => {
    if (!message?.visible) return;
    const id = message.id;
    const timer = window.setTimeout(() => setHiddenNoticeId(id), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(highlightTimer.current);
    },
    [],
  );

  const leave = () => close(false);
  // Removing a line unmounts its focused button: keep focus inside the dialog.
  const focusFallback = () => panelRef.current?.querySelector<HTMLElement>("[data-cart-empty-cta]") ?? panelRef.current;
  const removeLine = (line: CartLineView) => {
    keepFocusAfterRemoval(panelRef.current, line.lineId, focusFallback);
    remove(line);
  };
  const changeQuantity = (line: CartLineView, quantity: number) => {
    if (quantity <= 0) keepFocusAfterRemoval(panelRef.current, line.lineId, focusFallback);
    setQuantity(line, quantity);
  };
  // The last visible notice stays mounted (faded out) after its timeout, so it can fade instead of vanish.
  const lastNotice = message?.visible ? message : null;
  const notice = lastNotice && lastNotice.id !== hiddenNoticeId ? lastNotice : null;
  const cartIssues = view?.issues.filter((i) => i.lineId == null && i.code !== "empty") ?? [];
  // Samples already in the cart are listed under the sample picker, not above it: a picked sample then
  // appears below the chips instead of pushing them down under the pointer.
  const pickerShown = view != null && !view.isEmpty && samplePickerShown(view);
  const mainLines = view ? (pickerShown ? view.lines.filter((l) => !l.isSample) : view.lines) : [];
  const sampleLines = pickerShown && view ? view.lines.filter((l) => l.isSample) : [];
  const lineItem = (line: CartLineView) => (
    <CartLineItem
      key={line.lineId}
      line={line}
      locale={locale}
      labels={labels}
      variant="drawer"
      busy={busyLineIds.includes(line.lineId)}
      highlight={highlight === line.variantId}
      onQuantity={changeQuantity}
      onRemove={removeLine}
      onNavigate={leave}
    />
  );
  const blockedText = view?.blockingIssues.find((i) => i.lineId == null && i.code !== "empty")?.message ?? labels.checkoutBlocked;

  const sheet = (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={() => close()}
        className={cn(
          "absolute inset-0 bg-brand-950/40 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending || undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 end-0 flex w-full flex-col bg-bg text-text shadow-[0_0_60px_-15px_rgb(2_21_56/0.45)] outline-none sm:w-[28rem] sm:max-w-[calc(100vw-2.5rem)] sm:border-s sm:border-border",
          "transition-transform duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          shown ? "translate-x-0" : "ltr:translate-x-full rtl:-translate-x-full",
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border py-3 ps-5 pe-3 sm:ps-7 sm:pe-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 id={titleId} className="font-heading text-[1.75rem] leading-none text-text">
              {labels.title}
            </h2>
            {view && !view.isEmpty ? (
              <span className="truncate text-xs tabular-nums text-text-muted">{view.itemCountLabel}</span>
            ) : null}
          </div>
          <button type="button" onClick={() => close()} aria-label={labels.close} className={iconButton}>
            <X aria-hidden className="size-5" strokeWidth={1.5} />
          </button>
        </header>

        {/* The notice floats over the top of the content instead of taking layout space, so nothing
            below it (free-shipping bar, lines, samples) moves when it appears or fades away. */}
        {lastNotice ? (
          <div className="relative z-10 h-0">
            <DrawerNotice key={lastNotice.id} message={lastNotice} hidden={!notice} />
          </div>
        ) : null}

        {view && !view.isEmpty ? (
          <FreeShippingProgress
            view={view}
            locale={locale}
            heavyNote={labels.heavyNote}
            pending={pending}
            className="border-b border-border bg-surface/60 px-5 py-4 sm:px-7 [@media(max-height:640px)]:py-2.5"
          />
        ) : null}

        {/* Day 6: the buyer's gift wheel prize, applied or kept, with its real countdown (empty cart too). */}
        {view?.wheelPrize ? (
          <WheelPrizeNote
            prize={view.wheelPrize}
            locale={locale}
            variant="drawer"
            applyLabel={labels.coupon.apply}
            applyingLabel={labels.coupon.applying}
            onApply={applyCoupon}
            onExpire={load}
            pending={pending}
            className="border-b border-border bg-gold-50/40 px-5 py-2.5 sm:px-7 dark:bg-gold-950/20 [@media(max-height:640px)]:py-1.5"
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-7">
          {!view ? (
            loadFailed ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <p className="text-sm text-text-muted">{labels.loadError}</p>
                <button
                  type="button"
                  onClick={load}
                  className="rounded-control border border-text/25 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.14em] hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {labels.retry}
                </button>
              </div>
            ) : (
              <div className="animate-pulse motion-reduce:animate-none">
                <p className="sr-only">{labels.loading}</p>
                <CartLinesSkeleton count={2} />
              </div>
            )
          ) : view.isEmpty ? (
            <CartEmpty
              variant="drawer"
              title={labels.empty}
              text={labels.emptyText}
              cta={labels.emptyCta}
              href={links.products}
              onNavigate={leave}
            />
          ) : (
            <>
              <h3 className="sr-only">{labels.itemsHeading}</h3>
              <ul className="divide-y divide-border">{mainLines.map(lineItem)}</ul>
              {cartIssues.length > 0 ? (
                <div className="flex flex-col gap-2 pb-4">
                  {cartIssues.map((issue) => (
                    <IssueNote key={issue.code} blocking={issue.blocking}>
                      {issue.message}
                      {/* Subscribe and save needs an account: sign in and come back to the cart (as on the cart page). */}
                      {issue.code === "subscription_sign_in" && view.subscription.signInHref ? (
                        <>
                          {" "}
                          <a
                            href={view.subscription.signInHref}
                            className="font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {labels.subscriptionSignIn}
                          </a>
                        </>
                      ) : null}
                    </IssueNote>
                  ))}
                </div>
              ) : null}
              <SamplePicker
                view={view}
                locale={locale}
                labels={labels}
                variant="drawer"
                onAdd={addSample}
                className="border-t border-border py-5"
              >
                {sampleLines.length > 0 ? <ul className="mt-5 divide-y divide-border border-t border-border">{sampleLines.map(lineItem)}</ul> : null}
              </SamplePicker>
            </>
          )}
        </div>

        {/* Short phones (≤ 640 px tall, e.g. mobile Safari with toolbars): the footer keeps only the
            total and the buttons, so the list above stays usable. The full breakdown is one tap away. */}
        {view && !view.isEmpty ? (
          <footer className="border-t border-border bg-surface/70 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:pt-5 [@media(max-height:640px)]:pt-3 [@media(max-height:640px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <CartSummaryRows
              rows={view.summary}
              omit={["vat"]}
              compact
              pending={pending}
              className="[@media(max-height:640px)]:[&_dl>div:not(:last-child)]:hidden [@media(max-height:640px)]:[&_dl>div:last-child]:mt-0 [@media(max-height:640px)]:[&_dl>div:last-child]:border-t-0 [@media(max-height:640px)]:[&_dl>div:last-child]:pt-0"
            />
            <p className="mt-1 text-xs text-text-muted [@media(max-height:640px)]:hidden">{labels.vatNote}</p>
            <CheckoutCta
              href={links.checkout}
              label={labels.checkout}
              allowed={view.checkoutAllowed}
              blockedText={blockedText}
              pending={pending}
              onNavigate={leave}
              className="mt-4 [@media(max-height:640px)]:mt-2.5"
            />
            <Link
              href={links.cart}
              onClick={leave}
              className="mt-2 flex min-h-10 [@media(max-height:640px)]:mt-1 [@media(max-height:640px)]:min-h-8 items-center justify-center rounded-xs text-xs font-medium uppercase tracking-[0.14em] text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {labels.viewCart}
            </Link>
          </footer>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {/* Persistent, so announcements are read even while the sheet mounts or unmounts. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {message ? <span key={message.id}>{message.text}</span> : null}
      </div>
      {mounted ? createPortal(sheet, document.body) : null}
    </>
  );
}

/**
 * Overlay under the header (absolutely positioned inside a zero-height slot). The opaque `bg-bg` base
 * keeps translucent dark tones readable over the content; `hidden` fades it out without unmounting.
 * Not a live region: the drawer's persistent sr-only region announces the text.
 */
function DrawerNotice({ message, hidden }: { message: CartMessage; hidden: boolean }) {
  const error = message.tone === "error";
  const Icon = error ? CircleExclamationPoint : CircleCheck;
  return (
    <div
      aria-hidden={hidden || undefined}
      data-cart-notice
      className={cn(
        "absolute inset-x-3 top-2 overflow-hidden rounded-lg bg-bg shadow-[0_12px_32px_-12px_rgb(2_21_56/0.45)] transition-opacity duration-300 motion-reduce:transition-none sm:inset-x-5",
        hidden ? "pointer-events-none opacity-0" : "animate-fade-in opacity-100",
      )}
    >
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm",
          error ? noteTone.error : message.tone === "info" ? noteTone.info : "border-border bg-surface text-text",
        )}
      >
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", !error && message.tone !== "info" && "text-gold-text dark:text-gold")} strokeWidth={1.5} />
        <p className="min-w-0">{message.text}</p>
      </div>
    </div>
  );
}
