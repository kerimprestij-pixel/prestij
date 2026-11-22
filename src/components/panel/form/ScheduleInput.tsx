"use client";
import { useId } from "react";
import { CalendarClock, X } from "lucide-react";
import { controlGroupClass, errorClass, groupInputClass, helpClass, iconButtonClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { formatIstanbul, istanbulDateTimeLocal, parseIstanbulDateTimeLocal } from "@/lib/panel/format";

export type ScheduleFieldValue = {
  /** ISO timestamp (UTC) or null = starts immediately. */
  startsAt: string | null;
  /** ISO timestamp (UTC) or null = no end. */
  endsAt: string | null;
};

export type ScheduleInputProps = {
  value: ScheduleFieldValue | null | undefined;
  onChange: (value: ScheduleFieldValue) => void;
  /** Group label (legend), e.g. "Yayın zamanı". */
  label?: React.ReactNode;
  help?: React.ReactNode;
  /** One message, or per side from dotted field errors ({ endsAt: "…" }). */
  error?: string | { startsAt?: string; endsAt?: string } | null;
  startLabel?: string;
  endLabel?: string;
  /** Require a start time (mark only; the server validates). */
  requireStart?: boolean;
  requireEnd?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
};

/** Start/end in Istanbul time (two datetime-local inputs); checks that the end is after the start. */
export default function ScheduleInput({
  value,
  onChange,
  label,
  help = "Saatler Türkiye saatiyle (GMT+3). Başlangıç boşsa hemen başlar, bitiş boşsa süresiz devam eder.",
  error,
  startLabel = "Başlangıç",
  endLabel = "Bitiş",
  requireStart = false,
  requireEnd = false,
  disabled = false,
  name,
  className,
}: ScheduleInputProps) {
  const id = useId();
  const current: ScheduleFieldValue = { startsAt: value?.startsAt ?? null, endsAt: value?.endsAt ?? null };
  const order =
    current.startsAt && current.endsAt && new Date(current.endsAt).getTime() <= new Date(current.startsAt).getTime()
      ? "Bitiş, başlangıçtan sonra olmalı."
      : null;
  const startError = typeof error === "object" && error ? error.startsAt : undefined;
  const endError = (typeof error === "object" && error ? error.endsAt : undefined) ?? order ?? undefined;
  const groupError = typeof error === "string" ? error : undefined;

  const side = (key: keyof ScheduleFieldValue, text: string, required: boolean, sideError: string | undefined) => {
    const inputId = `${id}-${key}`;
    const errorId = `${inputId}-error`;
    const local = istanbulDateTimeLocal(current[key]);
    return (
      <div className="min-w-0 space-y-1.5">
        <label htmlFor={inputId} className="block text-xs font-medium text-text-muted">
          {text}
          {required ? (
            <span aria-hidden className="ms-0.5 text-[#B3261E] dark:text-[#F28B82]">
              *
            </span>
          ) : null}
        </label>
        <div className={controlGroupClass}>
          <span aria-hidden className="flex items-center ps-3 text-text-muted">
            <CalendarClock className="size-4" />
          </span>
          <input
            id={inputId}
            type="datetime-local"
            value={local}
            disabled={disabled}
            required={required}
            aria-invalid={sideError || groupError ? true : undefined}
            aria-describedby={[sideError ? errorId : null, `${id}-help`].filter(Boolean).join(" ")}
            onChange={(event) => onChange({ ...current, [key]: parseIstanbulDateTimeLocal(event.target.value)?.toISOString() ?? null })}
            className={cn(groupInputClass, "h-10 ps-2 tabular-nums [color-scheme:light] dark:[color-scheme:dark]")}
          />
          {current[key] && !disabled ? (
            <button
              type="button"
              onClick={() => onChange({ ...current, [key]: null })}
              className={iconButtonClass("sm", "my-auto me-1 size-7")}
            >
              <X aria-hidden className="size-3.5" />
              <span className="sr-only">{text} zamanını temizle</span>
            </button>
          ) : null}
        </div>
        {sideError ? (
          <p id={errorId} className={errorClass}>
            {sideError}
          </p>
        ) : current[key] ? (
          <p className="text-[0.6875rem] text-text-muted">{formatIstanbul(current[key])}</p>
        ) : (
          <p className="text-[0.6875rem] text-text-muted">{key === "startsAt" ? "Hemen" : "Süresiz"}</p>
        )}
      </div>
    );
  };

  return (
    <fieldset className={cn("min-w-0 space-y-2", className)} data-field={name}>
      {label ? <legend className="mb-1.5 text-sm font-medium text-text">{label}</legend> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {side("startsAt", startLabel, requireStart, startError)}
        {side("endsAt", endLabel, requireEnd, endError)}
      </div>
      {groupError ? <p className={errorClass}>{groupError}</p> : null}
      {help ? (
        <p id={`${id}-help`} className={helpClass}>
          {help}
        </p>
      ) : null}
    </fieldset>
  );
}
