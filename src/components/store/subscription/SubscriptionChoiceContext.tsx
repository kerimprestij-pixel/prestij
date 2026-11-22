"use client";

// Shares the product page's "Tek seferlik / Abone ol" choice with the add-to-cart button. In memory
// only (the page stays static). Outside the provider the plan is `undefined`: the button then sends no
// subscription choice and the cart keeps whatever the line had.
import { createContext, useContext, useState, type ReactNode } from "react";

type SubscriptionChoice = {
  /** A plan id (subscribe), null (one-time purchase) or undefined (no choice on this page). */
  planId: number | null | undefined;
  setPlanId: (planId: number | null) => void;
};

const SubscriptionChoiceContext = createContext<SubscriptionChoice>({ planId: undefined, setPlanId: () => {} });

export function SubscriptionChoiceProvider({ children }: { children: ReactNode }) {
  const [planId, setPlanId] = useState<number | null>(null);
  return <SubscriptionChoiceContext value={{ planId, setPlanId }}>{children}</SubscriptionChoiceContext>;
}

export function useSubscriptionChoice(): SubscriptionChoice {
  return useContext(SubscriptionChoiceContext);
}
