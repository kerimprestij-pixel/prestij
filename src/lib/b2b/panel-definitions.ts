// The run functions of the B2B panel actions (schemas in panel-schemas.ts). Kept out of the "use server"
// files so DB tests can run them through executePanelAction with a fake actor. Companies and groups are
// never cached on the storefront (pricing reads them fresh), so no tags: panelAction calls refresh().
import "server-only";
import type { PanelActionContext, PanelRunResult } from "@/lib/panel/action-core";
import { PanelError } from "@/lib/panel/errors";
import type { z } from "zod";
import { BUSINESS_FIELD_ERRORS_TR, companyFieldsSchema, toBusinessFieldErrors } from "./application";
import { anonymizeCustomer, setCustomerBanned, setCustomerGroup } from "./customers";
import type {
  companyTermsSchema,
  createGroupSchema,
  customerBanSchema,
  customerGroupSchema,
  customerIdSchema,
  deleteGroupSchema,
  rejectCompanySchema,
  updateCompanySchema,
  updateGroupSchema,
} from "./panel-schemas";
import { approveCompany, createGroup, deleteGroup, rejectCompany, updateCompany, updateCompanyTerms, updateGroup } from "./service";

type Run<S extends z.ZodType, T = undefined> = (input: z.output<S>, ctx: PanelActionContext) => Promise<PanelRunResult<T>>;

export const runApproveCompany: Run<typeof companyTermsSchema> = async (input, { tx, actor }) => {
  const { audit, notified } = await approveCompany(tx, input, actor);
  return {
    audit,
    message: notified ? "Başvuru onaylandı; müşteriye onay e-postası gönderiliyor." : "Başvuru onaylandı.",
  };
};

export const runUpdateCompanyTerms: Run<typeof companyTermsSchema> = async (input, { tx }) => {
  const { audit } = await updateCompanyTerms(tx, input);
  return { audit: audit ?? undefined, message: audit ? "Grup ve ödeme koşulları güncellendi." : "Değişiklik yok." };
};

export const runRejectCompany: Run<typeof rejectCompanySchema> = async (input, { tx, actor }) => {
  const { audit, notified } = await rejectCompany(tx, input, actor);
  return { audit, message: notified ? "Başvuru reddedildi; gerekçe müşteriye e-postayla gönderiliyor." : "Başvuru reddedildi." };
};

export const runUpdateCompany: Run<typeof updateCompanySchema, { updatedAt: string }> = async (input, { tx }) => {
  const parsed = companyFieldsSchema.safeParse(input.fields);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const [path, code] of Object.entries(toBusinessFieldErrors(parsed.error.issues))) fieldErrors[`fields.${path}`] = BUSINESS_FIELD_ERRORS_TR[code];
    throw new PanelError("invalid", "Bazı alanlar hatalı. İşaretli alanları düzeltin.", fieldErrors);
  }
  const { updatedAt, audit } = await updateCompany(tx, { id: input.id, fields: parsed.data, adminNote: input.adminNote, updatedAt: input.updatedAt });
  return { data: { updatedAt: updatedAt.toISOString() }, audit: audit ?? undefined, message: audit ? "Firma bilgileri kaydedildi." : "Değişiklik yok." };
};

export const runCreateGroup: Run<typeof createGroupSchema, { id: number }> = async (input, { tx }) => {
  const { id, audit } = await createGroup(tx, input);
  return { data: { id }, audit, message: "Müşteri grubu oluşturuldu." };
};

export const runUpdateGroup: Run<typeof updateGroupSchema, { updatedAt: string }> = async (input, { tx }) => {
  const { updatedAt, audit } = await updateGroup(tx, input);
  return { data: { updatedAt: updatedAt.toISOString() }, audit: audit ?? undefined, message: audit ? "Müşteri grubu kaydedildi." : "Değişiklik yok." };
};

export const runDeleteGroup: Run<typeof deleteGroupSchema> = async (input, { tx }) => {
  const { audit } = await deleteGroup(tx, input);
  return { audit, message: "Müşteri grubu silindi." };
};

export const runSetCustomerGroup: Run<typeof customerGroupSchema> = async (input, { tx }) => {
  const { audit } = await setCustomerGroup(tx, input);
  return { audit: audit ?? undefined, message: audit ? "Müşteri grubu değiştirildi." : "Değişiklik yok." };
};

export const runSetCustomerBanned: Run<typeof customerBanSchema> = async (input, { tx }) => {
  const { audit, revokedSessions } = await setCustomerBanned(tx, input);
  if (!audit) return { message: "Değişiklik yok." };
  return {
    audit,
    message: input.banned
      ? `Müşterinin erişimi kapatıldı${revokedSessions ? `; ${revokedSessions} açık oturum sonlandırıldı` : ""}.`
      : "Müşterinin erişimi yeniden açıldı.",
  };
};

export const runAnonymizeCustomer: Run<typeof customerIdSchema, { keptOrders: number }> = async (input, { tx, actor }) => {
  const result = await anonymizeCustomer(tx, input, actor);
  return {
    data: { keptOrders: result.keptOrders },
    audit: result.audit,
    message: `Hesap anonimleştirildi. ${result.keptOrders} sipariş yasal saklama süresi boyunca korunuyor.`,
  };
};
