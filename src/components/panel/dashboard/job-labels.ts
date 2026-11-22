// Turkish wording for the job status card (pure: used by the card, the "run now" action and tests).
import type { Tone } from "@/components/panel/labels";

/** Count keys returned by the registered jobs (src/lib/**\/jobs.ts), in Turkish. */
const COUNT_LABELS: Record<string, string> = {
  expired: "iptal edilen sipariş",
  deleted: "silinen kayıt",
  counters: "silinen sayaç",
  authRows: "silinen giriş kaydı",
  claimed: "işlenen e-posta",
  sent: "gönderilen",
  retried: "yeniden denenecek",
  failed: "başarısız",
  notConfigured: "gönderim ayarı eksik",
  started: "başlayan kampanya",
  batches: "parti",
  queued: "kuyruğa alınan e-posta",
  completed: "tamamlanan kampanya",
  skipped: "atlanan",
  disabled: "özellik kapalı",
  renewed: "yenilenen abonelik",
  busy: "başka işlemde",
  scanned: "taranan",
};

/** "3 gönderilen · 1 başarısız"; zero counts are left out. */
export function describeJobCounts(result: Record<string, number> | null): string {
  if (!result) return "sonuç yok";
  const parts = Object.entries(result)
    .filter(([, n]) => typeof n === "number" && n !== 0)
    .map(([key, n]) => `${n.toLocaleString("tr-TR")} ${COUNT_LABELS[key] ?? key}`);
  return parts.length > 0 ? parts.join(" · ") : "yapılacak iş yoktu";
}

export const JOB_GROUP_LABELS: Record<string, string> = { frequent: "Sık", daily: "Günlük" };

export function jobStatusInfo(status: string | null, running: boolean): { label: string; tone: Tone } {
  if (running) return { label: "Çalışıyor", tone: "info" };
  switch (status) {
    case "ok":
      return { label: "Başarılı", tone: "success" };
    case "error":
      return { label: "Hata", tone: "danger" };
    case "skipped":
      return { label: "Atlandı", tone: "warning" };
    default:
      return { label: "Henüz çalışmadı", tone: "neutral" };
  }
}
