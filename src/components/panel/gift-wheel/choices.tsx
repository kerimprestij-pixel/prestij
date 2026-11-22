"use client";
// Radio choices of the wheel settings: the slice colour (swatches) and the audience (cards with an
// explanation). Native radio groups: arrow keys move between options, the legend names the group.
import { useId } from "react";
import { CircleExclamationPoint } from "lucide-react";
import { WHEEL_TONE_COLORS } from "@/components/store/wheel/WheelGraphic";
import { errorClass, labelClass } from "@/components/panel/ui/styles";
import { AUDIENCE_LABELS, TONE_OPTIONS } from "@/lib/panel/gift-wheel/labels";
import { WHEEL_AUDIENCES, type WheelAudience, type WheelTone } from "@/lib/settings/types";
import { cn } from "@/lib/utils";

function ErrorLine({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className={cn(errorClass, "mt-1.5 flex items-start gap-1.5")}>
      <CircleExclamationPoint aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

const optionClass =
  "relative flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface text-sm text-text transition-colors hover:border-gold/50 has-checked:border-brand has-checked:bg-surface-2/60 has-checked:ring-1 has-checked:ring-brand has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring motion-reduce:transition-none";

export function TonePicker({
  value,
  onChange,
  name,
  error,
  legend = "Renk",
}: {
  value: WheelTone;
  onChange: (tone: WheelTone) => void;
  name: string;
  error?: string;
  legend?: string;
}) {
  const id = useId();
  return (
    <fieldset data-field={name} className="min-w-0" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className={labelClass}>{legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {TONE_OPTIONS.map((tone) => {
          const colors = WHEEL_TONE_COLORS[tone.value];
          return (
            <label key={tone.value} className={cn(optionClass, "px-2.5 py-1.5")}>
              <input
                type="radio"
                name={`${id}-tone`}
                value={tone.value}
                checked={value === tone.value}
                onChange={() => onChange(tone.value)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full border border-border text-[0.5625rem] font-bold"
                style={{ backgroundColor: colors.fill, color: colors.text }}
              >
                A
              </span>
              {tone.label}
            </label>
          );
        })}
      </div>
      <ErrorLine id={`${id}-error`} message={error} />
    </fieldset>
  );
}

export function AudiencePicker({
  value,
  onChange,
  name,
  error,
}: {
  value: WheelAudience;
  onChange: (audience: WheelAudience) => void;
  name: string;
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset data-field={name} className="min-w-0" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className={labelClass}>Kimler çevirebilir?</legend>
      <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
        {WHEEL_AUDIENCES.map((audience) => {
          const meta = AUDIENCE_LABELS[audience];
          return (
            <label key={audience} className={cn(optionClass, "items-start px-3.5 py-3")}>
              <input
                type="radio"
                name={`${id}-audience`}
                value={audience}
                checked={value === audience}
                onChange={() => onChange(audience)}
                aria-describedby={`${id}-${audience}-desc`}
                className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0">
                <span className="block font-medium">{meta.label}</span>
                <span id={`${id}-${audience}-desc`} className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {meta.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <ErrorLine id={`${id}-error`} message={error} />
    </fieldset>
  );
}
