"use server";
// E-mail log actions (staff): resend a copy, cancel a queued mail. The log is never cached (no tags;
// panelAction refreshes the page). Recipients never reach the audit log.
import { z } from "zod";
import { panelAction } from "@/lib/panel/action";
import { cancelEmailMessage, resendEmailMessage } from "@/lib/panel/emails/service";
import { idInput } from "@/lib/panel/schemas";

const refSchema = z.object({ id: idInput });

export const resendEmailAction = panelAction({
  minRole: "staff",
  schema: refSchema,
  run: async (input, { tx, actor }) => {
    const { id, audit } = await resendEmailMessage(tx, input.id, actor.user.id);
    return { data: { id }, message: "E-postanın bir kopyası kuyruğa alındı; birkaç saniye içinde gönderilir.", audit };
  },
});

export const cancelEmailAction = panelAction({
  minRole: "staff",
  schema: refSchema,
  run: async (input, { tx }) => {
    const { audit } = await cancelEmailMessage(tx, input.id);
    return { message: "E-posta iptal edildi; gönderilmeyecek.", audit };
  },
});
