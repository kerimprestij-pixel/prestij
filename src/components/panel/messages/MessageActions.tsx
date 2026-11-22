"use client";
// Read/unread toggle and delete for one message, plus the silent "mark read on open".
import { Mail, MailOpen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { deleteMessageAction, markAllMessagesReadAction, setMessageReadAction } from "@/app/panel/(dashboard)/mesajlar/actions";
import { Button, toast, useConfirm } from "@/components/panel/ui";
import { toPayloadFormData } from "@/lib/panel/action-types";

export function MessageActions({ id, isRead, senderName }: { id: number; isRead: boolean; senderName: string }) {
  const router = useRouter();
  const [toggling, startToggle] = useTransition();
  const [deleting, startDelete] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  const toggle = () =>
    startToggle(async () => {
      const result = await setMessageReadAction(null, toPayloadFormData({ id, isRead: !isRead }));
      if (result.ok) toast.success(result.message ?? "Kaydedildi.");
      else toast.error(result.error);
    });

  const remove = async () => {
    const ok = await confirm({
      title: "Mesaj silinsin mi?",
      description: `${senderName} adlı kişinin mesajı kalıcı olarak silinir. Bu işlem geri alınamaz.`,
      confirmLabel: "Mesajı sil",
    });
    if (!ok) return;
    startDelete(async () => {
      const result = await deleteMessageAction(null, toPayloadFormData({ id }));
      if (result.ok) {
        toast.success(result.message ?? "Mesaj silindi.");
        router.replace("/panel/mesajlar");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Button
        variant="secondary"
        icon={isRead ? Mail : MailOpen}
        pending={toggling}
        pendingLabel="Kaydediliyor…"
        onClick={toggle}
        disabled={deleting}
      >
        {isRead ? "Okunmadı yap" : "Okundu yap"}
      </Button>
      <Button variant="danger-outline" icon={Trash2} pending={deleting} pendingLabel="Siliniyor…" onClick={remove} disabled={toggling}>
        Sil
      </Button>
      {confirmDialog}
    </>
  );
}

/** Opening an unread message marks it read once (quietly: no toast). */
export function MarkReadOnOpen({ id, isRead }: { id: number; isRead: boolean }) {
  const done = useRef<number | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (isRead || done.current === id) return;
    done.current = id;
    startTransition(async () => {
      await setMessageReadAction(null, toPayloadFormData({ id, isRead: true }));
    });
  }, [id, isRead]);
  return null;
}

/** "Tümünü okundu yap": only messages up to the newest one on screen (later arrivals stay unread). */
export function MarkAllReadButton({ maxId, unread }: { maxId: number; unread: number }) {
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const run = async () => {
    const ok = await confirm({
      title: "Tüm mesajlar okundu sayılsın mı?",
      description: `${unread.toLocaleString("tr-TR")} okunmamış mesaj okundu olarak işaretlenir. Mesajlar silinmez.`,
      confirmLabel: "Okundu yap",
      tone: "default",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await markAllMessagesReadAction(null, toPayloadFormData({ maxId }));
      if (result.ok) toast.success(result.message ?? "Kaydedildi.");
      else toast.error(result.error);
    });
  };
  return (
    <>
      <Button variant="secondary" size="sm" icon={MailOpen} pending={pending} pendingLabel="İşaretleniyor…" onClick={run}>
        Tümünü okundu yap
      </Button>
      {confirmDialog}
    </>
  );
}
