// AA pass/fail per color pair for light and dark, from themeContrastReport (the storefront's own
// variables). Pure (no hooks).
import { Check, Info, X } from "lucide-react";
import type { ContrastCheck, ThemeContrastReport, ThemeModeReport } from "@/lib/theme/contrast-report";
import { cn } from "@/lib/utils";

const ratioText = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}:1`;

function CheckRow({ check }: { check: ContrastCheck }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden
        className="grid h-8 w-10 shrink-0 place-items-center rounded-md text-sm font-semibold shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
        style={{ background: check.bg, color: check.fg }}
      >
        Aa
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text">{check.label}</span>
        <span className="block truncate text-xs text-text-muted">{check.usage}</span>
      </span>
      <span className="shrink-0 text-end">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            check.pass ? "border-[#2F8F5B]/30 bg-[#2F8F5B]/10 text-text" : "border-[#C2413A]/30 bg-[#C2413A]/10 text-text",
          )}
        >
          {check.pass ? (
            <Check aria-hidden className="size-3.5 text-[#2F8F5B] dark:text-[#5CC08A]" />
          ) : (
            <X aria-hidden className="size-3.5 text-[#B3261E] dark:text-[#F28B82]" />
          )}
          {check.pass ? "Geçti" : "Yetersiz"}
        </span>
        <span className="mt-0.5 block text-[0.6875rem] tabular-nums text-text-muted">
          {ratioText(check.ratio)} <span className="sr-only">kontrast,</span>en az {ratioText(check.min)}
        </span>
      </span>
    </li>
  );
}

function ModeColumn({ title, report }: { title: string; report: ThemeModeReport }) {
  const failed = report.checks.filter((c) => !c.pass).length;
  return (
    <section className="min-w-0">
      <h3 className="flex items-center justify-between gap-2 font-body text-sm font-semibold text-text">
        {title}
        <span className={cn("text-xs font-medium", failed ? "text-[#B3261E] dark:text-[#F28B82]" : "text-text-muted")}>
          {failed ? `${failed} çift yetersiz` : "Tüm çiftler AA"}
        </span>
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {report.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
      {report.adjustments.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {report.adjustments.map((a) => (
            <li key={a.id} className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-muted">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-text" />
              <span>
                <span className="font-medium text-text">{a.label}</span> okunabilirlik için{" "}
                <Swatch hex={a.chosen} /> yerine <Swatch hex={a.used} /> olarak kullanılıyor.
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[0.6875rem] uppercase text-text">
      <span aria-hidden className="inline-block size-2.5 rounded-sm shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: hex }} />
      {hex}
    </span>
  );
}

export default function ContrastReport({ report }: { report: ThemeContrastReport }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ModeColumn title="Açık görünüm" report={report.light} />
      <ModeColumn title="Koyu görünüm" report={report.dark} />
    </div>
  );
}
