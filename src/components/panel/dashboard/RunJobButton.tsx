"use client";
// "Şimdi çalıştır" (admin) on the job status card: a confirm dialog, then runJobNowAction.
import { startTransition, useActionState, useState } from "react";
import { Play } from "lucide-react";
import { runJobNowAction, type RunJobState } from "@/app/panel/(dashboard)/job-actions";
import { Button, ConfirmDialog, toast } from "@/components/panel/ui";

const INITIAL: RunJobState = { status: "idle", message: "", seq: 0 };

export default function RunJobButton({ jobKey, label }: { jobKey: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [, action, pending] = useActionState(async (prev: RunJobState, data: FormData) => {
    const next = await runJobNowAction(prev, data);
    setOpen(false);
    if (next.status === "success") toast.success(next.message, { duration: 8000 });
    else if (next.status === "warning") toast.warning(next.message, { duration: 8000 });
    else if (next.status === "error") toast.error(next.message, { duration: 0 });
    return next;
  }, INITIAL);

  const confirm = () => {
    const data = new FormData();
    data.set("key", jobKey);
    startTransition(() => action(data));
  };

  return (
    <>
      <Button size="sm" variant="ghost" icon={Play} pending={pending} pendingLabel="Çalışıyor…" onClick={() => setOpen(true)} aria-label={`${label}: şimdi çalıştır`}>
        Şimdi çalıştır
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        pending={pending}
        tone="default"
        title={`“${label}” şimdi çalıştırılsın mı?`}
        confirmLabel="Çalıştır"
        description="Görev normalde zamanlayıcıyla kendiliğinden çalışır. Şimdi çalıştırırsanız bekleyen işler hemen yapılır (ör. e-postalar gönderilir, süresi dolan kayıtlar temizlenir). Aynı görev o anda zaten çalışıyorsa bu deneme atlanır."
      />
    </>
  );
}
