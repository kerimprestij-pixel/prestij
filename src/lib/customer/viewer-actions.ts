"use server";
// Viewer state for the storefront's client islands (header greeting, favorite hearts, business
// badges). Called by <ViewerProvider> once after hydration; returns only the caller's own data.

import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCustomerContext } from "@/lib/customer/context";
import { safeErrorInfo } from "@/lib/db-errors";
import { getSession } from "@/lib/session";
import { MAX_VIEWER_FAVORITES, SIGNED_OUT_VIEWER, firstNameOf, type ViewerState } from "./viewer";

export type { ViewerState };

export async function loadViewer(): Promise<ViewerState> {
  try {
    const session = await getSession();
    const userId = session?.user?.id;
    if (!userId || session.user.banned) return { ...SIGNED_OUT_VIEWER };

    const [user] = await db
      .select({ name: schema.user.name, companyId: schema.user.companyId, banned: schema.user.banned })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!user || user.banned) return { ...SIGNED_OUT_VIEWER };

    const [customer, company, favorites] = await Promise.all([
      getCustomerContext(),
      user.companyId != null
        ? db
            .select({ status: schema.companies.status })
            .from(schema.companies)
            .where(eq(schema.companies.id, user.companyId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      db
        .select({ productId: schema.favorites.productId })
        .from(schema.favorites)
        .where(eq(schema.favorites.userId, userId))
        .orderBy(desc(schema.favorites.createdAt))
        .limit(MAX_VIEWER_FAVORITES),
    ]);

    return {
      signedIn: true,
      firstName: firstNameOf(user.name),
      isBusiness: customer.isBusiness,
      companyStatus: company?.status ?? null,
      favoriteProductIds: favorites.map((f) => f.productId),
    };
  } catch (error) {
    // A broken viewer must never break the page: the islands fall back to the signed-out state.
    console.error("[viewer] load failed", safeErrorInfo(error));
    return { ...SIGNED_OUT_VIEWER };
  }
}
