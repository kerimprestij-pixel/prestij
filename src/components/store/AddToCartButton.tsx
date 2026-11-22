"use client";

// Quantity stepper + add to cart for the variant selected on the product page. Limits come from the
// static page (min/max/stock per variant); the addToCart action re-checks everything with live stock
// and may clamp. On success the cart drawer opens with the fresh cart.
import { Check, LoaderCircle, ShoppingBag } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { publishCartView, openCartDrawer } from "@/components/cart/cart-store";
import QuantityStepper from "@/components/cart/QuantityStepper";
import type { PurchaseLimit } from "@/components/cart/purchase-limits";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { addToCart } from "@/lib/cart/actions";
import type { CartActionResult } from "@/lib/cart/action-types";
import { cn } from "@/lib/utils";
import { useSubscriptionChoice } from "./subscription/SubscriptionChoiceContext";
import { useVariantSelection } from "./VariantContext";

export type AddToCartLabels = {
  addToCart: string;
  adding: string;
  added: string;
  outOfStock: string;
  /** "Adet" */
  quantity: string;
  increase: string;
  decrease: string;
  /** "… en fazla {count} adet …" */
  maxReached: string;
  /** "… en az {count} adet …" */
  minRequired: string;
  /** Fallback when the action cannot be reached. */
  error: string;
};

const ADDED_MS = 2600;

export default function AddToCartButton({
  locale,
  limits,
  labels,
  className,
}: {
  locale: Locale;
  limits: PurchaseLimit[];
  labels: AddToCartLabels;
  className?: string;
}) {
  const { selectedId } = useVariantSelection();
  const { planId: subscriptionPlanId } = useSubscriptionChoice();
  const limit = limits.find((l) => l.id === selectedId) ?? (selectedId == null ? limits[0] : undefined);
  const soldOut = !limit || limit.soldOut;
  const min = limit?.min ?? 1;
  const max = Math.max(min, limit?.max ?? min);

  const [quantity, setQuantity] = useState(min);
  const [forVariant, setForVariant] = useState(selectedId);
  const [error, setError] = useState<string | null>(null);
  const [addedAt, setAddedAt] = useState(0);
  const [pending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const errorId = useId();

  // A different variant starts again from its own minimum.
  if (forVariant !== selectedId) {
    setForVariant(selectedId);
    setQuantity(min);
    setError(null);
    setAddedAt(0);
  }
  const qty = Math.min(max, Math.max(min, quantity));

  useEffect(() => {
    if (!addedAt) return;
    const timer = window.setTimeout(() => setAddedAt(0), ADDED_MS);
    return () => window.clearTimeout(timer);
  }, [addedAt]);

  const add = () => {
    if (!limit || soldOut || pending) return;
    const variantId = limit.id;
    setError(null);
    startTransition(async () => {
      let result: CartActionResult;
      try {
        // Subscribe and save: the product page's choice (undefined when the page offers none).
        result = await addToCart({ variantId, quantity: qty, locale, ...(subscriptionPlanId !== undefined ? { subscriptionPlanId } : {}) });
      } catch {
        result = { ok: false, code: "generic", error: labels.error };
      }
      startTransition(() => {
        if (result.view) publishCartView(result.view);
        if (result.ok) {
          setAddedAt(Date.now());
          setQuantity(min);
          openCartDrawer({ fresh: true, notice: result.notice, highlightVariantId: variantId, returnFocus: buttonRef.current });
        } else {
          setError(result.error);
        }
      });
    });
  };

  const hint =
    soldOut
      ? null
      : qty >= max && max > min
        ? format(labels.maxReached, { count: max }, locale)
        : min > 1
          ? format(labels.minRequired, { count: min }, locale)
          : null;
  const justAdded = addedAt > 0 && !pending;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const state: "soldOut" | "pending" | "added" | "idle" = soldOut ? "soldOut" : pending ? "pending" : justAdded ? "added" : "idle";
  // Every state's label sits in the same grid cell; only the current one is visible. The button is
  // therefore always as tall as its longest label (no jump when "Sepete ekle" becomes "Sepete eklendi"),
  // and a label that is too long for the width wraps instead of being cut off.
  const stateLabels = soldOut
    ? [{ key: "soldOut", text: labels.outOfStock }]
    : [
        { key: "idle", text: labels.addToCart },
        { key: "pending", text: labels.adding },
        { key: "added", text: labels.added },
      ];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* The button needs about 13rem for the longest label at the uppercase tracking; when the stepper
          leaves less (phones, the narrow product column on small laptops), it takes its own full row. */}
      <div className="flex flex-wrap items-stretch gap-3">
        {!soldOut ? (
          <QuantityStepper
            size="md"
            value={qty}
            min={min}
            max={max}
            onChange={setQuantity}
            disabled={pending}
            describedBy={hint ? hintId : undefined}
            labels={{ quantity: labels.quantity, decrease: labels.decrease, increase: labels.increase }}
          />
        ) : null}
        <button
          ref={buttonRef}
          type="button"
          onClick={add}
          disabled={soldOut}
          aria-disabled={pending || undefined}
          aria-describedby={describedBy}
          data-variant-id={limit?.id}
          data-state={state}
          className={cn(
            buttonClass("product", "min-w-0 flex-1 basis-[13rem] px-5 py-3 leading-snug"),
            pending && "cursor-progress",
          )}
        >
          {pending ? (
            <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.5} />
          ) : justAdded ? (
            <Check aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          ) : (
            <ShoppingBag aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
          )}
          <span className="grid min-w-0 text-center">
            {stateLabels.map(({ key, text }) => (
              <span
                key={key}
                aria-hidden={key !== state || undefined}
                data-label={key}
                className={cn("col-start-1 row-start-1 text-balance break-words", key !== state && "invisible")}
              >
                {text}
              </span>
            ))}
          </span>
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
      <p id={errorId} role="status" className={cn("text-sm text-rose-800 dark:text-rose-200", !error && "sr-only")}>
        {error}
      </p>
    </div>
  );
}
