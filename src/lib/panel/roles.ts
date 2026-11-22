// Staff role ranking without server imports (src/lib/session.ts is server-only), so nav filtering and
// client components can use it. The server still re-checks the role in every action and route handler.
import type { StaffRole } from "@/lib/session";

export type { StaffRole };

/** Lowest to highest privilege; mirrors STAFF_ROLES in src/lib/session.ts. */
export const STAFF_ROLE_ORDER: readonly StaffRole[] = ["staff", "editor", "admin"];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  staff: "Personel",
  editor: "Editör",
  admin: "Yönetici",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLE_ORDER as readonly string[]).includes(value);
}

/** True when `role` is at least `minRole` (null = not staff = never). */
export function hasRole(role: StaffRole | null | undefined, minRole: StaffRole): boolean {
  if (!role) return false;
  return STAFF_ROLE_ORDER.indexOf(role) >= STAFF_ROLE_ORDER.indexOf(minRole);
}
