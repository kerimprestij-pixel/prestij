"use client";
// Product color: the product page, its buttons and highlights take this color. Live palette and a
// light/dark preview built with the storefront's own theme engine (productScopeVars + themeVars).
import type { CSSProperties } from "react";
import ColorInput from "@/components/panel/form/ColorInput";
import Field from "@/components/panel/form/Field";
import { DEFAULT_THEME_TOKENS } from "@/lib/theme/defaults";
import { buildPalette, contrastRatio, normalizeHex, PALETTE_STEPS, productScopeVars, themeVars } from "@/lib/theme/engine";
import { Section, Warning, type TabProps } from "./shared";

const BASE = themeVars(DEFAULT_THEME_TOKENS);

function previewStyle(mode: "light" | "dark", accent: string | null, tint: string, tintDark: string): CSSProperties {
  const theme = BASE[mode];
  const style: Record<string, string> = { ...theme };
  if (accent) {
    const p = productScopeVars(accent, { tint: tint || null, dark: tintDark || null });
    if (mode === "light") {
      Object.assign(style, { "--product": p["--p-base"], "--product-contrast": p["--p-contrast"], "--product-soft": p["--p-soft"], "--product-strong": p["--p-strong"] });
    } else {
      Object.assign(style, { "--product": p["--p-base-dark"], "--product-contrast": p["--p-contrast-dark"], "--product-soft": p["--p-soft-dark"], "--product-strong": p["--p-strong-dark"] });
    }
  } else {
    Object.assign(style, { "--product": theme["--gold"], "--product-contrast": theme["--gold-contrast"] });
  }
  return style as CSSProperties;
}

function Preview({ mode, accent, tint, tintDark, name, subtitle }: { mode: "light" | "dark"; accent: string | null; tint: string; tintDark: string; name: string; subtitle: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-xs font-medium text-text-muted">{mode === "light" ? "Açık tema" : "Koyu tema"}</figcaption>
      <div style={previewStyle(mode, accent, tint, tintDark)} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]">
        <div className="bg-[var(--product-soft)] px-5 py-6">
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-[var(--product-strong)]">{subtitle || "Sıvı El Sabunu"}</p>
          <p className="mt-1 font-heading text-2xl leading-tight">{name || "Ürün adı"}</p>
          <p className="mt-3 text-sm tabular-nums">
            149,90 ₺ <span className="ms-1 text-xs text-[var(--text-muted)] line-through">179,90 ₺</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center rounded-full bg-[var(--product)] px-4 text-xs font-semibold text-[var(--product-contrast)]">Sepete ekle</span>
            <span className="inline-flex h-9 items-center rounded-full border border-[var(--product)] px-4 text-xs font-medium text-[var(--product-strong)]">500 ml</span>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-xs text-[var(--text-muted)]">
          <span aria-hidden className="size-2 rounded-full bg-[var(--product)]" />
          Ücretsiz kargo · 2-3 iş günü
        </div>
      </div>
    </figure>
  );
}

export default function AppearanceTab({ form }: TabProps) {
  const { state, setField, errorFor } = form;
  const accent = normalizeHex(state.accentColor);
  const palette = accent ? buildPalette(accent) : null;
  const tintContrast = state.tint && normalizeHex(state.tint) ? contrastRatio(state.tint, BASE.light["--text"]) : null;
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="min-w-0 space-y-6 xl:col-span-2">
        <Section title="Ürün rengi" description="Ürün sayfası, butonlar ve vurgular bu rengi alır (etiketteki renk). Boş bırakılırsa marka altını kullanılır.">
          <Field label="Vurgu rengi" error={errorFor("accentColor")} name="accentColor">
            <ColorInput value={state.accentColor} onChange={(v) => setField("accentColor", v)} allowEmpty usage="fill" placeholder="#C2ADD1" />
          </Field>
          {palette ? (
            <div>
              <p className="text-xs font-medium text-text-muted">Türetilen palet</p>
              <ol className="mt-2 grid grid-cols-11 overflow-hidden rounded-lg border border-border" aria-label="Renk paleti">
                {PALETTE_STEPS.map((step) => (
                  <li key={step} title={`${step}: ${palette[step]}`} className="h-8" style={{ backgroundColor: palette[step] }}>
                    <span className="sr-only">
                      {step}: {palette[step]}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-1 grid grid-cols-11 text-center text-[0.5625rem] tabular-nums text-text-muted" aria-hidden>
                {PALETTE_STEPS.map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
        <Section title="İnce ayar" description="Ürün sayfasının yumuşak arka planı normalde vurgu renginden türetilir. Gerekirse buradan değiştirin.">
          <Field label="Açık temada arka plan tonu" error={errorFor("tint")} name="tint" help="Boş: paletin 100 tonu.">
            <ColorInput value={state.tint} onChange={(v) => setField("tint", v)} allowEmpty placeholder={palette ? palette[100] : "#F4EEE2"} />
          </Field>
          {tintContrast !== null && tintContrast < 4.5 ? <Warning>Bu ton üzerinde metin okunurluğu düşük (kontrast {tintContrast.toFixed(1)}:1).</Warning> : null}
          <Field label="Koyu temada arka plan tonu" error={errorFor("tintDark")} name="tintDark" help="Boş: paletin 950 tonu.">
            <ColorInput value={state.tintDark} onChange={(v) => setField("tintDark", v)} allowEmpty against={BASE.dark["--bg"]} againstLabel="Koyu arka plan" placeholder={palette ? palette[950] : "#2A2112"} />
          </Field>
        </Section>
      </div>
      <div className="min-w-0 xl:col-span-3">
        <Section title="Önizleme" description="Mağazadaki ürün sayfasının renkleri; kaydedince yayına yansır.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Preview mode="light" accent={accent} tint={state.tint} tintDark={state.tintDark} name={state.name.tr} subtitle={state.subtitle?.tr ?? ""} />
            <Preview mode="dark" accent={accent} tint={state.tint} tintDark={state.tintDark} name={state.name.tr} subtitle={state.subtitle?.tr ?? ""} />
          </div>
        </Section>
      </div>
    </div>
  );
}
