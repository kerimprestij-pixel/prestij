"use client";
import { useEffect, useState } from "react";
import { Eye, History, RotateCcw } from "lucide-react";
import { getLegalVersionAction, restoreLegalVersionAction } from "@/app/panel/(dashboard)/yasal/actions";
import Field from "@/components/panel/form/Field";
import { richProseClass } from "@/components/panel/form/RichTextEditor";
import TextInput from "@/components/panel/form/TextInput";
import { Skeleton } from "@/components/panel/Skeleton";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import Tabs from "@/components/panel/ui/Tabs";
import { toast } from "@/components/panel/ui/toast-store";
import type { LocalizedText } from "@/db/schema/common";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { formatIstanbul } from "@/lib/panel/format";
import type { LegalVersionSummary } from "@/lib/panel/legal/service";

type VersionDetail = NonNullable<Awaited<ReturnType<typeof getLegalVersionAction>>>;

const LOCALES = [
  { value: "tr", label: "Türkçe" },
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
] as const;

function VersionViewer({ id, onClose }: { id: number; onClose: () => void }) {
  const [detail, setDetail] = useState<VersionDetail | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getLegalVersionAction(id).then(
      (d) => alive && setDetail(d),
      () => alive && setDetail(null),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  const locales = detail ? LOCALES.filter((l) => l.value === "tr" || Boolean((detail.body as LocalizedText)[l.value])) : [];
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={detail ? `${detail.title.tr} · ${detail.version}` : "Sürüm"}
      description={detail ? `${formatIstanbul(detail.createdAt)} tarihinde yayınlandı${detail.isCurrent ? " · yürürlükte" : ""}` : undefined}
      footer={<Button onClick={onClose}>Kapat</Button>}
    >
      {detail === undefined ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">Yükleniyor…</span>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ) : detail === null ? (
        <p className="text-sm text-text-muted">Sürüm yüklenemedi. Sayfayı yenileyip tekrar deneyin.</p>
      ) : (
        <Tabs
          ariaLabel="Sürüm dili"
          variant="pills"
          items={locales.map((l) => {
            const notice = (detail.notice as LocalizedText)[l.value];
            const body = (detail.body as LocalizedText)[l.value] ?? "";
            return {
              value: l.value,
              label: l.label,
              content: (
                <div lang={l.value} dir={l.value === "ar" ? "rtl" : "ltr"} className="space-y-4 pt-2">
                  <h3 className="font-heading text-xl text-text">{(detail.title as LocalizedText)[l.value] || detail.title.tr}</h3>
                  {notice ? (
                    <div
                      className="rounded-md border border-border border-s-4 border-s-gold bg-surface-2/50 p-3 text-sm [&_strong]:font-semibold"
                      dangerouslySetInnerHTML={{ __html: notice }}
                    />
                  ) : null}
                  {/* Sanitized on the server (getLegalVersion → cleanStoredBody → sanitizeHtml). */}
                  <div className={richProseClass} dangerouslySetInnerHTML={{ __html: body }} />
                </div>
              ),
            };
          })}
        />
      )}
    </Dialog>
  );
}

function RestoreDialog({
  version,
  docKey,
  base,
  suggestion,
  checkout,
  onClose,
}: {
  version: LegalVersionSummary;
  docKey: string;
  checkout: boolean;
  base: { id: number | null; updatedAt: string | null };
  suggestion: string;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(suggestion);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const restore = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await restoreLegalVersionAction(
        null,
        toPayloadFormData({ key: docKey, sourceId: version.id, version: label, baseId: base.id, baseUpdatedAt: base.updatedAt }),
      );
      if (result.ok) {
        toast.success(result.message ?? "Sürüm geri yüklendi.");
        onClose();
        return;
      }
      if (result.fieldErrors?.version) setError(result.fieldErrors.version);
      toast.error(
        result.error,
        result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => window.location.reload() }, duration: 0 } : undefined,
      );
    } catch {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      size="sm"
      title={`“${version.version}” geri yüklensin mi?`}
      description={`Bu sürümün başlığı ve metni yeni bir sürüm olarak yayınlanır. Geçmiş silinmez; ${checkout ? "ödeme sayfası ve sitedeki sayfa" : "sitedeki sayfa"} hemen bu metni gösterir.`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button variant="primary" icon={RotateCcw} pending={pending} pendingLabel="Yayınlanıyor…" onClick={() => void restore()}>
            Yeni sürüm olarak yayınla
          </Button>
        </>
      }
    >
      {/* No <form> here: the dialog renders inside the editor's form (nested forms are invalid HTML). */}
      <Field label="Yeni sürüm adı" required error={error} help="Siparişlerde onaylanan sürüm olarak bu ad saklanır.">
        <TextInput
          value={label}
          onChange={(v) => {
            setLabel(v);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !pending) {
              e.preventDefault();
              void restore();
            }
          }}
          maxLength={40}
          autoFocus
        />
      </Field>
    </Dialog>
  );
}

/** Every version of the document, newest first, with "view" and "restore" (a copy published as a new version). */
export default function LegalHistory({
  versions,
  docKey,
  base,
  suggestion,
  restoreBlocked,
  checkout,
}: {
  versions: LegalVersionSummary[];
  checkout: boolean;
  docKey: string;
  base: { id: number | null; updatedAt: string | null };
  suggestion: string;
  /** Unsaved edits in the editor: restoring would replace the version they are based on. */
  restoreBlocked: boolean;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<LegalVersionSummary | null>(null);

  return (
    <section className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
      <header className="flex items-center gap-2 border-b border-border px-5 py-4">
        <History aria-hidden className="size-4 text-gold-text" />
        <h2 className="text-[0.9375rem] font-semibold text-text">Sürüm geçmişi</h2>
        <span className="ms-auto text-xs text-text-muted">{versions.length} sürüm</span>
      </header>
      <ol className="divide-y divide-border">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                <span className="break-all">{v.version}</span>
                {v.isCurrent ? (
                  <Badge tone="success" size="sm">
                    Yürürlükte
                  </Badge>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">{formatIstanbul(v.createdAt)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" icon={Eye} onClick={() => setViewing(v.id)}>
                Görüntüle
              </Button>
              {!v.isCurrent ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  disabled={restoreBlocked}
                  title={restoreBlocked ? "Önce düzenleyicideki değişiklikleri yayınlayın veya vazgeçin." : undefined}
                  onClick={() => setRestoring(v)}
                >
                  Geri yükle
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {restoreBlocked && versions.length > 1 ? (
        <p className="border-t border-border px-5 py-3 text-xs text-text-muted">
          Geri yüklemek için önce düzenleyicideki kaydedilmemiş değişiklikleri yayınlayın veya vazgeçin.
        </p>
      ) : null}
      {viewing !== null ? <VersionViewer key={viewing} id={viewing} onClose={() => setViewing(null)} /> : null}
      {restoring ? <RestoreDialog version={restoring} docKey={docKey} base={base} suggestion={suggestion} checkout={checkout} onClose={() => setRestoring(null)} /> : null}
    </section>
  );
}
