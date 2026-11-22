"use client";
// Newsletter campaign editor: localized subject and body, audience with the live recipient count, a
// preview per language, a test send (editor), and "Gönder" / "Planla" (admin, after the draft is
// saved). Sent and sending campaigns are shown by CampaignReport instead.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarClock, Send, ShieldAlert, Trash2, Users, X } from "lucide-react";
import {
  campaignRecipientCountAction,
  createCampaignAction,
  deleteCampaignAction,
  previewCampaignAction,
  saveCampaignAction,
  sendCampaignAction,
  testCampaignAction,
  unscheduleCampaignAction,
} from "@/app/panel/(dashboard)/e-bulten/kampanyalar/actions";
import EmailPreviewFrame from "@/components/panel/emails/EmailPreviewFrame";
import Field from "@/components/panel/form/Field";
import { LocalizedInput } from "@/components/panel/form/LocalizedInput";
import LocalizedRichText from "@/components/panel/form/LocalizedRichText";
import SaveBar from "@/components/panel/form/SaveBar";
import Select from "@/components/panel/form/Select";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { formatNumber } from "@/components/panel/labels";
import { useActionRunner } from "@/components/panel/marketing/use-action-runner";
import { Hint, SettingsCard } from "@/components/panel/settings/SettingsForm";
import { Button, ConfirmDialog } from "@/components/panel/ui";
import type { Locale, LocalizedText } from "@/i18n/locales";
import type { CampaignAudience, CampaignStatus } from "@/lib/newsletter/campaigns";
import { formatIstanbul, istanbulDateTimeLocal, parseIstanbulDateTimeLocal } from "@/lib/panel/format";
import { cn } from "@/lib/utils";
import { CAMPAIGN_AUDIENCE_HELP, CAMPAIGN_AUDIENCE_LABELS } from "./labels";

export type CampaignEditorState = {
  id: number | null;
  subject: LocalizedText;
  body: LocalizedText;
  audience: CampaignAudience;
  updatedAt: string | null;
};

