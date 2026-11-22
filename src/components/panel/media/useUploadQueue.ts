"use client";
// The one upload queue of the panel (media library and picker dialog). Day 6: every file goes through the
// direct flow (upload-client.ts), one file per request, one after another, with per-file phases and byte
// progress; invalid files are flagged before anything is sent. Images and videos alike. A waiting or
// uploading file can be cancelled (FIX UX-11) until its bytes are up; the server's processing step then
// always finishes (cancelling it would not stop the server).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/panel/ui/toast-store";
import type { MediaKindFilter, PanelMedia } from "@/lib/panel/media/types";
import { checkUploadCandidate } from "@/lib/panel/media/upload-rules";
import { NETWORK_ERROR, uploadMediaFile } from "./upload-client";
import { CANCELLED_MESSAGE, canCancelUpload, type QueueItem } from "./upload-queue-model";

export type { QueueItem } from "./upload-queue-model";

/** Client-side pre-check (the server checks again by sniffing the real bytes). Turkish error or null. */
export function checkUploadFile(file: File, accept: MediaKindFilter = "all"): string | null {
  const result = checkUploadCandidate({ name: file.name, size: file.size, type: file.type }, accept);
  return result.ok ? null : result.error;
}

function summary(images: number, videos: number): string {
  const parts = [images ? `${images} görsel` : null, videos ? `${videos} video` : null].filter(Boolean);
  return parts.join(" ve ");
}

/**
 * `onUploaded(items, extras)` runs after each finished file: `items` = what the owner chose (select
 * them), `extras` = cover images made along the way (show them, don't select them).
 */
export function useUploadQueue(
  onUploaded: (items: PanelMedia[], extras: PanelMedia[]) => void,
  { accept = "all" }: { accept?: MediaKindFilter } = {},
) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const cancelled = useRef(new Set<string>());
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Leaving the page mid-upload loses the file: ask first.
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  const start = useCallback(
    async (files: File[], folder: string) => {
      if (files.length === 0) return;
      if (busyRef.current) {
        toast.info("Önceki yükleme sürüyor. Bitince tekrar deneyin.");
        return;
      }
      const update = (key: string, patch: Partial<QueueItem>) => setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
      const items: QueueItem[] = files.map((file) => {
        const check = checkUploadCandidate({ name: file.name, size: file.size, type: file.type }, accept);
        return {
          key: `u${++seq.current}`,
          name: file.name,
          size: file.size,
          kind: check.ok ? check.kind : null,
          status: check.ok ? "waiting" : "error",
          phase: null,
          progress: 0,
          error: check.ok ? undefined : check.error,
        };
      });
      setQueue(items);
      cancelled.current.clear();
      const valid = items.map((item, i) => ({ item, file: files[i] })).filter(({ item }) => item.status === "waiting");
      if (valid.length === 0) {
        toast.error(files.length === 1 ? "Bu dosya yüklenemez." : "Seçilen dosyalar yüklenemez.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      let images = 0;
      let videos = 0;
      let stopped = 0;
      const warnings = new Set<string>();
      for (const { item, file } of valid) {
        if (cancelled.current.has(item.key)) {
          stopped += 1;
          update(item.key, { status: "cancelled", phase: null, error: CANCELLED_MESSAGE });
          continue;
        }
        const controller = new AbortController();
        controllers.current.set(item.key, controller);
        update(item.key, { status: "uploading", phase: item.kind === "video" ? "preparing" : "uploading", progress: 0 });
        try {
          const result = await uploadMediaFile(file, {
            folder,
            accept,
            signal: controller.signal,
            onProgress: (phase, fraction) => update(item.key, { phase, progress: fraction }),
          });
          update(item.key, { status: "done", phase: null, progress: 1 });
          if (result.item.kind === "video") videos += 1;
          else images += 1;
          for (const w of result.warnings) warnings.add(`${item.name}: ${w}`);
          onUploaded([result.item], result.poster ? [result.poster] : []);
        } catch (error) {
          if (controller.signal.aborted) {
            stopped += 1;
            update(item.key, { status: "cancelled", phase: null, error: CANCELLED_MESSAGE });
          } else {
            update(item.key, { status: "error", phase: null, error: error instanceof Error ? error.message : NETWORK_ERROR });
          }
        } finally {
          controllers.current.delete(item.key);
        }
      }
      busyRef.current = false;
      setBusy(false);
      const done = images + videos;
      const failed = items.length - done - stopped;
      if (done > 0 && failed === 0) toast.success(`${summary(images, videos)} yüklendi.`);
      else if (done > 0) toast.warning(`${summary(images, videos)} yüklendi, ${failed} dosya yüklenemedi.`);
      else if (failed === 0) toast.info(CANCELLED_MESSAGE);
      else toast.error(items.length === 1 ? "Dosya yüklenemedi." : "Dosyalar yüklenemedi.");
      for (const w of warnings) toast.info(w, { duration: 10_000 });
    },
    [onUploaded, accept],
  );

  const clear = useCallback(() => {
    if (!busyRef.current) setQueue([]);
  }, []);

  /** Cancels one file (`key`) or every file that can still be cancelled (no key). */
  const cancel = useCallback((key?: string) => {
    for (const item of queueRef.current) {
      if ((key && item.key !== key) || !canCancelUpload(item)) continue;
      cancelled.current.add(item.key);
      controllers.current.get(item.key)?.abort();
      if (item.status === "waiting") setQueue((prev) => prev.map((q) => (q.key === item.key ? { ...q, status: "cancelled", error: CANCELLED_MESSAGE } : q)));
    }
  }, []);

  return { queue, busy, start, clear, cancel };
}
