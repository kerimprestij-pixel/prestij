"use client";
// One e-mail template (/panel/ayarlar/e-posta/<key>): on/off, subject and intro per language with
// placeholder chips, a live preview of the unsaved texts (sandboxed iframe, desktop / phone), a test
// send to any address, and "built-in text" per language. Empty fields = the built-in text.
import { useEffect, useRef, useState } from "react";
import { Braces, RotateCcw, Send } from "lucide-react";
import { previewEmailTemplateAction, saveEmailTemplateAction, sendTestEmailAction } from "@/app/panel/(dashboard)/ayarlar/e-posta/actions";
import Field from "@/components/panel/form/Field";
import SaveBar from "@/components/panel/form/SaveBar";
import Switch from "@/components/panel/form/Switch";
import Textarea from "@/components/panel/form/Textarea";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { useActionRunner } from "@/components/panel/marketing/use-action-runner";
import { Hint, SettingsCard } from "@/components/panel/settings/SettingsForm";
import StatusBadge from "@/components/panel/StatusBadge";
import { Button } from "@/components/panel/ui";
import type { Locale, LocalizedText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import EmailPreviewFrame from "./EmailPreviewFrame";

export type TemplateEditorState = {
  key: string;
  enabled: boolean;
  subject: LocalizedText | null;
  intro: LocalizedText | null;
  updatedAt: string | null;
};

type Info = {
  key: string;
  label: string;
  description: string | null;
  audience: "customer" | "admin";
  marketing: boolean;
  required: boolean;
  placeholders: string[];
};

/** Native names on the language tabs; Turkish names inside Turkish sentences. */
const LOCALE_NAMES: Record<Locale, string> = { tr: "Türkçe", en: "English", ar: "العربية" };
const LOCALE_NAMES_TR: Record<Locale, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function unknownIn(text: string, allowed: string[]): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !allowed.includes(n)))];
}

function textOf(value: LocalizedText | null, locale: Locale): string {
  return value?.[locale] ?? "";
}

function withLocale(value: LocalizedText | null, locale: Locale, text: string): LocalizedText | null {
  const next: LocalizedText = { tr: value?.tr ?? "", ...(value?.en ? { en: value.en } : {}), ...(value?.ar ? { ar: value.ar } : {}) };
  if (locale === "tr") next.tr = text;
  else if (text) next[locale] = text;
  else delete next[locale];
  return next.tr || next.en || next.ar ? next : null;
}

