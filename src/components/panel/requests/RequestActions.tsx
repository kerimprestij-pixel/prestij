"use client";

// Status buttons of a quote or sample request (with confirmations), the sample shipping dialog, the
// sample rejection dialog (optional note for the e-mail) and the admin note editor.
import { Ban, CircleCheckBig, Eye, PackageCheck, RotateCcw, Save, ThumbsDown, Truck } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { saveSampleNoteAction, setSampleStatusAction, shipSampleAction } from "@/app/panel/(dashboard)/numune-talepleri/actions";
import { saveQuoteNoteAction, setQuoteStatusAction } from "@/app/panel/(dashboard)/teklifler/actions";
import { Field, Select, Textarea, TextInput } from "@/components/panel/form";
import { Button, Dialog, toast, useConfirm } from "@/components/panel/ui";
import { toPayloadFormData, type ActionResult } from "@/lib/panel/action-types";
import type { QuoteStatus, SampleStatus } from "@/lib/requests/types";

function report<T>(result: ActionResult<T>): boolean {
  if (result.ok) toast.success(result.message ?? "Kaydedildi.");
  else toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 } : undefined);
  return result.ok;
}

// ---------------------------------------------------------------------------------------------
// Quotes

export function QuoteStatusActions({ id, status, updatedAt, email }: { id: number; status: QuoteStatus; updatedAt: string; email: string }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<QuoteStatus | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const change = (next: QuoteStatus, ask?: { title: string; description: string; confirmLabel: string; tone?: "danger" | "default" }) => async () => {
    if (ask && !(await confirm(ask))) return;
    setBusy(next);
    start(async () => {
      report(await setQuoteStatusAction(null, toPayloadFormData({ id, status: next, updatedAt })));
      setBusy(null);
    });
  };

  const buttons: ReactNode[] = [];
  if (status === "new") {
    buttons.push(
      <Button key="review" icon={Eye} pending={pending && busy === "in_review"} pendingLabel="Kaydediliyor…" onClick={change("in_review")} disabled={pending}>
        İncelemeye al
      </Button>,
    );
  }
  if (status === "quoted") {
    buttons.push(
      <Button
        key="won"
        icon={CircleCheckBig}
        pending={pending && busy === "won"}
        pendingLabel="Kaydediliyor…"
        disabled={pending}
        onClick={change("won", {
          title: "Teklif kabul edildi mi?",
          description: "Talep “Kazanıldı” olarak kapatılır. Siparişi ayrıca oluşturmanız gerekir; müşteriye e-posta gönderilmez.",
          confirmLabel: "Kazanıldı olarak kapat",
          tone: "default",
        })}
      >
        Kazanıldı
      </Button>,
    );
  }
  if (status === "new" || status === "in_review" || status === "quoted") {
    buttons.push(
      <Button
        key="reject"
        variant="danger-outline"
        icon={Ban}
        pending={pending && busy === "rejected"}
        pendingLabel="Kaydediliyor…"
        disabled={pending}
        onClick={change("rejected", {
          title: status === "quoted" ? "Teklif kabul edilmedi mi?" : "Talep reddedilsin mi?",
          description:
            status === "quoted"
              ? "Talep “Reddedildi” olarak kapatılır. Müşteriye e-posta gönderilmez; gerekirse sonra yeniden açabilirsiniz."
              : `Talep “Reddedildi” olarak kapatılır. ${email} adresine e-posta gönderilmez; müşteriye bilgi vermek isterseniz “E-postayla yanıtla”yı kullanın.`,
          confirmLabel: "Reddet",
        })}
      >
        {status === "quoted" ? "Kabul edilmedi" : "Reddet"}
      </Button>,
    );
  }
  if (status === "rejected") {
    buttons.push(
      <Button key="reopen" icon={RotateCcw} pending={pending && busy === "in_review"} pendingLabel="Kaydediliyor…" onClick={change("in_review")} disabled={pending}>
        Yeniden aç
      </Button>,
    );
  }
  return (
    <>
      {buttons}
      {confirmDialog}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Samples

export function SampleStatusActions({
  id,
  status,
  updatedAt,
  email,
  language,
  carriers,
}: {
  id: number;
  status: SampleStatus;
  updatedAt: string;
  email: string;
  language: string;
  carriers: { key: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const run = (key: string, payload: Record<string, unknown>, after?: () => void) => {
    setBusy(key);
    start(async () => {
      if (report(await setSampleStatusAction(null, toPayloadFormData({ id, updatedAt, ...payload })))) after?.();
      setBusy(null);
    });
  };

  const buttons: ReactNode[] = [];
  if (status === "new") {
    buttons.push(
      <Button key="review" icon={Eye} pending={pending && busy === "in_review"} pendingLabel="Kaydediliyor…" onClick={() => run("in_review", { status: "in_review" })} disabled={pending}>
        İncelemeye al
      </Button>,
    );
  }
  if (status === "new" || status === "in_review") {
    buttons.push(
      <Button
        key="approve"
        variant="primary"
        icon={CircleCheckBig}
        pending={pending && busy === "approved"}
        pendingLabel="Onaylanıyor…"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Numune talebi onaylansın mı?",
            description: `${email} adresine ${language} “Numune talebiniz onaylandı” e-postası gönderilir. Kargoya verdiğinizde takip numarasını ayrıca girersiniz.`,
            confirmLabel: "Onayla",
            tone: "default",
          });
          if (ok) run("approved", { status: "approved" });
        }}
      >
        Onayla
      </Button>,
    );
  }
  if (status === "approved") {
    buttons.push(
      <Button key="ship" variant="primary" icon={Truck} onClick={() => setShipOpen(true)} disabled={pending}>
        Kargoya ver
      </Button>,
    );
  }
  if (status === "shipped") {
    buttons.push(
      <Button
        key="won"
        icon={PackageCheck}
        pending={pending && busy === "won"}
        pendingLabel="Kaydediliyor…"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Müşteriye dönüştü mü?",
            description: "Talep “Kazanıldı” olarak kapatılır. Müşteriye e-posta gönderilmez.",
            confirmLabel: "Kazanıldı olarak kapat",
            tone: "default",
          });
          if (ok) run("won", { status: "won" });
        }}
      >
        Kazanıldı
      </Button>,
      <Button
        key="lost"
        variant="danger-outline"
        icon={ThumbsDown}
        pending={pending && busy === "rejected"}
        pendingLabel="Kaydediliyor…"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Müşteriye dönüşmedi mi?",
            description: "Talep “Reddedildi” olarak kapatılır. Numuneler gönderildiği için müşteriye e-posta gönderilmez.",
            confirmLabel: "Kapat",
          });
          if (ok) run("rejected", { status: "rejected" });
        }}
      >
        Kazanılamadı
      </Button>,
    );
  }
  if (status === "new" || status === "in_review" || status === "approved") {
    buttons.push(
      <Button key="reject" variant="danger-outline" icon={Ban} onClick={() => setRejectOpen(true)} disabled={pending}>
        Reddet
      </Button>,
    );
  }
  if (status === "rejected") {
    buttons.push(
      <Button key="reopen" icon={RotateCcw} pending={pending && busy === "in_review"} pendingLabel="Kaydediliyor…" onClick={() => run("in_review", { status: "in_review" })} disabled={pending}>
        Yeniden aç
      </Button>,
    );
  }

  return (
    <>
      {buttons}
      {confirmDialog}
      {shipOpen ? <ShipDialog id={id} updatedAt={updatedAt} email={email} carriers={carriers} onClose={() => setShipOpen(false)} /> : null}
      {rejectOpen ? (
        <RejectDialog
          email={email}
          language={language}
          pending={pending && busy === "rejected"}
          onClose={() => setRejectOpen(false)}
          onConfirm={(note) => run("rejected", { status: "rejected", note }, () => setRejectOpen(false))}
        />
      ) : null}
    </>
  );
}

