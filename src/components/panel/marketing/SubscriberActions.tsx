"use client";
// Per-subscriber actions: end the subscription, or erase the row for good (KVKK). Both confirm first.
import { useState } from "react";
import { MailX, Trash2 } from "lucide-react";
import { deleteSubscriberAction, unsubscribeSubscriberAction } from "@/app/panel/(dashboard)/e-bulten/actions";
import { ConfirmDialog, iconButtonClass } from "@/components/panel/ui";
import { useActionRunner } from "./use-action-runner";

export default function SubscriberActions({ id, email, active }: { id: number; email: string; active: boolean }) {
  const [dialog, setDialog] = useState<"unsubscribe" | "delete" | null>(null);
  const runner = useActionRunner();
  const close = () => setDialog(null);

  return (
    <div className="flex items-center justify-end gap-1">
      {active ? (
        <button type="button" className={iconButtonClass("sm")} onClick={() => setDialog("unsubscribe")} title="Aboneliği sonlandır">
          <MailX aria-hidden className="size-4" />
          <span className="sr-only">{email} aboneliğini sonlandır</span>
        </button>
      ) : null}
      <button type="button" className={iconButtonClass("sm", "hover:text-[#B3261E] dark:hover:text-[#F28B82]")} onClick={() => setDialog("delete")} title="Kalıcı olarak sil (KVKK)">
        <Trash2 aria-hidden className="size-4" />
        <span className="sr-only">{email} adresini kalıcı olarak sil</span>
      </button>

      <ConfirmDialog
        open={dialog === "unsubscribe"}
        onClose={close}
        onConfirm={() => runner.run(unsubscribeSubscriberAction, { id }, { onSuccess: close })}
        pending={runner.pending}
        tone="default"
        title="Abonelik sonlandırılsın mı?"
        description={
          <>
            <span className="font-medium text-text">{email}</span> adresine artık bülten gönderilmez; kayıt “Ayrıldı” olarak listede kalır. Yeniden abone olmak için kişinin kendisi
            sitedeki formu doldurmalıdır.
          </>
        }
        confirmLabel="Aboneliği sonlandır"
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={close}
        onConfirm={() => runner.run(deleteSubscriberAction, { id }, { onSuccess: close })}
        pending={runner.pending}
        title="Abone kalıcı olarak silinsin mi?"
        description={
          <>
            <span className="font-medium text-text">{email}</span> ve izin kaydı kalıcı olarak silinir (KVKK kapsamında silme talebi). Bu işlem geri alınamaz; işlem kaydında e-posta adresi
            tutulmaz.
          </>
        }
        confirmLabel="Kalıcı olarak sil"
      />
    </div>
  );
}
