"use client";
// Admin actions on /panel/musteriler/<id>: change the group, send a password reset, download the data
// (KVKK), ban / unban, anonymize. Each one re-checks the admin role on the server.
import { Ban, Download, KeyRound, LockOpen, UserX, Users } from "lucide-react";
import { useState } from "react";
import {
  anonymizeCustomerAction,
  sendCustomerPasswordResetAction,
  setCustomerBannedAction,
  setCustomerGroupAction,
} from "@/app/panel/(dashboard)/musteriler/actions";
import { Field, Select, TextInput } from "@/components/panel/form";
import { useActionRunner } from "@/components/panel/marketing/use-action-runner";
import { Button, buttonClass, Dialog, useConfirm } from "@/components/panel/ui";
import type { LocalizedText } from "@/db/schema/common";

type Props = {
  customer: { id: string; name: string; email: string; banned: boolean; customerGroupId: number | null; updatedAt: string; orderCount: number };
  groups: { id: number; name: LocalizedText; isBusiness: boolean; discountPercent: number }[];
  /** b2b.requireApproval is on and the customer has no approved company: a group alone changes no price. */
  groupNeedsApprovedCompany: boolean;
};

export default function CustomerActions({ customer, groups, groupNeedsApprovedCompany }: Props) {
  const { pending, run } = useActionRunner();
  const { confirm, confirmDialog } = useConfirm();
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupId, setGroupId] = useState<number | null>(customer.customerGroupId);
  const [groupError, setGroupError] = useState<string | undefined>();
  const [anonOpen, setAnonOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const saveGroup = async () => {
    const result = await run(setCustomerGroupAction, { userId: customer.id, groupId, updatedAt: customer.updatedAt });
    if (result.ok) setGroupOpen(false);
    else setGroupError(result.fieldErrors?.groupId);
  };

  const sendReset = async () => {
    const ok = await confirm({
      title: "Şifre sıfırlama bağlantısı gönderilsin mi?",
      description: `${customer.email} adresine 1 saat geçerli bir şifre sıfırlama bağlantısı gider. Mevcut şifre, müşteri yenisini belirleyene kadar çalışmaya devam eder.`,
      confirmLabel: "Bağlantıyı gönder",
      tone: "default",
    });
    if (ok) await run(sendCustomerPasswordResetAction, { userId: customer.id });
  };

  const toggleBan = async () => {
    const banning = !customer.banned;
    const ok = await confirm({
      title: banning ? "Müşterinin erişimi kapatılsın mı?" : "Müşterinin erişimi açılsın mı?",
      description: banning
        ? `${customer.name} giriş yapamaz ve açık oturumlarının hepsi hemen sonlandırılır. Siparişleri ve bilgileri silinmez; erişimi daha sonra yeniden açabilirsiniz.`
        : `${customer.name} mevcut şifresiyle yeniden giriş yapabilir.`,
      confirmLabel: banning ? "Erişimi kapat" : "Erişimi aç",
      tone: banning ? "danger" : "default",
    });
    if (ok) await run(setCustomerBannedAction, { userId: customer.id, banned: banning, updatedAt: customer.updatedAt });
  };

  const anonymize = async () => {
    const result = await run(anonymizeCustomerAction, { userId: customer.id });
    if (result.ok) {
      setAnonOpen(false);
      setTyped("");
    }
  };

  const typedOk = typed.trim().toLowerCase() === customer.email.toLowerCase();

  return (
    <>
      <Button
        variant="secondary"
        icon={Users}
        onClick={() => {
          setGroupId(customer.customerGroupId);
          setGroupError(undefined);
          setGroupOpen(true);
        }}
        disabled={pending}
      >
        Grubu değiştir
      </Button>
      <Button variant="secondary" icon={KeyRound} onClick={sendReset} disabled={pending || customer.banned}>
        Şifre sıfırlama gönder
      </Button>
      <a href={`/panel/api/musteriler/${encodeURIComponent(customer.id)}/export`} download className={buttonClass("secondary")}>
        <Download aria-hidden className="size-4" />
        Verileri indir (JSON)
      </a>
      <Button variant={customer.banned ? "secondary" : "danger-outline"} icon={customer.banned ? LockOpen : Ban} onClick={toggleBan} disabled={pending}>
        {customer.banned ? "Erişimi aç" : "Erişimi kapat"}
      </Button>
      <Button
        variant="danger"
        icon={UserX}
        onClick={() => {
          setTyped("");
          setAnonOpen(true);
        }}
        disabled={pending}
      >
        Anonimleştir
      </Button>

      <Dialog
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        title="Müşteri grubu"
        description="Müşterinin kendi grubu, firmasının grubundan önce gelir. Değişiklik sepette ve ödemede hemen uygulanır."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupOpen(false)} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="primary" pending={pending} pendingLabel="Kaydediliyor…" onClick={saveGroup}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Grup" error={groupError} name="groupId">
            <Select
              value={groupId}
              onChange={(v) => setGroupId(v)}
              allowEmpty
              onClear={() => setGroupId(null)}
              placeholder="Grup yok (firmanın grubu veya perakende)"
              options={groups.map((g) => ({ value: g.id, label: `${g.name.tr}${g.discountPercent ? ` · %${g.discountPercent}` : ""}${g.isBusiness ? " · kurumsal" : ""}` }))}
            />
          </Field>
          {groupNeedsApprovedCompany ? (
            <p className="rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-xs leading-relaxed text-text">
              Ayarlar › Kurumsal&apos;da “kurumsal onay gerekli” açık. Bu müşterinin onaylı bir firması olmadığı için seçtiğiniz grubun fiyatları ona
              uygulanmaz; önce firmasını onaylayın.
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={anonOpen}
        onClose={() => setAnonOpen(false)}
        role="alertdialog"
        title="Hesap anonimleştirilsin mi?"
        description="Bu işlem geri alınamaz."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAnonOpen(false)} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="danger" icon={UserX} pending={pending} pendingLabel="Anonimleştiriliyor…" onClick={anonymize} disabled={!typedOk}>
              Kalıcı olarak anonimleştir
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-text">
          <p>Müşterinin kendisinin “Hesabımı sil” ile yaptığı silmeyle aynı kurallar uygulanır:</p>
          <ul className="list-disc space-y-1 ps-5 text-text-muted">
            <li>Ad, e-posta, telefon ve pazarlama izni silinir; hesap “Silinmiş üye” olur ve bir daha giriş yapılamaz.</li>
            <li>Adresler, favoriler ve sepet silinir; abonelikler iptal edilir; bütün oturumlar kapanır.</li>
            <li>E-bülten aboneliği sonlandırılır, sırada bekleyen e-postaları iptal edilir.</li>
            <li>
              {customer.orderCount > 0
                ? `${customer.orderCount} sipariş, fatura ve teslimat bilgileriyle yasal saklama süresi boyunca korunur.`
                : "Siparişi yok; yasal saklama gerektiren kayıt kalmaz."}
            </li>
          </ul>
          <Field label={`Onaylamak için müşterinin e-posta adresini yazın: ${customer.email}`} name="confirmEmail">
            <TextInput value={typed} onChange={setTyped} dir="ltr" autoComplete="off" spellCheck={false} />
          </Field>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  );
}
