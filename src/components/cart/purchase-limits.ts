// Per-variant quantity limits for the product page's add-to-cart stepper. Pure; computed on the
// server from the (cached, static) catalog. The cart action clamps again with live stock, so these
// only shape the stepper: a stale value can never oversell.
import { stockStatus } from "@/components/store/format";
import { DEFAULT_MAX_QUANTITY } from "@/lib/cart/types";

export type PurchaseLimit = { id: number; min: number; max: number; soldOut: boolean };

type VariantLike = {
  id: number;
  stock: number;
  trackStock: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number;
  minQuantity: number;
  maxQuantity: number | null;
};

export function purchaseLimits(variants: VariantLike[]): PurchaseLimit[] {
  return variants.map((v) => {
    const min = Math.max(1, Math.floor(v.minQuantity || 1));
    const limit = Math.max(min, Math.floor(v.maxQuantity ?? DEFAULT_MAX_QUANTITY));
    const stockCap = v.trackStock && !v.allowBackorder ? Math.max(0, Math.floor(v.stock)) : Number.POSITIVE_INFINITY;
    const soldOut = stockStatus(v) === "out" || stockCap < min;
    return { id: v.id, min, max: soldOut ? min : Math.min(limit, stockCap), soldOut };
  });
}
