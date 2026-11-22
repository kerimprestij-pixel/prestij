"use client";

// Interactive body of the /sepet page: lines with steppers and issue fixes, free-shipping progress,
// samples, coupon, summary and the checkout call-to-action. Starts from the server-rendered view and
// stays in sync with the drawer and the header badge through the shared cart controller.
import { ArrowLeft, CircleCheck, CircleExclamationPoint, Lock, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import type { CartLineView, CartView } from "@/lib/cart/view";
import { cn } from "@/lib/utils";
import CartEmpty from "./CartEmpty";
import CartLineItem from "./CartLineItem";
import { CartSummaryRows, CheckoutCta } from "./CartSummary";
import CouponForm from "./CouponForm";
import { keepFocusAfterRemoval } from "./focus-after-remove";
import FreeShippingProgress from "./FreeShippingProgress";
import IssueNote, { noteTone } from "./IssueNote";
import type { CartLinks, CartUiLabels } from "./labels";
import SamplePicker from "./SamplePicker";
import { useCartController } from "./use-cart-controller";
import WheelPrizeNote from "./WheelPrizeNote";

type Props = {
  locale: Locale;
  initialView: CartView;
  labels: CartUiLabels;
  links: CartLinks;
  /** "1–3 iş günü içinde kargoda", or null. */
  shipsIn: string | null;
};

const NOTICE_MS = 7000;

export default function CartPageClient({ locale, initialView, labels, links, shipsIn }: Props) {
  const cart = useCartController({ locale, initialView, genericError: labels.generic });
  const { pending, busyLineIds, message, load, setQuantity, remove, addSample, applyCoupon, removeCoupon } = cart;
  const view = cart.view ?? initialView;
  const [hiddenNoticeId, setHiddenNoticeId] = useState(0);

  useEffect(() => {
    if (!message?.visible) return;
    const id = message.id;
    const timer = window.setTimeout(() => setHiddenNoticeId(id), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const notice = message?.visible && message.id !== hiddenNoticeId ? message : null;
  // Removing a line unmounts its focused button: move focus to a neighbour or the empty-state link.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusFallback = () => rootRef.current?.querySelector<HTMLElement>("[data-cart-empty-cta]") ?? null;
  const removeLine = (line: CartLineView) => {
    keepFocusAfterRemoval(rootRef.current, line.lineId, focusFallback);
    remove(line);
  };
  const changeQuantity = (line: CartLineView, quantity: number) => {
    if (quantity <= 0) keepFocusAfterRemoval(rootRef.current, line.lineId, focusFallback);
    setQuantity(line, quantity);
  };
  const cartIssues = view.issues.filter((i) => i.lineId == null && i.code !== "empty");
  const blockedText = view.blockingIssues.find((i) => i.lineId == null && i.code !== "empty")?.message ?? labels.checkoutBlocked;
  const couponRow = view.summary.find((row) => row.key === "coupon");

  return (
    <div ref={rootRef} className="contents">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {message ? <span key={message.id}>{message.text}</span> : null}
      </div>

      {view.isEmpty ? (
        <div className="rounded-md border border-border bg-surface/60">
          {/* Day 6: a prize waiting in the account is a reason to come back to the collection. */}
          {view.wheelPrize ? (
            <WheelPrizeNote
              prize={view.wheelPrize}
              locale={locale}
              variant="page"
              applyLabel={labels.coupon.apply}
              applyingLabel={labels.coupon.applying}
              onApply={applyCoupon}
              onExpire={load}
              pending={pending}
              className="mx-auto mt-8 max-w-md px-4 sm:px-5"
            />
          ) : null}
          <CartEmpty variant="page" title={labels.empty} text={labels.emptyText} cta={labels.emptyCta} href={links.products} />
        </div>
      ) : (
        <>
          <p className="-mt-4 mb-10 text-sm tabular-nums text-text-muted md:-mt-6">{view.itemCountLabel}</p>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <section aria-labelledby="cart-items-heading" className="min-w-0 lg:col-span-7 xl:col-span-8">
              <h2 id="cart-items-heading" className="sr-only">
                {labels.itemsHeading}
              </h2>

              {notice ? (
                <div
                  className={cn(
                    "mb-5 flex animate-fade-in items-start gap-2.5 rounded-md border px-4 py-3 text-sm",
                    notice.tone === "error" ? noteTone.error : notice.tone === "info" ? noteTone.info : noteTone.success,
                  )}
                >
                  {notice.tone === "error" ? (
                    <CircleExclamationPoint aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                  ) : (
                    <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.5} />
                  )}
                  <p className="min-w-0">{notice.text}</p>
                </div>
              ) : null}

              <FreeShippingProgress
                view={view}
                locale={locale}
                heavyNote={labels.heavyNote}
                pending={pending}
                className="rounded-md border border-border bg-surface px-5 py-5 sm:px-6"
              />

              <ul className="mt-2 divide-y divide-border border-b border-border">
                {view.lines.map((line) => (
                  <CartLineItem
                    key={line.lineId}
                    line={line}
                    locale={locale}
                    labels={labels}
                    variant="page"
                    busy={busyLineIds.includes(line.lineId)}
                    onQuantity={changeQuantity}
                    onRemove={removeLine}
                  />
                ))}
              </ul>

              {cartIssues.length > 0 ? (
                <div className="mt-5 flex flex-col gap-2">
                  {cartIssues.map((issue) => (
                    <IssueNote key={issue.code} blocking={issue.blocking}>
                      {issue.message}
                      {/* Subscribe and save: a subscription needs an account; sign in and come back here. */}
                      {issue.code === "subscription_sign_in" && view.subscription.signInHref ? (
                        <>
                          {" "}
                          <a href={view.subscription.signInHref} className="font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
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
                variant="page"
                onAdd={addSample}
                className="mt-12 rounded-md border border-border bg-surface/60 p-5 sm:p-6"
              />

              <Link href={links.products} className={buttonClass("link", "mt-12")}>
                <ArrowLeft
                  aria-hidden
                  className="size-4 transition-transform duration-300 group-hover/link:-translate-x-1 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover/link:translate-x-1"
                  strokeWidth={1.5}
                />
                {labels.continueShopping}
              </Link>
            </section>

            <aside aria-labelledby="cart-summary-heading" className="min-w-0 lg:col-span-5 xl:col-span-4">
              <div className="rounded-md border border-border bg-surface p-6 shadow-[0_30px_60px_-40px_rgb(2_21_56/0.25)] md:p-8 lg:sticky lg:top-28">
                <h2 id="cart-summary-heading" className="font-heading text-3xl text-text">
                  {labels.summaryTitle}
                </h2>

                <CouponForm
                  className="mt-7"
                  coupon={view.coupon}
                  wheelPrize={view.wheelPrize}
                  locale={locale}
                  discountLabel={couponRow?.amountLabel ?? null}
                  labels={labels.coupon}
                  onApply={applyCoupon}
                  onRemove={removeCoupon}
                  onPrizeExpire={load}
                  pending={pending}
                />

                <CartSummaryRows className="mt-8 border-t border-border pt-6" rows={view.summary} pending={pending} />
                <p className="mt-4 text-xs leading-relaxed text-text-muted">{labels.paymentNote}</p>

                <CheckoutCta
                  className="mt-6"
                  href={links.checkout}
                  label={labels.checkout}
                  allowed={view.checkoutAllowed}
                  blockedText={blockedText}
                  pending={pending}
                />

                <ul className="mt-6 flex flex-col gap-2.5 border-t border-border pt-5 text-xs text-text-muted">
                  <li className="flex items-center gap-2.5">
                    <Lock aria-hidden className="size-3.5 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.5} />
                    {labels.securePayment}
                  </li>
                  {shipsIn ? (
                    <li className="flex items-center gap-2.5">
                      <Truck aria-hidden className="size-3.5 shrink-0 text-gold-text dark:text-gold" strokeWidth={1.5} />
                      {shipsIn}
                    </li>
                  ) : null}
                </ul>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
