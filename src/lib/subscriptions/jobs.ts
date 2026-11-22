// Scheduled jobs of subscribe and save (both daily; see src/lib/cron/registry.ts).
import "server-only";
import { registerJob } from "@/lib/cron/registry";
import { renewDueSubscriptions, sendDueReminders } from "./renew";

/** Reminder e-mails `reminderDaysBefore` days before each renewal (skip + manage links). Idempotent. */
export const subscriptionsRemindJob = registerJob({
  key: "subscriptions.remind",
  group: "daily",
  label: "Abonelik hatırlatma e-postaları",
  run: async () => sendDueReminders({ now: new Date() }),
});

/** Renewal orders for due subscriptions (one per period; skip, stock and payment rules). */
export const subscriptionsRenewJob = registerJob({
  key: "subscriptions.renew",
  group: "daily",
  label: "Abonelik yenileme siparişleri",
  run: async () => renewDueSubscriptions({ now: new Date() }),
});
