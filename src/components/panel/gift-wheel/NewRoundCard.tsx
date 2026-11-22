"use client";
// "Yeni tur başlat": everyone may spin again and every account may win one more prize. A separate
// action (not the save bar) with a confirmation; disabled while the form has unsaved changes, so the
// round change never carries half-finished edits and the form's version stamp stays valid.
import { useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { startWheelRoundAction } from "@/app/panel/(dashboard)/hediye-carki/actions";
import { SettingsCard, Hint } from "@/components/panel/settings/SettingsForm";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { toast } from "@/components/panel/ui/toast-store";
import { panelLoginHref, toPayloadFormData, type ActionResult } from "@/lib/panel/action-types";
import type { StartWheelRoundResult } from "@/lib/panel/gift-wheel/action-defs";

const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";

export default function NewRoundCard({
  round,
  updatedAt,
  dirty,
  onStarted,
}: {
  round: number;
  updatedAt: string | null;
  /** The settings form has unsaved changes. */
  dirty: boolean;
  onStarted: (result: StartWheelRoundResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [lastStarted, setLastStarted] = useState<number | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const start = async () => {
    const ok = await confirm({
      title: `${round + 1}. tur başlatılsın mı?`,
      description: (
        <>
          Çarkı daha önce çevirmiş ziyaretçiler yeniden çevirebilir ve her hesap bu turda da en fazla bir hediye alabilir. Hesaplara
          tanımlanmış hediyeler kendi son kullanma tarihine kadar geçerli kalır. Bu işlem geri alınamaz.
        </>
      ),
      confirmLabel: "Yeni turu başlat",
      tone: "default",
    });
    if (!ok) return;
    startTransition(async () => {
      let result: ActionResult<StartWheelRoundResult>;
      try {
        result = await startWheelRoundAction(null, toPayloadFormData({ round, updatedAt }));
      } catch {
        result = { ok: false, code: "server", error: NETWORK_ERROR };
      }
      if (result.ok && result.data) {
        toast.success(result.message ?? "Yeni tur başladı.");
        setLastStarted(result.data.round);
        onStarted(result.data);
      } else if (!result.ok) {
        if (result.sessionExpired) {
          toast.error(result.error, {
            duration: 0,
            action: { label: "Yeni sekmede giriş yap", onClick: () => window.open(panelLoginHref(window.location.pathname), "_blank", "noopener") },
          });
        } else {
          toast.error(
            result.error,
            result.code === "conflict" ? { duration: 0, action: { label: "Sayfayı yenile", onClick: () => window.location.reload() } } : undefined,
          );
        }
      }
    });
  };

  return (
    <SettingsCard
      title="Tur"
      description="Her ziyaretçi çarkı bir kez çevirir ve her hesap her turda en fazla bir hediye alır. Yeni bir kampanya dönemi için yeni tur başlatın."
      aside={
        <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium tabular-nums text-text">
          Şu an {round}. tur
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={RotateCw} onClick={() => void start()} pending={pending} pendingLabel="Başlatılıyor…" disabled={dirty}>
          Yeni tur başlat
        </Button>
        {lastStarted ? (
          <span className="text-sm text-text-muted" role="status">
            {lastStarted}. tur başladı.
          </span>
        ) : null}
      </div>
      {dirty ? (
        <Hint tone="pending">Önce kaydedilmemiş değişiklikleri kaydedin ya da vazgeçin; ardından yeni tur başlatabilirsiniz.</Hint>
      ) : (
        <Hint>Örnek: bayram kampanyası bitti ve yılbaşı için çarkı yeniden açıyorsunuz. Önce dilimleri ve tarihleri güncelleyip kaydedin, sonra yeni tur başlatın.</Hint>
      )}
      {confirmDialog}
    </SettingsCard>
  );
}
