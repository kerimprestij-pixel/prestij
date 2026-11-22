"use server";
// /panel/ekip Server Actions (admin only). Each one re-checks the session and role (panelAction), then
// acts through the Better Auth admin plugin with the admin's own request headers. Team data is never
// cached, so no tags: panelAction refreshes the page instead. Generated passwords travel back once in
// the action result and are never stored or audited.
import { headers } from "next/headers";
import { z } from "zod";
import { panelAction } from "@/lib/panel/action";
import { textInput, updatedAtInput } from "@/lib/panel/schemas";
import { betterAuthTeamGateway } from "@/lib/panel/team/gateway";
import { TEAM_ROLES } from "@/lib/panel/team/rules";
import {
  changeStaffRole,
  createStaffMember,
  resetStaffPassword,
  setStaffActive,
} from "@/lib/panel/team/service";
import type { StaffRole } from "@/lib/panel/roles";

const roleInput = z.enum(TEAM_ROLES as [StaffRole, ...StaffRole[]], { error: "Bir rol seçin." });
const userIdInput = z.string({ error: "Kullanıcı seçilmedi." }).trim().min(1, "Kullanıcı seçilmedi.").max(100);
const emailInput = z
  .string({ error: "E-posta adresi girin." })
  .trim()
  .toLowerCase()
  .min(1, "E-posta adresi girin.")
  .max(254, "E-posta adresi çok uzun.")
  .pipe(z.email({ error: "Geçerli bir e-posta adresi girin." }));

async function gateway() {
  return betterAuthTeamGateway(await headers());
}

export const createStaffAction = panelAction({
  minRole: "admin",
  schema: z.object({
    name: textInput({ max: 80, requiredMessage: "Ad soyad girin." }),
    email: emailInput,
    role: roleInput,
  }),
  run: async (input, { actor, tx }) => {
    const { member, password, audit } = await createStaffMember(tx, input, actor, await gateway());
    return { data: { member, password }, message: `${member.name} ekibe eklendi.`, audit };
  },
});

export const changeStaffRoleAction = panelAction({
  minRole: "admin",
  schema: z.object({ userId: userIdInput, role: roleInput, updatedAt: updatedAtInput }),
  run: async (input, { actor, tx }) => {
    const { member, audit } = await changeStaffRole(tx, input, actor, await gateway());
    return { data: { member }, message: `${member.name} artık ${roleLabel(member.role)}.`, audit };
  },
});

export const setStaffActiveAction = panelAction({
  minRole: "admin",
  schema: z.object({ userId: userIdInput, active: z.boolean({ error: "Durum seçilmedi." }), updatedAt: updatedAtInput }),
  run: async (input, { actor, tx }) => {
    const { member, audit } = await setStaffActive(tx, input, actor, await gateway());
    return {
      data: { member },
      message: member.active
        ? `${member.name} yeniden etkinleştirildi.`
        : `${member.name} devre dışı bırakıldı; tüm oturumları kapatıldı.`,
      audit,
    };
  },
});

export const resetStaffPasswordAction = panelAction({
  minRole: "admin",
  schema: z.object({ userId: userIdInput }),
  run: async (input, { actor, tx }) => {
    const { member, password, audit } = await resetStaffPassword(tx, input, actor, await gateway());
    return { data: { member, password }, message: "Yeni şifre oluşturuldu.", audit };
  },
});

function roleLabel(role: StaffRole): string {
  return { staff: "personel", editor: "editör", admin: "yönetici" }[role];
}
