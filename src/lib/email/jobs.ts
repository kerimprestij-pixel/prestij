// emails.flush (frequent): sends whatever after() did not (retries after backoff, mails queued by
// scripts and jobs, rows left behind by a crashed instance). Loaded by src/lib/cron/jobs.ts.
import "server-only";
import { registerJob } from "@/lib/cron/registry";
import { flushEmailQueue } from "./queue";

/** Rows per job run; the next run continues. */
const JOB_BATCH = 50;
const JOB_ROUNDS = 4;

export const emailsFlushJob = registerJob({
  key: "emails.flush",
  group: "frequent",
  label: "Bekleyen e-postaları gönder",
  run: async () => {
    const total = { claimed: 0, sent: 0, retried: 0, failed: 0, notConfigured: 0 };
    for (let round = 0; round < JOB_ROUNDS; round++) {
      const r = await flushEmailQueue({ limit: JOB_BATCH });
      total.claimed += r.claimed;
      total.sent += r.sent;
      total.retried += r.retried;
      total.failed += r.failed;
      total.notConfigured = Math.max(total.notConfigured, r.notConfigured);
      if (r.notConfigured || r.claimed < JOB_BATCH) break;
    }
    return total;
  },
});
