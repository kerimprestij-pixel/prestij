"use client";

// Pause / resume / cancel a customer's subscription from the panel (editor). Each change is confirmed,
// locked by updatedAt and e-mails the customer (subscription_changed).
import { useState, useTransition } from "react";
import { CirclePause, CirclePlay, CircleX } from "lucide-react";
import { changeSubscriptionAction } from "@/app/panel/(dashboard)/abonelikler/actions";
import { Button, ConfirmDialog, toast } from "@/components/panel/ui";
import { toPayloadFormData } from "@/lib/panel/action-types";
import type { SubscriptionStatus } from "@/lib/subscriptions/types";

type Kind = "pause" | "resume" | "cancel";

const CONFIRM: Record<Kind, { title: string; description: string; confirm: string; tone: "danger" | "default" }> = {
  pause: {
    title: "Abonelik duraklatılsın mı?",
    description: "Devam ettirilene kadar yeni sipariş oluşturulmaz. Müşteriye bilgilendirme e-postası gider.",
    confirm: "Duraklat",
    tone: "default",
  },
  resume: {
    title: "Abonelik yeniden başlatılsın mı?",
    description: "Sipariş tarihi geçmişse bir sonraki sipariş bugünden itibaren bir dönem sonra oluşturulur. Müşteriye e-posta gider.",
    confirm: "Devam ettir",
    tone: "default",
  },
  cancel: {
    title: "Abonelik iptal edilsin mi?",
    description: "Bu abonelikten yeni sipariş oluşturulmaz; verilmiş siparişler etkilenmez. Bu işlem geri alınamaz, müşteriye e-posta gider.",
    confirm: "Aboneliği iptal et",
    tone: "danger",
  },
};

export default function SubscriptionActions({ id, status, updatedAt }: { id: number; status: SubscriptionStatus; updatedAt: string }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [pending, startTransition] = useTransition();
  if (status === "cancelled") return null;

  const run = (kind: Kind) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await changeSubscriptionAction(null, toPayloadFormData({ id, kind, updatedAt }));
        if (result.ok) toast.success(result.message ?? "Kaydedildi.");
        else toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 } : undefined);
        setOpen(null);
        resolve();
      });
    });

  const c = open ? CONFIRM[open] : null;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "active" || status === "past_due" ? (
        <Button icon={CirclePause} onClick={() => setOpen("pause")} disabled={pending}>
          Duraklat
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button variant="primary" icon={CirclePlay} onClick={() => setOpen("resume")} disabled={pending}>
          Devam ettir
        </Button>
      ) : null}
      <Button variant="danger-outline" icon={CircleX} onClick={() => setOpen("cancel")} disabled={pending}>
        İptal et
      </Button>
      {c && open ? (
        <ConfirmDialog
          open
          onClose={() => setOpen(null)}
          onConfirm={() => run(open)}
          title={c.title}
          description={c.description}
          confirmLabel={c.confirm}
          tone={c.tone}
          pending={pending}
        />
      ) : null}
    </div>
  );
}