const LOCALES: { value: Locale; label: string }[] = [
  { value: "tr", label: "Türkçe" },
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export default function CampaignEmailEditor({
  initial,
  status,
  scheduledAt,
  canSend,
  testRecipient,
  initialRecipients,
  defaultScheduleAt,
}: {
  initial: CampaignEditorState;
  status: CampaignStatus;
  scheduledAt: string | null;
  canSend: boolean;
  testRecipient: string;
  initialRecipients: number;
  /** Suggested schedule time ("YYYY-MM-DDTHH:mm", Istanbul): tomorrow at the full hour. */
  defaultScheduleAt: string;
}) {
  const router = useRouter();
  const form = usePanelForm<CampaignEditorState>(initial);
  const { state, setField, errorFor, localizedError, formRef } = form;
  const runner = useActionRunner();
  const [recipients, setRecipients] = useState(initialRecipients);
  const [previewLocale, setPreviewLocale] = useState<Locale>("tr");
  const [preview, setPreview] = useState<{ html: string; text: string; subject: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState(testRecipient);
  const [at, setAt] = useState(scheduledAt ? istanbulDateTimeLocal(scheduledAt) : defaultScheduleAt);
  const [dialog, setDialog] = useState<"send" | "schedule" | "delete" | null>(null);

  // Recipient count of the chosen audience.
  useEffect(() => {
    let cancelled = false;
    campaignRecipientCountAction(state.audience)
      .then((n) => {
        if (!cancelled) setRecipients(n);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.audience]);

  // Live preview (debounced) of the chosen language with the unsaved texts.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await previewCampaignAction({ subject: state.subject, body: state.body, locale: previewLocale });
        if (!cancelled && r.ok) setPreview({ html: r.html, text: r.text, subject: r.subject });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.subject, state.body, previewLocale]);

  const saved = state.id != null;
  const scheduled = status === "scheduled";
  const missing = (l: Locale) => l !== "tr" && (!state.subject[l]?.trim() || !state.body[l]?.trim());

  const save = () =>
    saved
      ? form.submit(saveCampaignAction, { resetTo: (sent, data) => ({ ...sent, updatedAt: data?.updatedAt ?? sent.updatedAt }) })
      : form.submit<{ id: number; updatedAt: string }>(createCampaignAction, {
          payload: (s) => ({ subject: s.subject, body: s.body, audience: s.audience }),
          onSuccess: (data) => {
            if (data?.id) router.replace(`/panel/e-bulten/kampanyalar/${data.id}`);
          },
        });

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="space-y-6 pb-28">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <SettingsCard title="İçerik" description="Her abone kampanyayı kendi dilinde alır; çevirisi olmayan dillerde Türkçe metin gönderilir.">
            <LocalizedInput
              label="Konu"
              required
              name="subject"
              value={state.subject}
              onChange={(v) => setField("subject", v)}
              error={localizedError("subject")}
              maxLength={150}
            />
            <LocalizedRichText
              label="Metin"
              required
              name="body"
              value={state.body}
              onChange={(v) => setField("body", v)}
              error={localizedError("body")}
              minHeight={16}
              help="Başlık, kalın yazı, liste ve bağlantı ekleyebilirsiniz. Abonelikten çıkma bağlantısı alt bilgiye otomatik eklenir."
            />
          </SettingsCard>

          <SettingsCard title="Kitle">
            <Field label="Kime gönderilecek?" name="audience" error={errorFor("audience")} help={CAMPAIGN_AUDIENCE_HELP[state.audience]}>
              <Select
                value={state.audience}
                onChange={(v) => setField("audience", v)}
                options={(Object.keys(CAMPAIGN_AUDIENCE_LABELS) as CampaignAudience[]).map((a) => ({ value: a, label: CAMPAIGN_AUDIENCE_LABELS[a] }))}
              />
            </Field>
            <p className="flex items-center gap-2 text-sm text-text">
              <Users aria-hidden className="size-4 text-text-muted" />
              <span>
                <span className="font-semibold tabular-nums">{formatNumber(recipients)}</span> onaylı abone
              </span>
            </p>
            <Hint tone="warning">
              İYS: Türkiye’de ticari elektronik ileti yalnızca onay veren alıcılara gönderilebilir. Bu liste çift onaylı (e-postasındaki bağlantıyla onaylamış) abonelerden
              oluşur; aboneleri İleti Yönetim Sistemi’ne (İYS) de kaydetmeyi unutmayın.
            </Hint>
          </SettingsCard>

          <SettingsCard title="Test e-postası" description="Kaydedilmemiş metinlerle, seçili önizleme dilinde bir deneme gönderir.">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Alıcı" name="to" className="min-w-0 flex-1">
                <TextInput value={to} onChange={setTo} type="email" inputMode="email" dir="ltr" maxLength={200} />
              </Field>
              <Button
                icon={Send}
                pending={runner.pending && dialog === null}
                pendingLabel="Gönderiliyor…"
                disabled={!to.trim() || !state.subject.tr?.trim()}
                onClick={() => void runner.run(testCampaignAction, { subject: state.subject, body: state.body, locale: previewLocale, to })}
              >
                Test gönder
              </Button>
            </div>
          </SettingsCard>

          {saved ? (
            <SettingsCard
              title="Gönderim"
              description={
                scheduled && scheduledAt
                  ? `Planlandı: ${formatIstanbul(scheduledAt)} (Türkiye saati).`
                  : "Kampanyayı hemen gönderebilir ya da ileri bir tarihe planlayabilirsiniz. Gönderim 200’lük gruplar halinde yapılır."
              }
            >
              {!canSend ? (
                <Hint tone="pending">Gönderme ve planlama yalnızca yöneticilere açık. Taslağı kaydedin; bir yönetici gönderebilir.</Hint>
              ) : form.dirty ? (
                <Hint tone="warning">Önce değişiklikleri kaydedin.</Hint>
              ) : (
                <div className="space-y-4">
                  {LOCALES.filter((l) => missing(l.value)).length > 0 ? (
                    <Hint>
                      {LOCALES.filter((l) => missing(l.value))
                        .map((l) => l.label)
                        .join(", ")}{" "}
                      çevirisi eksik: bu dildeki abonelere Türkçe metin gider.
                    </Hint>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-3">
                    <Button variant="primary" icon={Send} onClick={() => setDialog("send")} disabled={recipients === 0}>
                      Şimdi gönder
                    </Button>
                    {scheduled ? (
                      <Button
                        icon={X}
                        pending={runner.pending}
                        onClick={() =>
                          void runner.run(unscheduleCampaignAction, { id: state.id, updatedAt: state.updatedAt }, { onSuccess: () => router.refresh() })
                        }
                      >
                        Planlamayı kaldır
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
                    <Field label="Planlanan zaman (Türkiye saati)" name="at" className="min-w-0 sm:w-64">
                      <input
                        type="datetime-local"
                        value={at}
                        onChange={(e) => setAt(e.target.value)}
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20"
                      />
                    </Field>
                    <Button icon={CalendarClock} onClick={() => setDialog("schedule")} disabled={!at || recipients === 0}>
                      {scheduled ? "Zamanı değiştir" : "Planla"}
                    </Button>
                  </div>
                </div>
              )}
            </SettingsCard>
          ) : null}

          {saved ? (
            <div className="flex justify-end">
              <Button variant="danger-outline" size="sm" icon={Trash2} onClick={() => setDialog("delete")}>
                Kampanyayı sil
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="xl:sticky xl:top-24">
            <SettingsCard
              title="Önizleme"
              aside={
                <div role="tablist" aria-label="Önizleme dili" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
                  {LOCALES.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      role="tab"
                      aria-selected={previewLocale === l.value}
                      onClick={() => setPreviewLocale(l.value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        previewLocale === l.value ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:text-text",
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              }
            >
              {preview ? (
                <>
                  <p className="text-sm">
                    <span className="text-text-muted">Konu: </span>
                    <span className="font-medium text-text" dir="auto">
                      {preview.subject}
                    </span>
                  </p>
                  <EmailPreviewFrame html={preview.html} text={preview.text} title="Kampanya önizlemesi" loading={loading} minHeight={560} />
                </>
              ) : (
                <div className="h-96 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" aria-hidden />
              )}
            </SettingsCard>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === "send"}
        onClose={() => setDialog(null)}
        tone="default"
        pending={runner.pending}
        title={`${formatNumber(recipients)} aboneye gönderilsin mi?`}
        description={
          <span className="flex items-start gap-2">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" />
            <span>
              “{state.subject.tr}” konulu kampanya {CAMPAIGN_AUDIENCE_LABELS[state.audience].toLocaleLowerCase("tr")} kitlesindeki{" "}
              <span className="font-medium text-text">{formatNumber(recipients)}</span> onaylı aboneye hemen gönderilmeye başlar. Gönderim başladıktan sonra durdurulamaz.
            </span>
          </span>
        }
        confirmLabel="Gönderimi başlat"
        onConfirm={() =>
          runner.run(sendCampaignAction, { id: state.id, updatedAt: state.updatedAt, at: null }, {
            onSuccess: () => {
              setDialog(null);
              router.refresh();
            },
          })
        }
      />
      <ConfirmDialog
        open={dialog === "schedule"}
        onClose={() => setDialog(null)}
        tone="default"
        pending={runner.pending}
        title="Kampanya planlansın mı?"
        description={`Kampanya ${at ? formatIstanbul(parseIstanbulDateTimeLocal(at) ?? at) : ""} (Türkiye saati) itibarıyla ${formatNumber(recipients)} onaylı aboneye gönderilmeye başlar. O zamana kadar planlamayı kaldırabilir veya metni düzenleyebilirsiniz.`}
        confirmLabel="Planla"
        onConfirm={() =>
          runner.run(sendCampaignAction, { id: state.id, updatedAt: state.updatedAt, at }, {
            onSuccess: () => {
              setDialog(null);
              router.refresh();
            },
          })
        }
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        pending={runner.pending}
        title="Kampanya silinsin mi?"
        description="Taslak kalıcı olarak silinir. Bu işlem geri alınamaz."
        confirmLabel="Sil"
        onConfirm={() =>
          runner.run(deleteCampaignAction, { id: state.id, updatedAt: state.updatedAt }, {
            onSuccess: () => {
              setDialog(null);
              router.push("/panel/e-bulten/kampanyalar");
            },
          })
        }
      />

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        saveLabel={saved ? "Kaydet" : "Taslağı oluştur"}
        onSave={() => void save()}
      />
    </form>
  );
}
