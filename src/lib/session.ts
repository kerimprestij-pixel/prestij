import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type AuthSession } from "@/lib/auth";

/** Roles allowed into /panel, lowest to highest privilege. */
export const STAFF_ROLES = ["staff", "editor", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PANEL_LOGIN_PATH = "/panel/giris";

export type StaffSession = AuthSession & { staffRole: StaffRole };

/**
 * Current Better Auth session (or null). Reads request headers, so call it only inside a
 * `<Suspense>` subtree, a dynamic page, a Server Action or a Route Handler.
 * Deduplicated per request.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/** Highest staff role in a (possibly comma-separated) admin-plugin role string. */
export function staffRoleOf(role: string | null | undefined): StaffRole | null {
  if (!role) return null;
  const owned = role.split(",").map((r) => r.trim());
  for (let i = STAFF_ROLES.length - 1; i >= 0; i--) {
    if (owned.includes(STAFF_ROLES[i])) return STAFF_ROLES[i];
  }
  return null;
}

function rank(role: StaffRole): number {
  return STAFF_ROLES.indexOf(role);
}

/**
 * Ensures the request belongs to panel staff (admin | editor | staff) with at least `minRole`.
 * No session or not staff → /panel/giris. Staff below `minRole` → /panel?yetki=yetersiz.
 */
export async function requireStaff(minRole: StaffRole = "staff"): Promise<StaffSession> {
  const session = await getSession();
  if (!session) redirect(PANEL_LOGIN_PATH);
  const staffRole = staffRoleOf(session.user.role);
  if (!staffRole || session.user.banned) redirect(`${PANEL_LOGIN_PATH}?hata=yetki`);
  if (rank(staffRole) < rank(minRole)) redirect("/panel?yetki=yetersiz");
  return { ...session, staffRole };
}

export function requireAdmin(): Promise<StaffSession> {
  return requireStaff("admin");
}
