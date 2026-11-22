import "server-only";
import { cookies } from "next/headers";
import { isUuid } from "./load";

/** httpOnly cookie holding the cart UUID (the cart's only credential: never expose it to client JS). */
export const CART_COOKIE = "prestij_cart";
export const CART_TTL_DAYS = 30;
const MAX_AGE = CART_TTL_DAYS * 24 * 60 * 60;

/**
 * The cart id from the cookie, or null (missing or malformed). Reads request cookies: Server Actions,
 * Route Handlers or components inside `<Suspense>` only.
 */
export async function readCartId(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return isUuid(value) ? value : null;
}

/** Sets/refreshes the cookie (30 days). Server Actions and Route Handlers only. */
export async function writeCartId(id: string): Promise<void> {
  (await cookies()).set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/** Removes the cookie (after an order is placed). Server Actions and Route Handlers only. */
export async function clearCartId(): Promise<void> {
  (await cookies()).delete({ name: CART_COOKIE, path: "/" });
}
