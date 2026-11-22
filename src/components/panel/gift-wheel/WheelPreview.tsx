"use client";
// Live preview of the gift wheel for the Ayarlar tab: the storefront's own SVG wheel (WheelGraphic, the
// same component the dialog uses) drawn from the unsaved form state, in TR/EN/AR (Arabic right-to-left),
// with each slice's chance in percent. "Deneme çevirişi" spins the preview to a slice picked by the
// current weights; nothing is sent or stored (the real result is always chosen by the server).
import { useEffect, useRef, useState } from "react";
import { Gift } from "lucide-react";
import WheelGraphic, { WHEEL_TONE_COLORS } from "@/components/store/wheel/WheelGraphic";
import { landingRotation } from "@/components/store/wheel/wheel-geometry";
import { format } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { formatShare, TONE_LABELS } from "@/lib/panel/gift-wheel/labels";
import { weightTotal } from "@/lib/panel/gift-wheel/slices";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";
import { wheelDisplaySlices, wheelSliceShares, wheelText, type GiftWheelSettings, type GiftWheelTextKey } from "@/lib/wheel/types";

/** Storefront texts the preview needs, per locale (the dictionary defaults, already with panel UI-string overrides). */
export type WheelPreviewCopy = {
  texts: Record<GiftWheelTextKey, string>;
  spin: string;
  everySliceWins: string;
  /** Automatic prize names (wheel.prize) for slices without a label in that language, as the storefront shows them. */
  prize: { percent: string; fixed: string; freeShipping: string };
};

const LOCALES: { value: Locale; short: string; name: string; dir: "ltr" | "rtl" }[] = [
  { value: "tr", short: "TR", name: "Türkçe", dir: "ltr" },
  { value: "en", short: "EN", name: "İngilizce", dir: "ltr" },
  { value: "ar", short: "AR", name: "Arapça", dir: "rtl" },
];

const SPIN_MS = 4500;

type Demo = { rotation: number; duration: number; index: number | null; spinning: boolean; signature: string };