export default function EmailTemplateEditor({
  initial,
  info,
  locales,
  defaults,
  testRecipient,
}: {
  initial: TemplateEditorState;
  info: Info;
  locales: Locale[];
  defaults: Record<Locale, { subject: string; intro: string }>;
  testRecipient: string;
}) {
  const form = usePanelForm<TemplateEditorState>(initial);
  const { state, setField, errorFor, formRef } = form;
  const [locale, setLocale] = useState<Locale>(locales[0] ?? "tr");
  const [preview, setPreview] = useState<{ html: string; text: string; subject: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState(testRecipient);
  const lastField = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; field: "subject" | "intro" } | null>(null);
  const runner = useActionRunner();
  const editable = !info.marketing;

  const subject = textOf(state.subject, locale);
  const intro = textOf(state.intro, locale);
  const subjectBad = unknownIn(subject, info.placeholders);
  const introBad = unknownIn(intro, info.placeholders);

  // Live preview of the current language (debounced). Empty fields preview the built-in texts.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await previewEmailTemplateAction({
          key: info.key,
          locale,
          subject: subject.trim() || defaults[locale]?.subject || null,
          intro: intro.trim() || defaults[locale]?.intro || null,
        });
        if (cancelled) return;
        if (r.ok) {
          setPreview({ html: r.html, text: r.text, subject: r.subject });
          setPreviewError(null);
        } else setPreviewError(r.error);
      } catch {
        if (!cancelled) setPreviewError("Önizleme yüklenemedi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [info.key, locale, subject, intro, defaults]);

  const setText = (field: "subject" | "intro", text: string) => setField(field, withLocale(state[field], locale, text));

  const insertPlaceholder = (name: string) => {
    const token = `{${name}}`;
    const target = lastField.current;
    const field = target?.field ?? "intro";
    const current = field === "subject" ? subject : intro;
    if (target && document.contains(target.el)) {
      const start = target.el.selectionStart ?? current.length;
      const end = target.el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setText(field, next);
      requestAnimationFrame(() => {
        target.el.focus();
        target.el.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      setText(field, current ? `${current} ${token}` : token);
    }
  };

  const resetLocale = () => {
    setField("subject", withLocale(state.subject, locale, ""));
    setField("intro", withLocale(state.intro, locale, ""));
  };

  const customized = (l: Locale) => Boolean(textOf(state.subject, l).trim() || textOf(state.intro, l).trim());

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="space-y-6 pb-28">
      <header className="min-w-0">
        <p className="eyebrow">{info.audience === "admin" ? "Yönetici bildirimi" : info.marketing ? "Pazarlama e-postası" : "Müşteri e-postası"}</p>
        <h2 className="mt-1 font-heading text-2xl font-medium leading-tight text-text sm:text-[1.75rem]">{info.label}</h2>
        {info.description ? <p className="mt-1 max-w-2xl text-sm text-text-muted">{info.description}</p> : null}
      </header>

      <SettingsCard
        title="Gönderim"
        description={info.required ? "Bu e-posta sitenin çalışması için gereklidir; kapatılamaz." : "Kapalıyken bu e-posta hiç gönderilmez (kayıtta da görünmez)."}
        aside={
          <Switch
            checked={state.enabled}
            onChange={(v) => setField("enabled", v)}
            disabled={info.required}
            invalid={Boolean(errorFor("enabled"))}
            label={<span className="sr-only">{info.label} gönderilsin</span>}
          />
        }
      >
        {errorFor("enabled") ? <p className="text-sm text-[#B3261E] dark:text-[#F28B82]">{errorFor("enabled")}</p> : null}
        {!state.enabled ? <Hint tone="warning">Kapalı: bu durumda müşterilere bu e-posta gönderilmez.</Hint> : null}
      </SettingsCard>

      {editable ? (
        <SettingsCard
          title="Konu ve giriş metni"
          description="Boş bıraktığınız alanlarda hazır metin kullanılır. Süslü parantezli alanlar gönderim sırasında gerçek bilgilerle doldurulur."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Dil" className="inline-flex rounded-lg border border-border bg-surface p-1">
              {locales.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={locale === l}
                  onClick={() => setLocale(l)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    locale === l ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  {LOCALE_NAMES[l]}
                  {customized(l) ? <span aria-label="özel metin" className="size-1.5 rounded-full bg-gold" /> : null}
                </button>
              ))}
            </div>
            {customized(locale) ? (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetLocale}>
                Hazır metne dön
              </Button>
            ) : (
              <StatusBadge>Hazır metin</StatusBadge>
            )}
          </div>

          <Field
            label="Konu"
            name={`subject.${locale}`}
            error={errorFor(`subject.${locale}`) ?? (subjectBad.length ? `Bu şablonda ${subjectBad.map((n) => `{${n}}`).join(", ")} kullanılamaz.` : null)}
          >
            <TextInput
              value={subject}
              onChange={(v) => setText("subject", v)}
              onFocus={(e) => (lastField.current = { el: e.currentTarget, field: "subject" })}
              onSelect={(e) => (lastField.current = { el: e.currentTarget, field: "subject" })}
              placeholder={defaults[locale]?.subject}
              maxLength={200}
              dir={locale === "ar" ? "rtl" : "ltr"}
              lang={locale}
            />
          </Field>
          <Field
            label="Giriş paragrafı"
            name={`intro.${locale}`}
            help="E-postadaki ilk paragrafın yerine geçer."
            error={errorFor(`intro.${locale}`) ?? (introBad.length ? `Bu şablonda ${introBad.map((n) => `{${n}}`).join(", ")} kullanılamaz.` : null)}
          >
            <Textarea
              value={intro}
              onChange={(v) => setText("intro", v)}
              onFocus={(e) => (lastField.current = { el: e.currentTarget, field: "intro" })}
              onSelect={(e) => (lastField.current = { el: e.currentTarget, field: "intro" })}
              placeholder={defaults[locale]?.intro}
              maxLength={2000}
              rows={4}
              dir={locale === "ar" ? "rtl" : "ltr"}
              lang={locale}
            />
          </Field>
          {info.placeholders.length > 0 ? (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <Braces aria-hidden className="size-3.5" />
                Kullanılabilecek alanlar (tıklayınca imlecin olduğu yere eklenir)
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {info.placeholders.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertPlaceholder(p)}
                      className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text transition-colors hover:border-gold hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {`{${p}}`}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SettingsCard>
      ) : (
        <SettingsCard title="Konu ve metin" description="Bu şablonun konusu ve metni her kampanyada E-bülten ekranında ayrı ayrı yazılır; burada yalnızca tasarımı önizlenir." />
      )}

      <SettingsCard
        title="Önizleme"
        description={`Örnek verilerle, kaydedilmemiş değişiklikler dahil · ${LOCALE_NAMES_TR[locale]}`}
        aside={
          !editable && locales.length > 1 ? (
            <select
              aria-label="Önizleme dili"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text"
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        {preview ? (
          <p className="text-sm">
            <span className="text-text-muted">Konu: </span>
            <span className="font-medium text-text" dir="auto">
              {preview.subject}
            </span>
          </p>
        ) : null}
        {previewError ? <p className="text-sm text-[#B3261E] dark:text-[#F28B82]">{previewError}</p> : null}
        {preview ? (
          <EmailPreviewFrame html={preview.html} text={preview.text} title={`${info.label} önizlemesi`} loading={loading} />
        ) : (
          <div className="h-96 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" aria-hidden />
        )}
      </SettingsCard>

      <SettingsCard title="Test e-postası" description="Örnek verilerle ve ekrandaki (kaydedilmemiş) metinlerle bir deneme gönderir; konunun başında [Test] yazar.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Alıcı" name="to" className="min-w-0 flex-1">
            <TextInput value={to} onChange={setTo} type="email" inputMode="email" dir="ltr" maxLength={200} />
          </Field>
          <Button
            icon={Send}
            pending={runner.pending}
            pendingLabel="Gönderiliyor…"
            disabled={!to.trim() || subjectBad.length > 0 || introBad.length > 0}
            onClick={() =>
              void runner.run(sendTestEmailAction, {
                key: info.key,
                locale,
                to,
                subject: editable ? subject.trim() || null : null,
                intro: editable ? intro.trim() || null : null,
              })
            }
          >
            {LOCALE_NAMES_TR[locale]} test e-postası gönder
          </Button>
        </div>
      </SettingsCard>

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={() =>
          void form.submit(saveEmailTemplateAction, {
            resetTo: (sent, data) => ({ ...sent, updatedAt: data?.updatedAt ?? sent.updatedAt }),
          })
        }
      />
    </form>
  );
}
