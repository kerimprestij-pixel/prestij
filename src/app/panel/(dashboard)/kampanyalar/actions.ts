"use server";
// Campaign Server Actions (editor+). Business rules live in src/lib/panel/marketing/campaigns.ts.
import { panelAction, requirePanelActor } from "@/lib/panel/action";
import { createCampaign, deleteCampaign, previewCampaign, setCampaignActive, updateCampaign, type CampaignPreview } from "@/lib/panel/marketing/campaigns";
import { campaignCreateSchema, campaignPreviewSchema, campaignUpdateSchema, recordRefSchema, toggleActiveSchema } from "@/lib/panel/marketing/schemas";
import { db } from "@/db";
import { isPanelError } from "@/lib/panel/errors";
import { safeErrorInfo } from "@/lib/db-errors";

export const createCampaignAction = panelAction({
  minRole: "editor",
  schema: campaignCreateSchema,
  run: async (input, { tx }) => {
    const { id, updatedAt, tags, audit } = await createCampaign(tx, input);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: "Kampanya oluşturuldu.", tags, audit };
  },
});

export const saveCampaignAction = panelAction({
  minRole: "editor",
  schema: campaignUpdateSchema,
  run: async (input, { tx }) => {
    const { id, updatedAt, tags, audit } = await updateCampaign(tx, input);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: "Kampanya kaydedildi.", tags, audit };
  },
});

export const setCampaignActiveAction = panelAction({
  minRole: "editor",
  schema: toggleActiveSchema,
  run: async (input, { tx }) => {
    const { id, updatedAt, tags, audit } = await setCampaignActive(tx, input);
    return {
      data: { id, updatedAt: updatedAt.toISOString() },
      message: input.isActive ? "Kampanya etkinleştirildi." : "Kampanya durduruldu.",
      tags,
      audit,
    };
  },
});

export const deleteCampaignAction = panelAction({
  minRole: "editor",
  schema: recordRefSchema,
  run: async (input, { tx }) => {
    const { tags, audit } = await deleteCampaign(tx, input);
    return { message: "Kampanya silindi.", tags, audit };
  },
});

export type CampaignPreviewResult = { ok: true; preview: CampaignPreview } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Affected variants with regular → campaign price for the editor's unsaved state (read only). */
export async function previewCampaignAction(raw: unknown): Promise<CampaignPreviewResult> {
  try {
    await requirePanelActor("editor"); // no session → redirect (rethrown below)
  } catch (error) {
    if (isPanelError(error)) return { ok: false, error: error.message };
    throw error;
  }
  const parsed = campaignPreviewSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Önizleme için alanları düzeltin.", fieldErrors };
  }
  try {
    return { ok: true, preview: await previewCampaign(db, parsed.data) };
  } catch (error) {
    if (isPanelError(error)) return { ok: false, error: error.message };
    console.error("[panel] campaign preview failed", safeErrorInfo(error));
    return { ok: false, error: "Önizleme şu an hazırlanamadı. Biraz sonra tekrar deneyin." };
  }
}
