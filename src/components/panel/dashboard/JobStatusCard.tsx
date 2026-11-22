// "Zamanlanmış görevler" on the dashboard (staff): every registered job with its last run; admins also
// get "Şimdi çalıştır". Error details are the stored error class only (job_runs never holds data).
import { Clock } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import StatusBadge from "@/components/panel/StatusBadge";
import type { JobStatus } from "@/lib/cron/run";
import { describeJobCounts, JOB_GROUP_LABELS, jobStatusInfo } from "./job-labels";
import RunJobButton from "./RunJobButton";

export default function JobStatusCard({ jobs, canRun }: { jobs: JobStatus[]; canRun: boolean }) {
  const failing = jobs.filter((j) => j.lastStatus === "error" && !j.running).length;
  return (
    <Card
      title="Zamanlanmış görevler"
      description={
        failing > 0
          ? `${formatNumber(failing)} görevin son çalışması hatayla bitti`
          : "E-posta gönderimi, süresi dolan ödemeler, abonelik yenilemeleri ve temizlik işleri"
      }
      flush
    >
      {jobs.length === 0 ? (
        <EmptyState icon={Clock} title="Kayıtlı görev yok" description="Görevler sunucu açıldığında burada listelenir." className="py-8" />
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => {
            const status = jobStatusInfo(job.lastStatus, job.running);
            const last = job.lastFinishedAt ?? job.lastStartedAt;
            return (
              <li key={job.key} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-text">
                    <span className="min-w-0 break-words">{job.label}</span>
                    <span className="rounded-full border border-border px-2 py-px text-[11px] font-normal text-text-muted">
                      {JOB_GROUP_LABELS[job.group] ?? job.group}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {last ? (
                      <>
                        Son çalışma {formatDateTime(last)}
                        {job.lastStatus === "ok" && job.lastResult ? <> · {describeJobCounts(job.lastResult)}</> : null}
                        {job.lastStatus === "error" && job.lastError ? <> · {job.lastError}</> : null}
                        {job.runCount > 0 ? <> · toplam {formatNumber(job.runCount)} kez</> : null}
                      </>
                    ) : (
                      "Zamanlayıcı henüz çalıştırmadı."
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  {canRun ? <RunJobButton jobKey={job.key} label={job.label} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
