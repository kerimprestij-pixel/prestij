"use server";
// One save per settings key (admin only, locked by settings.updatedAt, tag `settings`).
// Payload: the settings fields at the top level plus `updatedAt` (see settingsPayloadSchema).
import { panelAction } from "@/lib/panel/action";
import { settingsActionOptions } from "@/lib/panel/settings/service";

export const saveGeneralSettingsAction = panelAction(settingsActionOptions("general"));
export const saveShippingSettingsAction = panelAction(settingsActionOptions("shipping"));
export const savePaymentSettingsAction = panelAction(settingsActionOptions("payments"));
export const saveSeoSettingsAction = panelAction(settingsActionOptions("seo"));
export const saveLocaleSettingsAction = panelAction(settingsActionOptions("locales"));
export const saveB2bSettingsAction = panelAction(settingsActionOptions("b2b"));
export const saveSampleSettingsAction = panelAction(settingsActionOptions("samples"));
export const saveNewsletterSettingsAction = panelAction(settingsActionOptions("newsletter"));
export const saveWhatsappSettingsAction = panelAction(settingsActionOptions("whatsapp"));
export const saveReviewSettingsAction = panelAction(settingsActionOptions("reviews"));
export const saveSubscriptionSettingsAction = panelAction(settingsActionOptions("subscriptions"));
// emails: saved by ./e-posta/actions.ts (sender fields and per-template texts are separate saves).
