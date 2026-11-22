// newsletter.send (frequent): starts due scheduled campaigns and queues campaign mails in batches of
// 200 (bounded per run; the next run continues). Idempotent: dedupe keys + SKIP LOCKED campaign rows.
// The queued mails go out through emails.flush / after(). Loaded by src/lib/cron/jobs.ts.
import "server-only";
import { registerJob } from "@/lib/cron/registry";
import { processCampaigns } from "./campaigns";

/** Batches (of 200) per run: at most 2 000 mails queued per run. */
const JOB_MAX_BATCHES = 10;

export const newsletterSendJob = registerJob({
  key: "newsletter.send",
  group: "frequent",
  label: "E-bülten kampanyalarını gönder",
  run: async () => {
    const { started, batches, queued, completed } = await processCampaigns({ maxBatches: JOB_MAX_BATCHES });
    return { started, batches, queued, completed };
  },
});
