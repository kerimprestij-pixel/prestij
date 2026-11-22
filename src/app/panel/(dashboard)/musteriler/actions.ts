"use server";
// Müşteriler admin actions: change the group, ban / unban (sessions revoked), send a password reset,
// anonymize (self-service deletion rules). The list and detail are staff+ (read only); every mutation
// here requires the admin role. The data export is a route handler: /panel/api/musteriler/<id>/export.
import { headers } from "next/headers";
import { href, isLocaleCode } from "@/i18n/paths";
import { auth } from "@/lib/auth";
import { customerForPasswordReset } from "@/lib/b2b/customers";
import { runAnonymizeCustomer, runSetCustomerBanned, runSetCustomerGroup } from "@/lib/b2b/panel-definitions";
import { customerBanSchema, customerGroupSchema, customerIdSchema } from "@/lib/b2b/panel-schemas";
import { safeErrorInfo } from "@/lib/db-errors";
import { panelAction } from "@/lib/panel/action";
import { PanelError } from "@/lib/panel/errors";

export const setCustomerGroupAction = panelAction({ minRole: "admin", schema: customerGroupSchema, run: runSetCustomerGroup });

export const setCustomerBannedAction = panelAction({ minRole: "admin", schema: customerBanSchema, run: runSetCustomerBanned });

export const anonymizeCustomerAction = panelAction({ minRole: "admin", schema: customerIdSchema, run: runAnonymizeCustomer });

/**
 * Sends the customer Better Auth's password reset mail (the core `password_reset` template, in the
 * customer's language). Better Auth answers the same for every address and throttles the mail to one
 * per two minutes per user, so a repeated click inside that window sends nothing new.
 */
export const sendCustomerPasswordResetAction = panelAction({
  minRole: "admin",
  schema: customerIdSchema,
  run: async (input, { tx }) => {
    const customer = await customerForPasswordReset(tx, input.userId);
    const locale = isLocaleCode(customer.locale) ? customer.locale : "tr";
    try {
      await auth.api.requestPasswordReset({ body: { email: customer.email, redirectTo: href(locale, "resetPassword") }, headers: await headers() });
    } catch (error) {
      console.error("[b2b] password reset request failed", safeErrorInfo(error));
      throw new PanelError("server", "Şifre sıfırlama bağlantısı şu an gönderilemedi. Biraz sonra tekrar deneyin.");
    }
    return {
      message: "Şifre sıfırlama bağlantısı müşterinin e-posta adresine gönderiliyor (1 saat geçerli).",
      audit: { action: "status", entity: "user", entityId: customer.id, after: { resetLinkSent: true } },
    };
  },
});