function ShipDialog({ id, updatedAt, email, carriers, onClose }: { id: number; updatedAt: string; email: string; carriers: { key: string; name: string }[]; onClose: () => void }) {
  const [carrier, setCarrier] = useState<string | null>(carriers[0]?.key ?? null);
  const [tracking, setTracking] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const result = await shipSampleAction(null, toPayloadFormData({ id, updatedAt, carrier: carrier ?? "", trackingNumber: tracking }));
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      if (report(result)) onClose();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Kargoya ver"
      description={`Takip numarası ${email} adresine “Numuneleriniz kargoda” e-postasıyla gönderilir.`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button variant="primary" icon={Truck} pending={pending} pendingLabel="Kaydediliyor…" onClick={submit} disabled={!carrier}>
            Kargoya verildi olarak kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Kargo firması" required error={errors.carrier} name="carrier" help={carriers.length ? undefined : "Ayarlar → Kargo'da tanımlı kargo firması yok."}>
          <Select<string> value={carrier} onChange={setCarrier} options={carriers.map((c) => ({ value: c.key, label: c.name }))} placeholder="Seçin" />
        </Field>
        <Field label="Takip numarası" required error={errors.trackingNumber} name="trackingNumber" help="Harf, rakam ve tire; 4–40 karakter. Boşluklar otomatik silinir.">
          <TextInput value={tracking} onChange={setTracking} maxLength={60} autoComplete="off" spellCheck={false} className="font-mono uppercase" />
        </Field>
      </div>
    </Dialog>
  );
}

function RejectDialog({ email, language, pending, onClose, onConfirm }: { email: string; language: string; pending: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      role="alertdialog"
      title="Numune talebi reddedilsin mi?"
      description={`${email} adresine ${language} “Numune talebiniz hakkında” e-postası gönderilir.`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button variant="danger" icon={Ban} pending={pending} pendingLabel="Kaydediliyor…" onClick={() => onConfirm(note)}>
            Reddet ve e-posta gönder
          </Button>
        </>
      }
    >
      <Field label="Müşteriye not" optional help={`E-postada gösterilir; boş bırakılırsa yalnızca kibar bir ret metni gider. ${language} yazın.`}>
        <Textarea value={note} onChange={setNote} maxLength={1000} rows={3} />
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin note

export function AdminNoteForm({ kind, id, note, updatedAt }: { kind: "quote" | "sample"; id: number; note: string | null; updatedAt: string }) {
  const [value, setValue] = useState(note ?? "");
  const [pending, start] = useTransition();
  const dirty = value.trim() !== (note ?? "").trim();
  const save = () =>
    start(async () => {
      const action = kind === "quote" ? saveQuoteNoteAction : saveSampleNoteAction;
      report(await action(null, toPayloadFormData({ id, adminNote: value, updatedAt })));
    });
  return (
    <div className="space-y-3">
      <Field label="Yönetici notu" hideLabel help="Yalnızca panelde görünür; müşteriye gönderilmez.">
        <Textarea value={value} onChange={setValue} maxLength={4000} rows={4} placeholder="Ör. görüşme notları, fiyat onayı bekleniyor…" />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" icon={Save} pending={pending} pendingLabel="Kaydediliyor…" onClick={save} disabled={!dirty}>
          Notu kaydet
        </Button>
      </div>
    </div>
  );
}
