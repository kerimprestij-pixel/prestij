"use client";
// Customer-group checkboxes (none ticked = everyone). Native checkboxes in a fieldset: keyboard and
// screen-reader friendly without extra ARIA.
import { Check } from "lucide-react";
import { errorClass, helpClass, labelClass } from "@/components/panel/ui";
import { cn } from "@/lib/utils";

export type GroupOption = { id: number; name: string; isBusiness: boolean; discountPercent: number };

export default function GroupChecklist({
  legend,
  help,
  error,
  groups,
  value,
  onChange,
  name,
}: {
  legend: string;
  help?: React.ReactNode;
  error?: string;
  groups: readonly GroupOption[];
  value: readonly number[];
  onChange: (ids: number[]) => void;
  /** Form path, so a server error focuses the first checkbox. */
  name?: string;
}) {
  const toggle = (id: number, on: boolean) => onChange(on ? [...value.filter((v) => v !== id), id] : value.filter((v) => v !== id));
  const helpId = name ? `${name}-help` : undefined;
  const errorId = name ? `${name}-error` : undefined;
  return (
    <fieldset className="min-w-0" aria-describedby={[help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}>
      <legend className={labelClass}>{legend}</legend>
      {help ? (
        <p id={helpId} className={cn("mt-1", helpClass)}>
          {help}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Henüz müşteri grubu yok.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {groups.map((g, i) => {
            const checked = value.includes(g.id);
            return (
              <label
                key={g.id}
                className={cn(
                  "relative inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  checked ? "border-brand bg-brand/5 text-text" : "border-border bg-surface text-text-muted hover:border-text/30 hover:text-text",
                  error && "border-[#B3261E]/60 dark:border-[#F28B82]/60",
                )}
              >
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={checked}
                  name={i === 0 ? name : undefined}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => toggle(g.id, e.target.checked)}
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 place-items-center rounded border transition-colors",
                    checked ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface",
                  )}
                >
                  {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className="font-medium text-text">{g.name}</span>
                {g.isBusiness || g.discountPercent > 0 ? (
                  <span className="text-xs text-text-muted">
                    {[g.isBusiness ? "Kurumsal" : null, g.discountPercent > 0 ? `grup indirimi %${g.discountPercent}` : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
      {error ? (
        <p id={errorId} className={cn("mt-2", errorClass)}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
