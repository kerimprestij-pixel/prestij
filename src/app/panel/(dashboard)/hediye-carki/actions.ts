"use server";
// Hediye Çarkı Server Actions (marketing: editor and up, contract §1.1). The settings document is the
// generic settings save with the role lowered from admin to editor; tags settings + wheel.
import { panelAction } from "@/lib/panel/action";
import { startWheelRoundDef } from "@/lib/panel/gift-wheel/action-defs";
import { settingsActionOptions } from "@/lib/panel/settings/service";

export const saveGiftWheelAction = panelAction({ ...settingsActionOptions("giftWheel"), minRole: "editor" });

export const startWheelRoundAction = panelAction({ minRole: "editor", ...startWheelRoundDef });
