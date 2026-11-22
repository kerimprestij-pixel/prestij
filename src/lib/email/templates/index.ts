// Every e-mail template, registered by importing its file. SHARED FILE: each builder adds exactly one
// import line for its own area file (src/lib/email/templates/<area>.ts) with the Edit tool.
//
// A template file:
//   import { defineEmailTemplate } from "../registry";
//   export type OrderEmailData = { name: string; orderNumber: string; … };
//   declare module "../types" { interface EmailTemplateRegistry { order_paid: OrderEmailData } }
//   export const orderPaidEmail = defineEmailTemplate({ key: "order_paid", audience: "customer", label: "…",
//     placeholders: ["name", "orderNumber"], sample: () => ({ … }), build: (data, ctx) => ({ subject, blocks }) });
import "./account";
import "./requests"; // REQUESTS: quote_received(_admin), quote_offer, sample_received(_admin), sample_approved/_shipped/_rejected, contact_message
import "./business"; // B2B: business_application_received, business_application_admin, business_approved, business_rejected
import "./accounts"; // ACCOUNTS: welcome, password_changed
import "./orders"; // NOTIFY: order e-mails + admin_new_order
import "./newsletter"; // NOTIFY: newsletter_confirm, newsletter_campaign
import "./subscriptions"; // SUBSCRIPTIONS: subscription_started, _reminder, _payment_due, _renewal_failed, _changed
import "./reviews"; // REVIEWS: review_request
import "./wheel"; // WHEEL-SERVER: wheel_prize, wheel_prize_reminder
