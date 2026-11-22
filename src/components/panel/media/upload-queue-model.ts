// The panel upload queue's item shape and its pure rules (shared by useUploadQueue and the progress list;
// no network code here, so the list renders in unit tests).
import type { MediaKind } from "@/lib/media/types";
import type { UploadPhase } from "./upload-client";

export type QueueItem = {
  key: string;
  name: string;
  size: number;
  /** Known after the pre-check (null for a refused file). */
  kind: MediaKind | null;
  status: "waiting" | "uploading" | "done" | "error" | "cancelled";
  /** What an uploading file is doing right now. */
  phase: UploadPhase | null;
  progress: number;
  error?: string;
};

export const CANCELLED_MESSAGE = "Yükleme iptal edildi.";

/**
 * The file can still be cancelled (FIX UX-11): waiting, or uploading before the server's processing step
 * (once the bytes are up the server finishes the file; cancelling then would not stop it).
 */
export function canCancelUpload(item: Pick<QueueItem, "status" | "phase" | "progress">): boolean {
  if (item.status === "waiting") return true;
  return item.status === "uploading" && item.phase !== "processing" && !(item.phase === "uploading" && item.progress >= 1);
}
