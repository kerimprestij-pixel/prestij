"use server";
// Newsletter subscriber actions (editor+). The list is never cached, so no tags (panelAction then
// refreshes the page). E-mail addresses never reach the audit log.
import { panelAction } from "@/lib/panel/action";
import { deleteSubscriber, unsubscribeSubscriber } from "@/lib/panel/marketing/newsletter";
import { subscriberRefSchema } from "@/lib/panel/marketing/schemas";

export const unsubscribeSubscriberAction = panelAction({
  minRole: "editor",
  schema: subscriberRefSchema,
  run: async (input, { tx }) => {
    const { changed, audit } = await unsubscribeSubscriber(tx, input.id);
    return { message: changed ? "Abonelik sonlandırıldı; bu adrese artık bülten gönderilmez." : "Bu adresin aboneliği zaten sonlanmış.", audit };
  },
});

export const deleteSubscriberAction = panelAction({
  minRole: "editor",
  schema: subscriberRefSchema,
  run: async (input, { tx }) => {
    const { audit } = await deleteSubscriber(tx, input.id);
    return { message: "Abone kalıcı olarak silindi (KVKK).", audit };
  },
});
