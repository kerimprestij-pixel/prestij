"use client";
// "Complete payment" for card orders still in pending_payment: the Server Action verifies the order
// token, starts a new payment and redirects to the (simulated) 3-D Secure page.

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { retryPaymentAction, type RetryPaymentState } from "@/app/[locale]/siparis/actions";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

type RetryPaymentFormProps = {
  locale: Locale;
  orderNumber: string;
  token: string;
  labels: { button: string; pending: string };
};

const initialState: RetryPaymentState = {};

export default function RetryPaymentForm({ locale, orderNumber, token, labels }: RetryPaymentFormProps) {
  const [state, formAction, pending] = useActionState(retryPaymentAction, initialState);
  const router = useRouter();

  // Paid (or cancelled) meanwhile, e.g. in another tab, or a PayTR payment started there is being verified:
  // reload the order so the page shows the new state (the error text stays until then).
  useEffect(() => {
    if (state.code === "not_pending" || state.code === "verifying") router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="print:hidden">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} aria-disabled={pending} className={buttonClass("primary", "w-full rtl:tracking-normal")}>
        {pending ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
        ) : null}
        <span>{pending ? labels.pending : labels.button}</span>
        {!pending && <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />}
      </button>
      <p aria-live="polite" className={cn("text-sm leading-relaxed text-red-700 dark:text-red-400", state.error && "mt-3")}>
        {state.error ?? ""}
      </p>
    </form>
  );
}
