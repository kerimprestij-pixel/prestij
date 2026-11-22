"use server";
// "Şimdi çalıştır" on the dashboard's job status card (admin): runs one registered job right away under
// its advisory lock (a run already in progress is skipped, never doubled), then writes an audit row.
// The job itself runs outside any panel transaction, exactly as the cron route runs it.
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { getJob } from "@/lib/cron/registry";
import { runJobNow } from "@/lib/cron/run";
import { safeErrorInfo } from "@/lib/db-errors";
import { getPanelActor } from "@/lib/panel/action";
import { writeAudit } from "@/lib/panel/audit";
import { hasRole } from "@/lib/panel/roles";
import { describeJobCounts } from "@/components/panel/dashboard/job-labels";

export type RunJobState = { status: "idle" | "success" | "warning" | "error"; message: string; seq: number };

const input = z.object({ key: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/).max(64) });

export async function runJobNowAction(prev: RunJobState, formData: FormData): Promise<RunJobState> {
  const seq = (prev?.seq ?? 0) + 1;
  const actor = await getPanelActor();
  if (!actor) return { status: "error", message: "Oturumunuz sona ermiş. Yeni sekmede panele giriş yapıp tekrar deneyin.", seq };
  if (!hasRole(actor.staffRole, "admin")) return { status: "error", message: "Görevleri yalnızca yöneticiler elle çalıştırabilir.", seq };
  const parsed = input.safeParse({ key: formData.get("key") });
  if (!parsed.success) return { status: "error", message: "Görev bulunamadı. Sayfayı yenileyip tekrar deneyin.", seq };

  const outcome = await runJobNow(parsed.data.key);
  if (!outcome) return { status: "error", message: "Görev bulunamadı. Sayfayı yenileyip tekrar deneyin.", seq };
  const label = getJob(outcome.key)?.label ?? outcome.key;
  try {
    await db.transaction((tx) =>
      writeAudit(tx, {
        actorId: actor.user.id,
        action: "run",
        entity: "job",
        entityId: outcome.key,
        after: { label, status: outcome.status, ...(outcome.result ? { result: outcome.result } : {}) },
      }),
    );
  } catch (error) {
    console.error("[panel] job audit failed", { job: outcome.key, ...safeErrorInfo(error) });
  }
  refresh();
  if (outcome.status === "skipped") return { status: "warning", message: `“${label}” şu anda zaten çalışıyor; bu deneme atlandı.`, seq };
  if (outcome.status === "error") return { status: "error", message: `“${label}” çalışırken bir hata oluştu. Ayrıntı görev listesinde.`, seq };
  return { status: "success", message: `“${label}” çalıştırıldı: ${describeJobCounts(outcome.result ?? null)}.`, seq };
}