export default function WheelPreview({
  slices,
  texts,
  copy,
}: {
  slices: GiftWheelSettings["slices"];
  texts: GiftWheelSettings["texts"];
  copy: Record<Locale, WheelPreviewCopy>;
}) {
  const [locale, setLocale] = useState<Locale>("tr");
  const [demo, setDemo] = useState<Demo>({ rotation: 0, duration: 0, index: null, spinning: false, signature: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const meta = LOCALES.find((l) => l.value === locale) ?? LOCALES[0];
  const prizeNames = copy[locale].prize;
  // A slice without an en/ar label shows the automatic prize name there, exactly like the storefront.
  const display = wheelDisplaySlices(slices, locale, (s) =>
    s.type === "free_shipping"
      ? prizeNames.freeShipping
      : s.type === "fixed"
        ? format(prizeNames.fixed, { amount: formatPrice(s.value, locale) }, locale)
        : format(prizeNames.percent, { value: s.value }, locale),
  );
  const shares = wheelSliceShares(slices);
  const total = weightTotal(slices);
  const signature = slices.map((s) => `${s.key}:${s.tone}`).join("|");
  const result = demo.signature === signature && demo.index !== null ? demo.index : null;
  const localeCopy = copy[locale];
  const text = (key: GiftWheelTextKey) => wheelText(texts[key], locale, localeCopy.texts[key]);
  const canSpin = slices.length >= 2 && total > 0 && !demo.spinning;

  const spin = () => {
    if (!canSpin) return;
    let r = Math.random() * total;
    let index = slices.length - 1;
    for (let i = 0; i < slices.length; i++) {
      r -= Math.max(0, slices[i].weight);
      if (r < 0) {
        index = i;
        break;
      }
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : SPIN_MS;
    const rotation = landingRotation(index, slices.length, { from: demo.rotation, turns: reduce ? 0 : 5 });
    setDemo({ rotation, duration, index: null, spinning: true, signature });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDemo((d) => ({ ...d, index, spinning: false })), duration);
  };

  return (
    <section aria-labelledby="wheel-preview-title" className="min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 id="wheel-preview-title" className="text-[0.9375rem] font-semibold text-text">
            Canlı önizleme
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">Kaydetmeden önce değişiklikleri burada görün.</p>
        </div>
        <div role="group" aria-label="Önizleme dili" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2/70 p-0.5">
          {LOCALES.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={l.value === locale}
              title={l.name}
              onClick={() => setLocale(l.value)}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-[0.6875rem] font-semibold tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring motion-reduce:transition-none",
                l.value === locale ? "bg-surface text-text shadow-[0_1px_2px_rgb(3_38_95/0.08)]" : "text-text-muted hover:text-text",
              )}
            >
              {l.short}
              <span className="sr-only"> ({l.name})</span>
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-5 px-5 py-5">
        {/* The dialog as visitors see it, in the chosen language and direction. */}
        <div lang={locale} dir={meta.dir} className="rounded-xl border border-border bg-bg px-4 py-5 text-center">
          <p className="font-heading text-xl leading-tight text-text">{text("title")}</p>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-text-muted">{text("subtitle")}</p>
          {/* Decorative here: the slices and their chances are listed as text below. */}
          <div className="mx-auto mt-4 aspect-square w-full max-w-[15rem]">
            <WheelGraphic slices={display} rotation={demo.rotation} spinDurationMs={demo.duration} highlightIndex={result} dir={meta.dir} />
          </div>
          <button
            type="button"
            onClick={spin}
            disabled={!canSpin}
            aria-describedby="wheel-preview-demo-note"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-brand px-6 text-sm font-medium text-brand-contrast transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {localeCopy.spin}
          </button>
          <p className="mx-auto mt-3 max-w-xs text-[0.6875rem] leading-relaxed text-text-muted">{localeCopy.everySliceWins}</p>
        </div>

        <p id="wheel-preview-demo-note" className="text-xs leading-relaxed text-text-muted">
          Düğme bir deneme çevirişi yapar: dilim, girdiğiniz ağırlıklara göre seçilir. Hiçbir şey kaydedilmez; sitede sonucu her zaman sunucu belirler.
        </p>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-text">
          {demo.spinning ? (
            "Çark dönüyor…"
          ) : result !== null ? (
            <>
              Deneme sonucu:{" "}
              <bdi lang={locale} dir={meta.dir} className="font-medium">
                {display[result]?.label ?? ""}
              </bdi>
            </>
          ) : null}
        </p>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Kazanma olasılıkları</h4>
          <ul className="mt-3 space-y-2.5">
            {slices.map((slice, i) => {
              const tone = WHEEL_TONE_COLORS[slice.tone] ?? WHEEL_TONE_COLORS.brand;
              const label = display[i]?.label || "—";
              const fallback = locale !== "tr" && !slice.label[locale]?.trim();
              return (
                <li key={`${slice.key}-${i}`} className={cn("rounded-lg px-2 py-1.5", result === i && "bg-gold/10")}>
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-3.5 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: tone.fill }}
                      title={TONE_LABELS[slice.tone]}
                    />
                    <span lang={locale} dir={meta.dir} className="min-w-0 flex-1 truncate text-sm text-text">
                      {label}
                    </span>
                    {fallback ? <span className="shrink-0 text-[0.6875rem] text-text-muted">TR metni</span> : null}
                    <span className="shrink-0 text-sm font-medium tabular-nums text-text">{formatShare(shares[i] ?? 0)}</span>
                  </div>
                  <span aria-hidden className="ms-6 mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, shares[i] ?? 0)}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            Toplam ağırlık: <span className="tabular-nums">{total}</span>
            {total === 100 ? " · her ağırlık doğrudan yüzdeye eşit." : ". Yüzdeler ağırlıkların toplama oranıdır."}
          </p>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Sitedeki çark düğmesi</h4>
          <div lang={locale} dir={meta.dir} className="mt-3">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-gold/50 bg-surface px-4 py-2 text-sm font-medium text-text shadow-[0_6px_20px_-12px_rgb(3_38_95/0.45)]">
              <Gift aria-hidden className="size-4 shrink-0 text-gold-text" />
              <span className="truncate">{text("teaser")}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
