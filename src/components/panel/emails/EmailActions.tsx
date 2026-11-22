"use client";
// "Tekrar gönder" (a copy goes into the queue) and "İptal" (queued mails only), both confirmed first.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { cancelEmailAction, resendEmailAction } from "@/app/panel/(dashboard)/e-postalar/actions";
import { useActionRunner } from "@/components/panel/marketing/use-action-runner";
import { Button, ConfirmDialog } from "@/components/panel/ui";

export default function EmailActions({ id, to, canCancel, canResend }: { id: number; to: string; canCancel: boolean; canResend: boolean }) {
  const [dialog, setDialog] = useState<"resend" | "cancel" | null>(null);
  const runner = useActionRunner();
  const router = useRouter();
  const close = () => setDialog(null);

  return (
    <div className="flex flex-wrap gap-2">
      {canResend ? (
        <Button icon={RotateCcw} onClick={() => setDialog("resend")}>
          Tekrar gönder
        </Button>
      ) : null}
      {canCancel ? (
        <Button variant="danger-outline" icon={Ban} onClick={() => setDialog("cancel")}>
          Gönderimi iptal et
        </Button>
      ) : null}
      <ConfirmDialog
        open={dialog === "resend"}
        onClose={close}
        tone="default"
        pending={runner.pending}
        onConfirm={() =>
          runner.run<{ id: number }>(resendEmailAction, { id }, {
            onSuccess: (data) => {
              close();
              if (data?.id) router.push(`/panel/e-postalar/${data.id}`);
            },
          })
        }
        title="E-posta yeniden gönderilsin mi?"
        description={
          <>
            Bu e-postanın aynı içerikle bir kopyası <span className="font-medium text-text">{to}</span> adresine gönderilir. Kayıtta iki ayrı satır olarak görünür.
          </>
        }
        confirmLabel="Tekrar gönder"
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onClose={close}
        pending={runner.pending}
        onConfirm={() => runner.run(cancelEmailAction, { id }, { onSuccess: close })}
        title="Gönderim iptal edilsin mi?"
        description="Kuyruktaki e-posta gönderilmez ve kayıt “İptal edildi” olarak kalır. Gerekirse daha sonra “Tekrar gönder” ile yeniden gönderebilirsiniz."
        confirmLabel="Gönderimi iptal et"
      />
    </div>
  );
}
