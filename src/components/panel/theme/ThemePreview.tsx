// Miniature storefront (announcement, header, hero copy with buttons, product card with price and
// badge, a stock note) painted with the CSS variables the theme engine generates — the same
// themeVars() output <ThemeStyle/> puts on the storefront. No `dark:` utilities and no global
// `.dark` helpers inside: each preview carries its own variables, so the light preview stays light
// even when the panel itself is dark (and vice versa). Pure (no hooks).
import type { CSSProperties } from "react";
import { Menu, Search, ShoppingBag } from "lucide-react";
import { CrownMark } from "@/components/store/BrandIcons";
import type { ThemeVarMap } from "@/lib/theme/engine";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";

type ThemePreviewProps = {
  /** themeVars(tokens).light, or { ...light, ...dark } for the dark preview. */
  vars: ThemeVarMap;
  mode: "light" | "dark";
  className?: string;
};

const spaced = "uppercase tracking-[0.14em]";

export default function ThemePreview({ vars, mode, className }: ThemePreviewProps) {
  const dark = mode === "dark";
  const style = { ...vars, colorScheme: mode } as CSSProperties;
  // The storefront pins navy surfaces (".dark .surface-inverse") in dark mode; mirrored inline here.
  const inverse = (dark ? { "--brand": "var(--brand-900)", "--brand-contrast": "#ffffff" } : {}) as CSSProperties;

  return (
    <figure
      style={style}
      data-preview={mode}
      className={cn("m-0 min-w-0 overflow-hidden rounded-xl border border-border bg-bg font-body text-text shadow-[0_1px_2px_rgb(3_38_95/0.06)]", className)}
    >
      <figcaption className="sr-only">{dark ? "Koyu görünüm önizlemesi" : "Açık görünüm önizlemesi"}</figcaption>

      {/* Announcement bar ("brand" variant) */}
      <div style={inverse} className="bg-brand px-3 py-1.5 text-center text-[0.6875rem] leading-snug text-brand-contrast">
        <span className="underline decoration-current/40 underline-offset-2">Yeni sezon kokuları şimdi sitede</span>
      </div>

      {/* Header */}
      <div className="flex h-12 items-center justify-between gap-2 border-b border-border bg-bg px-3">
        <span className="grid size-8 place-items-center rounded-full text-text">
          <Menu aria-hidden className="size-4" strokeWidth={1.5} />
        </span>
        <span className="inline-flex flex-col items-center leading-none">
          <CrownMark className="mb-1 h-2 w-auto text-gold" />
          <span className={cn("-me-[0.3em] font-heading text-base font-semibold tracking-[0.3em]", dark ? "text-text" : "text-brand")}>PRESTİJ</span>
        </span>
        <span className="flex items-center">
          <span className="grid size-8 place-items-center rounded-full text-text">
            <Search aria-hidden className="size-4" strokeWidth={1.5} />
          </span>
          <span className="relative grid size-8 place-items-center rounded-full text-text">
            <ShoppingBag aria-hidden className="size-4" strokeWidth={1.5} />
            <span className="absolute -end-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-gold px-0.5 text-[0.5625rem] font-semibold leading-none text-gold-contrast tabular-nums">
              2
            </span>
          </span>
        </span>
      </div>

      {/* Hero copy + buttons */}
      <div className="px-4 pb-4 pt-5">
        <p className="eyebrow text-[0.625rem]">Yeni sezon</p>
        <p className="mt-1.5 font-heading text-[1.6rem] font-medium leading-tight text-text">Kayseri’den zarafet</p>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">Bitkisel özlerle hazırlanan sıvı sabun ve duş jelleri.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className={cn("inline-flex min-h-9 items-center rounded-control bg-brand px-4 text-[0.6875rem] font-medium text-brand-contrast", spaced)}>
            Alışverişe başla
          </span>
          <span className={cn("inline-flex min-h-9 items-center rounded-control border border-text/25 px-4 text-[0.6875rem] font-medium text-text", spaced)}>
            Numune iste
          </span>
        </div>
      </div>

      {/* Product card */}
      <div className="mx-4 mb-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-lg border border-border bg-surface p-2.5">
        <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-surface-2">
          <svg viewBox="0 0 40 50" aria-hidden className="absolute inset-0 m-auto h-[78%] w-auto">
            <rect x="16.5" y="3" width="7" height="5" rx="1" fill="var(--brand)" />
            <rect x="18.5" y="8" width="3" height="4" fill="var(--brand)" />
            <path d="M12 16c0-2.2 1.8-4 4-4h8c2.2 0 4 1.8 4 4v28c0 1.7-1.3 3-3 3H15c-1.7 0-3-1.3-3-3z" fill="var(--gold-200)" />
            <rect x="14.5" y="24" width="11" height="12" rx="1" fill="var(--surface)" opacity="0.9" />
            <rect x="16.5" y="27" width="7" height="1.2" rx="0.6" fill="var(--brand)" />
            <rect x="17.5" y="30" width="5" height="0.8" rx="0.4" fill="var(--gold-text)" />
          </svg>
          <span className="absolute start-1.5 top-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[0.5625rem] font-semibold leading-none text-gold-contrast">
            %15
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="eyebrow truncate text-[0.5625rem]">Sıvı el sabunu</p>
          <p className="mt-0.5 truncate font-heading text-lg leading-tight text-text">Lavanta Latte</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <span className="font-medium tabular-nums text-text">{formatPrice(12740, "tr")}</span>
            <s className="tabular-nums text-text-muted">{formatPrice(14990, "tr")}</s>
          </p>
          <span
            className={cn(
              "mt-auto inline-flex min-h-8 items-center justify-center rounded-control bg-product px-3 text-[0.625rem] font-medium text-product-contrast",
              spaced,
            )}
          >
            Sepete ekle
          </span>
        </div>
      </div>

      {/* Stock / info note */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2 px-4 py-2 text-[0.6875rem]">
        <span className="text-text-muted">Kargoda 1–2 iş günü</span>
        <span className="rounded-full bg-product-soft px-2 py-0.5 font-medium text-product-strong">Son 3 adet</span>
      </div>
    </figure>
  );
}
