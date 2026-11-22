"use client";
import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, ExternalLink, Megaphone, Star, Trash2 } from "lucide-react";
import { deleteThemeAction, saveThemeAction, setDefaultThemeAction } from "@/app/panel/(dashboard)/tema/actions";
import Card from "@/components/panel/Card";
import ColorInput from "@/components/panel/form/ColorInput";
import Field from "@/components/panel/form/Field";
import { NumberInput } from "@/components/panel/form/NumberInput";
import SaveBar from "@/components/panel/form/SaveBar";
import ScheduleInput from "@/components/panel/form/ScheduleInput";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import Notice from "@/components/panel/Notice";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { buttonClass, errorClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { formatIstanbul } from "@/lib/panel/format";
import type { PanelThemeDetail, ThemeEditorState } from "@/lib/panel/theme/queries";
import {
  THEME_COLOR_KEYS,
  THEME_COLOR_LABELS,
  THEME_FONT_OPTIONS,
  THEME_PRIORITY_MAX,
  THEME_RADIUS_OPTIONS,
  themeSaveSchema,
  tokensFromInput,
  type ThemeColorKey,
  type ThemeFont,
  type ThemeRadius,
} from "@/lib/panel/theme/schemas";
import { themeContrastReport } from "@/lib/theme/contrast-report";
import { themeVars } from "@/lib/theme/engine";
import { cn } from "@/lib/utils";
import ContrastReport from "./ContrastReport";
import CreateThemeDialog from "./CreateThemeDialog";
import ThemePreview from "./ThemePreview";
import ThemeStatusBadge, { themeStatusInfo } from "./ThemeStatusBadge";

/** Variable each color seed ends up in (for the "automatic" dark hints and AA badges). */
const VAR_OF: Record<ThemeColorKey, `--${string}`> = {
  brand: "--brand",
  accent: "--gold",
  background: "--bg",
  surface: "--surface",
  text: "--text",
};

const RADIUS_PX: Record<ThemeRadius, string> = { none: "0px", sm: "4px", md: "8px", lg: "14px", full: "9999px" };

const FONT_SAMPLE_STYLE: Record<ThemeFont, React.CSSProperties> = {
  cormorant: { fontFamily: 'var(--font-cormorant, Georgia), Georgia, "Times New Roman", serif' },
  manrope: { fontFamily: "var(--font-manrope, ui-sans-serif), ui-sans-serif, system-ui, sans-serif" },
};

function tokenKey(state: ThemeEditorState): string {
  return JSON.stringify({ colors: state.colors, dark: state.dark, radius: state.radius, fonts: state.fonts });
}

export default function ThemeEditor({ detail }: { detail: PanelThemeDetail }) {
  const router = useRouter();
  const form = usePanelForm<ThemeEditorState>(detail.state);
  const { state, setField, errorFor, formRef } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [copyOpen, setCopyOpen] = useState(false);
  const [busy, setBusy] = useState<"default" | "delete" | null>(null);

  // Color math runs on a deferred copy, so dragging the color picker stays smooth.
  const deferredKey = useDeferredValue(tokenKey(state));
  const { vars, report, darkMerged } = useMemo(() => {
    const parsed = JSON.parse(deferredKey) as Pick<ThemeEditorState, "colors" | "dark" | "radius" | "fonts">;
    const tokens = tokensFromInput(parsed);
    const v = themeVars(tokens);
    return { vars: v, report: themeContrastReport(tokens), darkMerged: { ...v.light, ...v.dark } };
  }, [deferredKey]);

  const title = state.name.trim() || "Adsız tema";
  const statusInfo = themeStatusInfo(detail.status);

  async function save() {
    await form.submit(saveThemeAction, {
      validate: themeSaveSchema,
      resetTo: (sent, data) => ({ ...sent, updatedAt: data?.updatedAt ?? sent.updatedAt }),
    });
  }

  async function runRef(kind: "default" | "delete") {
    const isDelete = kind === "delete";
    const ok = await confirm(
      isDelete
        ? {
            title: `“${form.saved.name}” silinsin mi?`,
            description:
              detail.campaigns.length > 0
                ? `Bu tema ${detail.campaigns.length} kampanyaya bağlı; silinince kampanyalar temasız devam eder. Bu işlem geri alınamaz.`
                : "Bu işlem geri alınamaz.",
            confirmLabel: "Temayı sil",
            tone: "danger",
          }
        : {
            title: `“${form.saved.name}” varsayılan yapılsın mı?`,
            description: form.saved.isScheduled
              ? "Planlı ya da kampanya teması yokken sitede bu tema gösterilir. Varsayılan tema planlanamadığı için bu temanın zamanlaması kapatılır."
              : "Planlı ya da kampanya teması yokken sitede bu tema gösterilir.",
            confirmLabel: "Varsayılan yap",
            tone: "default",
          },
    );
    if (!ok) return;
    setBusy(kind);
    try {
      const action = isDelete ? deleteThemeAction : setDefaultThemeAction;
      const result = await action(null, toPayloadFormData({ id: state.id, updatedAt: form.saved.updatedAt }));
      if (result.ok) {
        toast.success(result.message ?? "Kaydedildi.");
        if (isDelete) router.push("/panel/tema");
      } else {
        toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 } : undefined);
      }
    } catch {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  const lockedReason = form.dirty ? "Önce değişiklikleri kaydedin ya da vazgeçin." : undefined;

  return (
    <>
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="space-y-6 pb-28" noValidate>
      {/* Header */}
      <header className="space-y-4">
        <Link
          href="/panel/tema"
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Temalar
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">Tema & Renkler</p>
            <h1 className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 font-heading text-3xl font-medium leading-tight text-text sm:text-4xl">
              <span className="min-w-0 break-words">{title}</span>
              <span className="flex flex-wrap items-center gap-2 font-body">
                {detail.isDefault ? (
                  <Badge tone="gold" variant="soft">
                    Varsayılan
                  </Badge>
                ) : null}
                <ThemeStatusBadge status={detail.status} />
              </span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-text-muted">
              {statusInfo.detail}
              {detail.status.kind !== "live" && detail.live ? (
                <>
                  {" "}
                  Şu an sitede{" "}
                  <Link href={`/panel/tema/${detail.live.id}`} className="font-medium text-text underline-offset-4 hover:underline">
                    {detail.live.name}
                  </Link>{" "}
                  gösteriliyor.
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/tr" target="_blank" rel="noopener" className={buttonClass("ghost", "md")}>
              <ExternalLink aria-hidden className="size-4" />
              Sitede gör
            </a>
            <Button icon={Copy} onClick={() => setCopyOpen(true)}>
              Kopyala
            </Button>
            {!detail.isDefault ? (
              <>
                <Button icon={Star} onClick={() => runRef("default")} pending={busy === "default"} disabled={form.dirty || busy !== null} title={lockedReason}>
                  Varsayılan yap
                </Button>
                <Button
                  variant="danger-outline"
                  icon={Trash2}
                  onClick={() => runRef("delete")}
                  pending={busy === "delete"}
                  disabled={form.dirty || busy !== null}
                  title={lockedReason}
                >
                  Sil
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* Live preview: the storefront's own variables (themeVars), light and dark side by side */}
      <section
        aria-labelledby="theme-preview-title"
        className="rounded-xl border border-border bg-surface-2/60 p-3 sm:p-4 lg:[@media(min-height:58rem)]:sticky lg:[@media(min-height:58rem)]:top-[4.5rem] lg:[@media(min-height:58rem)]:z-10 lg:[@media(min-height:58rem)]:shadow-[0_8px_24px_-12px_rgb(3_38_95/0.25)]"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 id="theme-preview-title" className="font-body text-sm font-semibold text-text">
            Canlı önizleme
          </h2>
          <p className="text-xs text-text-muted">Kaydetmeden önce sitedeki görünüm. Kaydedince bir sonraki ziyarette sitede.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1.5 px-1 text-xs font-medium text-text-muted">Açık</p>
            <ThemePreview vars={vars.light} mode="light" />
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 px-1 text-xs font-medium text-text-muted">Koyu</p>
            <ThemePreview vars={darkMerged} mode="dark" />
          </div>
        </div>
      </section>

      <Card title="Genel">
        <Field label="Tema adı" required error={errorFor("name")} name="name" help="Yalnızca panelde görünür.">
          <TextInput value={state.name} onChange={(v) => setField("name", v)} maxLength={60} autoComplete="off" />
        </Field>
      </Card>

      {/* Colors: light and dark per role */}
      <Card
        title="Renkler"
        description="Açık görünüm renklerini seçin; koyu görünüm bunlardan otomatik türetilir. İsterseniz koyu görünüm için ayrı renk verin."
      >
        <div className="divide-y divide-border">
          {THEME_COLOR_KEYS.map((key) => {
            const meta = THEME_COLOR_LABELS[key];
            const fill = key === "brand" || key === "accent";
            const lightAgainst = key === "text" ? vars.light["--bg"] : vars.light["--text"];
            const darkAgainst = key === "text" ? darkMerged["--bg"] : darkMerged["--text"];
            const againstLabel = key === "text" ? "arka plan" : "metin rengi";
            return (
              <div key={key} className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,1fr)] md:gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{meta.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{meta.help}</p>
                </div>
                <Field label="Açık görünüm" required error={errorFor(`colors.${key}`)} name={`colors.${key}`}>
                  <ColorInput
                    value={state.colors[key]}
                    onChange={(hex) => setField(`colors.${key}`, hex)}
                    usage={fill ? "fill" : "text"}
                    against={lightAgainst}
                    againstLabel={againstLabel}
                  />
                </Field>
                <Field
                  label="Koyu görünüm"
                  optional
                  error={errorFor(`dark.${key}`)}
                  name={`dark.${key}`}
                  help={
                    state.dark[key] ? (
                      <button
                        type="button"
                        onClick={() => setField(`dark.${key}`, "")}
                        className="rounded underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        Otomatiğe dön
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        Otomatik:
                        <span aria-hidden className="inline-block size-3 rounded-sm shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: darkMerged[VAR_OF[key]] }} />
                        <span className="font-mono uppercase">{darkMerged[VAR_OF[key]]}</span>
                      </span>
                    )
                  }
                >
                  <ColorInput
                    value={state.dark[key]}
                    onChange={(hex) => setField(`dark.${key}`, hex)}
                    usage={fill ? "fill" : "text"}
                    against={darkAgainst}
                    againstLabel={againstLabel}
                    allowEmpty
                    placeholder="Otomatik"
                  />
                </Field>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Yazı tipi ve köşeler" description="Yalnızca sitede yüklü yazı tipleri sunulur; yavaşlatan ek yazı tipi yüklenmez.">
        <div className="grid gap-6 md:grid-cols-2">
          {(["heading", "body"] as const).map((slot) => (
            <Field
              key={slot}
              label={slot === "heading" ? "Başlık yazı tipi" : "Metin yazı tipi"}
              error={errorFor(`fonts.${slot}`)}
              name={`fonts.${slot}`}
            >
              <Select
                value={state.fonts[slot]}
                onChange={(v) => setField(`fonts.${slot}`, v)}
                options={THEME_FONT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <p
                className={cn("mt-2 truncate rounded-lg border border-border bg-bg px-3 py-2 text-text", slot === "heading" ? "text-2xl" : "text-sm")}
                style={FONT_SAMPLE_STYLE[state.fonts[slot]]}
                aria-hidden
              >
                {slot === "heading" ? "Kayseri’den zarafet" : "Bitkisel özlerle hazırlanan sıvı sabunlar."}
              </p>
            </Field>
          ))}
        </div>
        <fieldset className="mt-6 min-w-0">
          <legend className="text-sm font-medium text-text">Köşe stili</legend>
          <p className="mt-1 text-xs text-text-muted">Butonlar, kartlar ve görsellerin köşeleri.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {THEME_RADIUS_OPTIONS.map((option) => {
              const checked = state.radius === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "relative flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border px-3 py-3 text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    checked ? "border-brand bg-brand/[0.06] text-text" : "border-border text-text-muted hover:border-border-strong",
                  )}
                >
                  <input
                    type="radio"
                    name="theme-radius"
                    value={option.value}
                    checked={checked}
                    onChange={() => setField("radius", option.value)}
                    className="sr-only"
                  />
                  <span aria-hidden className="h-7 w-16 border border-current bg-surface-2" style={{ borderRadius: RADIUS_PX[option.value] }} />
                  <span className={cn(checked && "font-medium text-text")}>{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="mt-5 text-xs leading-relaxed text-text-muted">
          Arapça sayfalarda okunabilirlik için her zaman Noto Naskh Arabic (başlık) ve IBM Plex Sans Arabic (metin) kullanılır.
        </p>
      </Card>

      <Card title="Zamanlama" description="Dönemsel temalar belirlenen tarihlerde kendiliğinden açılır ve kapanır.">
        {detail.isDefault ? (
          <Notice>
            Bu tema varsayılan: planlı ya da kampanyaya bağlı bir tema yokken sitede gösterilir. Varsayılan tema planlanamaz; dönemsel bir görünüm için{" "}
            <button type="button" className="font-medium underline underline-offset-4" onClick={() => setCopyOpen(true)}>
              kopyasını oluşturun
            </button>
            .
          </Notice>
        ) : (
          <div className="space-y-6">
            <div data-field="isScheduled" className="space-y-1.5">
              <Switch
                checked={state.isScheduled}
                onChange={(v) => setField("isScheduled", v)}
                label="Belirli tarihlerde otomatik yayınla"
                description="Açıkken tema, aşağıdaki aralıkta sitede kendiliğinden gösterilir (Türkiye saatiyle)."
                invalid={Boolean(errorFor("isScheduled"))}
              />
              {errorFor("isScheduled") ? <p className={errorClass}>{errorFor("isScheduled")}</p> : null}
            </div>
            <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]", !state.isScheduled && "opacity-60")}>
              <ScheduleInput
                label="Yayın aralığı"
                value={state.schedule}
                onChange={(v) => setField("schedule", v)}
                error={form.errorsUnder("schedule")}
                requireStart={state.isScheduled}
                requireEnd={state.isScheduled}
                help="Saatler Türkiye saatiyle (GMT+3). Planlı temalar için başlangıç ve bitiş zorunludur."
                name="schedule"
              />
              <Field
                label="Öncelik"
                error={errorFor("priority")}
                name="priority"
                help="Aynı anda birden fazla tema geçerliyse önceliği yüksek olan gösterilir; eşitse en son başlayan."
              >
                <NumberInput
                  value={state.priority}
                  onChange={(v) => setField("priority", v ?? 0)}
                  min={0}
                  max={THEME_PRIORITY_MAX}
                  nullable={false}
                />
              </Field>
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-border pt-5">
          <p className="flex items-center gap-2 text-sm font-medium text-text">
            <Megaphone aria-hidden className="size-4 text-text-muted" />
            Bağlı kampanyalar
          </p>
          {detail.campaigns.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {detail.campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="font-medium text-text">{c.name}</span>
                  <span className="text-xs text-text-muted">
                    {c.startsAt ? formatIstanbul(c.startsAt) : "Hemen"} – {c.endsAt ? formatIstanbul(c.endsAt) : "süresiz"}
                  </span>
                  {!c.isActive ? (
                    <Badge size="sm" tone="neutral">
                      Pasif
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Bu tema bir kampanyaya bağlı değil. Kampanya düzenlerken tema seçerseniz, kampanya süresince bu tema kendiliğinden gösterilir.
            </p>
          )}
          <Link href="/panel/kampanyalar" className="mt-3 inline-flex text-xs font-medium text-text underline-offset-4 hover:underline">
            Kampanyalara git
          </Link>
        </div>
      </Card>

      <Card
        title="Kontrast raporu"
        description="Sitedeki gerçek renk çiftleri; normal metin için WCAG AA en az 4,5:1, odak halkası ve kenarlık için 3:1 ister."
        action={
          <Badge tone={report.passed === report.total ? "success" : "warning"}>
            {report.passed}/{report.total} çift geçti
          </Badge>
        }
      >
        <ContrastReport report={report} />
      </Card>

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={() => void save()}
        savedNote={`Son kayıt: ${formatIstanbul(form.saved.updatedAt)}`}
      />
    </form>
    {/* Outside the editor <form>: the dialog has its own form. */}
    <CreateThemeDialog open={copyOpen} onClose={() => setCopyOpen(false)} source={{ id: state.id, name: form.saved.name }} />
    {confirmDialog}
    </>
  );
}
