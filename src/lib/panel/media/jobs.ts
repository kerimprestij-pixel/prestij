// Day 6: daily sweep of direct-upload staging objects ("_incoming/…") whose completion never arrived
// (tab closed mid-upload, network gone). A ticket lives two hours; anything older than a day is safe to
// delete. Bounded per run (the next run continues).
import "server-only";
import { registerJob } from "@/lib/cron/registry";
import { getUploadStorage, INCOMING_PREFIX, type StorageAdapter } from "@/lib/media/storage";
import { MEDIA_UPLOAD } from "./types";

const BATCH = 200;

/** Deletes staging objects older than MEDIA_UPLOAD.direct.incomingMaxAgeHours; returns counts. */
export async function pruneIncomingUploads(
  storage: StorageAdapter = getUploadStorage(),
  now: Date = new Date(),
): Promise<{ deleted: number; failed: number }> {
  if (!storage.listStale) return { deleted: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - MEDIA_UPLOAD.direct.incomingMaxAgeHours * 3600_000);
  const keys = await storage.listStale(INCOMING_PREFIX, cutoff, BATCH);
  let deleted = 0;
  let failed = 0;
  for (const key of keys) {
    if (!key.startsWith(INCOMING_PREFIX)) continue; // never anything outside the staging area
    try {
      await storage.delete(key);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

export const mediaIncomingPruneJob = registerJob({
  key: "media.prune-incoming",
  group: "daily",
  label: "Yarım kalan medya yüklemelerini temizle",
  run: async () => pruneIncomingUploads(),
});
