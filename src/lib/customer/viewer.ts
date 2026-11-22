// The signed-in visitor as the storefront's client islands see it (pure, client-safe). Loaded once
// per page load by <ViewerProvider> through the loadViewer() Server Action, so static pages never read
// the session on the server.

/** Mirrors CompanyStatus in src/db/schema/commerce.ts (kept here so client code does not import drizzle). */
export type ViewerCompanyStatus = "pending" | "approved" | "rejected";

export type ViewerState = {
  signedIn: boolean;
  /** For the header greeting; null when signed out. */
  firstName: string | null;
  /** The pricing context is a business group (approved company, or a business group set by staff). */
  isBusiness: boolean;
  /** The user's company application, if any. */
  companyStatus: ViewerCompanyStatus | null;
  /** Products in the user's favorites (newest first, at most MAX_VIEWER_FAVORITES). */
  favoriteProductIds: number[];
};

export const MAX_VIEWER_FAVORITES = 500;

export const SIGNED_OUT_VIEWER: ViewerState = Object.freeze({
  signedIn: false,
  firstName: null,
  isBusiness: false,
  companyStatus: null,
  favoriteProductIds: [],
}) as ViewerState;

/** "Ayşe Nur Yılmaz" → "Ayşe" (the greeting uses the first given name). */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first.slice(0, 60) : null;
}
