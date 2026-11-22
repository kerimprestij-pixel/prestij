// Team (staff accounts) rules without DB or Next imports: role parsing, the safety rules every team
// mutation must pass, the one-time password generator and the Turkish copy shared by the service and
// the /panel/ekip screens. Pure (Web Crypto only), so unit tests and client components can use it.
import { PanelError } from "@/lib/panel/errors";
import { STAFF_ROLE_ORDER, type StaffRole } from "@/lib/panel/roles";

export type { StaffRole };

/** Roles an admin can give on /panel/ekip, lowest to highest privilege. */
export const TEAM_ROLES: readonly StaffRole[] = STAFF_ROLE_ORDER;

/** What each role may do, in the words the client uses (shown in the role picker and the legend). */
export const TEAM_ROLE_INFO: Record<StaffRole, { label: string; summary: string }> = {
  staff: {
    label: "Personel",
    summary: "Siparişleri ve mesajları yönetir, stok günceller. Ürün ve içerik düzenleyemez.",
  },
  editor: {
    label: "Editör",
    summary: "Ürünleri, kategorileri, sayfaları, kampanyaları ve tüm içeriği düzenler. Ayarlara ve ekibe erişemez.",
  },
  admin: {
    label: "Yönetici",
    summary: "Her şeye erişir: ayarlar, ödeme bilgileri, yasal metinler, ekip ve işlem kaydı dahil.",
  },
};

/**
 * Highest staff role in a Better Auth role string ("editor", or comma-separated "customer,editor").
 * Mirrors staffRoleOf in src/lib/session.ts (server-only, so it cannot be imported here).
 */
export function parseStaffRole(role: string | null | undefined): StaffRole | null {
  if (!role) return null;
  const owned = role.split(",").map((r) => r.trim());
  for (let i = TEAM_ROLES.length - 1; i >= 0; i--) {
    if (owned.includes(TEAM_ROLES[i])) return TEAM_ROLES[i];
  }
  return null;
}

export const TEAM_MESSAGES = {
  notStaff: "Bu kullanıcı ekipte değil.",
  notFound: "Kullanıcı bulunamadı. Silinmiş olabilir; sayfayı yenileyin.",
  selfRole: "Kendi rolünüzü değiştiremezsiniz. Gerekirse başka bir yöneticiden isteyin.",
  selfBan: "Kendi hesabınızı devre dışı bırakamazsınız.",
  lastAdmin: "En az bir etkin yönetici kalmalı. Önce başka birini yönetici yapın.",
  emailTaken: "Bu e-posta adresiyle kayıtlı bir hesap zaten var.",
  sameRole: "Kullanıcının rolü zaten bu.",
  alreadyActive: "Bu hesap zaten etkin.",
  alreadyInactive: "Bu hesap zaten devre dışı.",
  banReason: "Panel erişimi bir yönetici tarafından kapatıldı.",
} as const;

/** The parts of a user row the safety rules look at. */
export type TeamTarget = { id: string; role: StaffRole | null; banned: boolean };

export type TeamChange = { kind: "role"; role: StaffRole } | { kind: "active"; active: boolean } | { kind: "password" };

/**
 * Throws a PanelError when `actorId` may not apply `change` to `target`.
 * - Only staff accounts are managed here (customers are not team members).
 * - Admins never demote or deactivate themselves (a password reset of the own account is allowed).
 * - At least one active admin remains: `otherActiveAdmins` counts active admins other than the target.
 */
export function assertTeamChangeAllowed(input: {
  actorId: string;
  target: TeamTarget;
  change: TeamChange;
  otherActiveAdmins: number;
}): void {
  const { actorId, target, change, otherActiveAdmins } = input;
  if (!target.role) throw new PanelError("not_found", TEAM_MESSAGES.notStaff);
  const self = target.id === actorId;
  const activeAdmin = target.role === "admin" && !target.banned;

  if (change.kind === "role") {
    if (self) throw new PanelError("forbidden", TEAM_MESSAGES.selfRole);
    if (change.role === target.role) throw new PanelError("invalid", TEAM_MESSAGES.sameRole);
    if (activeAdmin && change.role !== "admin" && otherActiveAdmins < 1) throw new PanelError("invalid", TEAM_MESSAGES.lastAdmin);
    return;
  }
  if (change.kind === "active") {
    if (self && !change.active) throw new PanelError("forbidden", TEAM_MESSAGES.selfBan);
    if (change.active && !target.banned) throw new PanelError("invalid", TEAM_MESSAGES.alreadyActive);
    if (!change.active && target.banned) throw new PanelError("invalid", TEAM_MESSAGES.alreadyInactive);
    if (!change.active && activeAdmin && otherActiveAdmins < 1) throw new PanelError("invalid", TEAM_MESSAGES.lastAdmin);
  }
}

// ---------------------------------------------------------------------------------------------------
// One-time passwords

/** No 0/O, 1/l/I: easy to read aloud and type from a screen. 54 symbols ≈ 5.75 bits each. */
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const PASSWORD_GROUPS = 4;
const PASSWORD_GROUP_LENGTH = 5;

/**
 * Strong random password in four groups of five, e.g. "hT7kq-Xm2Rw-9bNzp-Ka4tE" (≈ 115 bits). Uses
 * rejection sampling, so every symbol is equally likely. Shown once to the admin, never stored or logged.
 */
export function generateStaffPassword(): string {
  const n = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n); // bytes ≥ limit would bias the modulo
  const chars: string[] = [];
  const total = PASSWORD_GROUPS * PASSWORD_GROUP_LENGTH;
  while (chars.length < total) {
    const bytes = new Uint8Array(total * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      chars.push(PASSWORD_ALPHABET[b % n]);
      if (chars.length === total) break;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < total; i += PASSWORD_GROUP_LENGTH) groups.push(chars.slice(i, i + PASSWORD_GROUP_LENGTH).join(""));
  return groups.join("-");
}

/** Shape check used by tests and the UI (four groups of five from the alphabet above). */
export const STAFF_PASSWORD_PATTERN = /^[A-HJKMNP-Za-hjkmnp-z2-9]{5}(?:-[A-HJKMNP-Za-hjkmnp-z2-9]{5}){3}$/;

/** /panel/ekip header text (shared by the page skeleton and the loaded page, so nothing shifts). */
export const TEAM_PAGE_DESCRIPTION =
  "Panele kimlerin girebileceğini ve neleri değiştirebileceğini yönetin. Her işlem, İşlem Kaydı’na yazılır.";
