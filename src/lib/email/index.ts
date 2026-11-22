// Public entry of the e-mail system (server only). Importing it registers every template.
//
//   await db.transaction(async (tx) => {
//     /* business change */
//     await enqueueEmail(tx, { template: "order_paid", to: order.email, locale: order.locale, data, related: { type: "order", id: order.id }, dedupeKey: `order:${order.id}:paid:customer` });
//   });
//   // in a request: the mail goes out right after the response (after()); in a script: await flushEmailQueue();
import "server-only";
import "./templates";

export {
  EMAIL_BACKOFF_MINUTES,
  EMAIL_FLUSH_LIMIT,
  EMAIL_MAX_ATTEMPTS,
  cancelQueuedEmail,
  enqueueEmail,
  flushEmailQueue,
  requeueEmail,
  scheduleEmailFlush,
  type EnqueueEmailInput,
  type EnqueuedEmail,
  type FlushEmailOptions,
  type FlushEmailResult,
} from "./queue";
export { adminRecipients, emailTemplateDefaults, renderEmailPreview, sendTestEmail, type EmailPreview, type TestEmailResult } from "./preview";
export { defineEmailTemplate, getEmailTemplate, listEmailTemplates, type EmailTemplateInfo } from "./registry";
export { emailDriverStatus, isEmailAddress, type EmailDriver, type EmailDriverStatus, type OutgoingEmail } from "./drivers";
export { findPlaceholders, unknownPlaceholders } from "./escape";
export { loadEmailEnvironment, loadEmailSettings } from "./environment";
export {
  newsletterUnsubscribeLinks,
  newsletterUnsubscribeToken,
  readNewsletterUnsubscribeToken,
  NEWSLETTER_UNSUBSCRIBE_PURPOSE,
  ONE_CLICK_UNSUBSCRIBE_PATH,
  type UnsubscribeLinks,
} from "./unsubscribe";
export { GLOBAL_PLACEHOLDERS, EMAIL_RELATED_TYPES, EMAIL_STATUSES } from "./types";
export type {
  EmailAudience,
  EmailBlock,
  EmailBuildContext,
  EmailContent,
  EmailDataFor,
  EmailRelatedType,
  EmailStatus,
  EmailTemplate,
  EmailTemplateDefinition,
  EmailTextOverrides,
  RenderedEmail,
  TemplateKey,
} from "./types";
