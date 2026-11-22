// Scheduled jobs of the gift wheel (both daily; see src/lib/cron/registry.ts). Loaded by src/lib/cron/jobs.ts.
import "server-only";
import { db } from "@/db";
import { registerJob } from "@/lib/cron/registry";
import { purgeWheelSpins, queueWheelReminders } from "./maintenance";

/** "Your prize expires soon" mails (confirmed newsletter subscribers only), once per prize. */
export const wheelRemindJob = registerJob({
  key: "wheel.remind",
  group: "daily",
  label: "Çark hediyesi hatırlatma e-postaları",
  run: async () => queueWheelReminders(db, { now: new Date() }),
});

/** Expires over-hold spins, deletes unclaimed spins older than 30 days, drops old IP hashes (KVKK). */
export const wheelPurgeJob = registerJob({
  key: "wheel.purge",
  group: "daily",
  label: "Hediye çarkı kayıt temizliği",
  run: async () => purgeWheelSpins(db, { now: new Date() }),
});
