"use client";
// Ayarlar → E-posta: sender name, reply-to, admin recipients, footer note (one settings save). The
// template texts are edited per template on /panel/ayarlar/e-posta/<key> (they travel along unchanged).
import { useState } from "react";
import { saveEmailSettingsAction } from "@/app/panel/(dashboard)/ayarlar/e-posta/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedTextarea } from "@/components/panel/form/LocalizedInput";
import Textarea from "@/components/panel/form/Textarea";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import type { SettingsState } from "./settings-pages";
import { FieldRow, Hint, SettingsCard, SettingsForm } from "./SettingsForm";

type State = SettingsState<"emails">;

export default function EmailSettingsForm({ initial, generalEmail }: { initial: State; generalEmail: string }) {
  const form = usePanelForm<State>(initial);
  const { state, setField, errorFor, localizedError, errorsUnder } = form;
  // The recipients are edited as text (one address per line) and stored as a list.
  const [recipientsText, setRecipientsText] = useState(() => initial.adminRecipients.join("\n"));
  const recipientErrors = Object.values(errorsUnder("adminRecipients"));
  const shownText = state.adminRecipients.join("\n") === recipientsText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).join("\n") ? recipientsText : state.adminRecipients.join("\n");

  return (
    <SettingsForm form={form} action={saveEmailSettingsAction}>
      <SettingsCard title="Gönderen" description="Müşterinin gelen kutusunda görünen ad ve yanıtların gideceği adres.">
        <FieldRow>
          <Field label="Gönderen adı" required name="fromName" error={errorFor("fromName")} help="Örn. PRESTİJ. Gönderen adresi sunucu ayarlarından gelir.">
            <TextInput value={state.fromName} onChange={(v) => setField("fromName", v)} maxLength={80} />
          </Field>
          <Field
            label="Yanıt adresi"
            optional
            name="replyTo"
            error={errorFor("replyTo")}
            help={generalEmail ? `Boş bırakılırsa firma e-postası (${generalEmail}) kullanılır.` : "Boş bırakılırsa firma e-postası kullanılır."}
          >
            <TextInput value={state.replyTo} onChange={(v) => setField("replyTo", v)} type="email" inputMode="email" dir="ltr" maxLength={200} placeholder="destek@prestij.com.tr" />
          </Field>
        </FieldRow>
      </SettingsCard>

      <SettingsCard title="Yönetici bildirimleri" description="Yeni sipariş, teklif, numune ve kurumsal başvuru bildirimlerini alacak adresler.">
        <Field
          label="Alıcılar"
          optional
          name="adminRecipients"
          error={recipientErrors[0] ?? null}
          help="Her satıra bir adres yazın (en fazla 10). Boş bırakılırsa bildirimler firma e-postasına gider."
        >
          <Textarea
            value={shownText}
            rows={3}
            showCount={false}
            dir="ltr"
            placeholder={"siparis@prestij.com.tr\nmuhasebe@prestij.com.tr"}
            onChange={(v) => {
              setRecipientsText(v);
              setField(
                "adminRecipients",
                v
                  .split(/[\n,;]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
            }}
          />
        </Field>
        {state.adminRecipients.length === 0 && !generalEmail ? (
          <Hint tone="warning">Ne alıcı ne de firma e-postası tanımlı: yönetici bildirimleri kimseye gönderilmez. Ayarlar → Firma bilgileri’nden e-posta ekleyin.</Hint>
        ) : null}
      </SettingsCard>

      <SettingsCard title="Alt bilgi notu" description="Her e-postanın alt kısmında, firma bilgilerinin üstünde görünen kısa not.">
        <LocalizedTextarea
          label="Not"
          name="footerNote"
          value={state.footerNote}
          onChange={(v) => setField("footerNote", v)}
          error={localizedError("footerNote")}
          maxLength={500}
          rows={2}
          help="Örn. müşteri hizmetleri çalışma saatleri. Boş bırakılabilir."
        />
      </SettingsCard>
    </SettingsForm>
  );
}
