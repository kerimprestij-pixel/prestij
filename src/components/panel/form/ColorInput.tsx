"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { controlGroupClass, groupInputClass } from "@/components/panel/ui/styles";
import { AA, contrastRatio, contrastText, DARK_TEXT, LIGHT_TEXT, normalizeHex } from "@/lib/theme/engine";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

/** Storefront background of the default theme (light). */
export const DEFAULT_BACKGROUND = "#f9f8f5";

export type ColorInputProps = {
  /** "#RRGGBB" (upper-case, like the server's hexColorInput), or "" when `allowEmpty`. */
  value: string | null | undefined;
  onChange: (hex: string) => void;
  /** Background the color is checked against (default: the storefront ivory). */
  against?: string;
  /** Name of that background for the badge, e.g. "Arka plan". */
  againstLabel?: string;
  /**
   * "text" (default): the color is used for text/lines on `against` → ratio of the two.
   * "fill": the color is a fill with white or navy text on it → ratio with the better of the two.
   */
  usage?: "text" | "fill";
  allowEmpty?: boolean;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** Any hex/CSS color → "#RRGGBB", or "" when invalid. */
function toHex(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return normalizeHex(/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? `#${v}` : v)?.toUpperCase() ?? "";
}

const formatRatio = (n: number) => `${n.toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}:1`;

/** Color picker + hex field + WCAG AA badge (computed with the theme engine). */
export default function ColorInput({
  value,
  onChange,
  against = DEFAULT_BACKGROUND,
  againstLabel = "arka plan",
  usage = "text",
  allowEmpty = false,
  placeholder = "#000000",
  invalid,
  disabled,
  id,
  className,
}: ColorInputProps) {
  const hex = toHex(value);
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const draftInvalid = draft.trim() !== "" && !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(draft.trim());
  // `|| undefined` lets the enclosing Field's error mark the input (and focus it after a failed save).
  const control = useFieldControl({ id, invalid: invalid || (!focused && draftInvalid) || undefined });

  if (!focused && (value ?? "") !== seen) {
    setSeen(value ?? "");
    setDraft(value ?? "");
  }

  const commitText = (text: string) => {
    const t = text.trim();
    if (!t) {
      if (allowEmpty) onChange("");
      return;
    }
    const parsed = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t) ? toHex(t) : null;
    if (parsed && parsed !== hex) {
      setSeen(parsed);
      onChange(parsed);
    }
  };

  let ratio: number | null = null;
  let textOnFill: string | null = null;
  if (hex) {
    if (usage === "fill") {
      textOnFill = contrastText(hex);
      ratio = contrastRatio(hex, textOnFill);
    } else {
      ratio = contrastRatio(hex, normalizeHex(against) ?? DEFAULT_BACKGROUND);
    }
  }
  const pass = ratio !== null && ratio >= AA;
  const large = ratio !== null && !pass && ratio >= 3;
  const badgeTitle =
    ratio === null
      ? undefined
      : usage === "fill"
        ? `Üzerindeki ${textOnFill === LIGHT_TEXT ? "beyaz" : "lacivert"} yazı ile kontrast ${formatRatio(ratio)}`
        : `${againstLabel} ile kontrast ${formatRatio(ratio)}`;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2.5", className)}>
      <div className={cn(controlGroupClass, "w-auto min-w-[11rem] flex-1")}>
        <label className="relative flex shrink-0 cursor-pointer items-center ps-1.5">
          <span className="sr-only">Renk seçici</span>
          <span
            aria-hidden
            className="block size-7 rounded-md border border-black/10 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)] dark:border-white/15"
            style={{
              background: hex || "repeating-conic-gradient(var(--surface-2) 0 25%, var(--surface) 0 50%) 50% / 10px 10px",
            }}
          />
          <input
            type="color"
            value={hex.toLowerCase() || "#000000"}
            disabled={disabled}
            onChange={(event) => {
              const next = toHex(event.target.value);
              if (next) {
                setDraft(next);
                setSeen(next);
                onChange(next);
              }
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            tabIndex={-1}
            aria-hidden
          />
        </label>
        <input
          type="text"
          {...control}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            commitText(event.target.value);
          }}
          onBlur={() => {
            setFocused(false);
            const parsed = toHex(draft);
            if (parsed) setDraft(parsed);
            else if (!draft.trim() && !allowEmpty) setDraft(hex);
          }}
          className={cn(groupInputClass, "h-10 ps-2.5 font-mono uppercase tabular-nums placeholder:font-sans placeholder:normal-case")}
        />
      </div>

      {ratio !== null ? (
        <span
          title={badgeTitle}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums",
            pass
              ? "border-[#2F8F5B]/30 bg-[#2F8F5B]/10 text-text"
              : large
                ? "border-[#D68A12]/35 bg-[#D68A12]/10 text-text"
                : "border-[#C2413A]/30 bg-[#C2413A]/10 text-text",
          )}
        >
          <span
            aria-hidden
            className="grid size-4 place-items-center rounded-full text-[0.625rem] font-semibold"
            style={
              usage === "fill"
                ? { background: hex, color: textOnFill ?? DARK_TEXT }
                : { background: normalizeHex(against) ?? DEFAULT_BACKGROUND, color: hex, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.08)" }
            }
          >
            A
          </span>
          {pass ? (
            <Check aria-hidden className="size-3.5 text-[#2F8F5B] dark:text-[#5CC08A]" />
          ) : (
            <X aria-hidden className="size-3.5 text-[#B3261E] dark:text-[#F28B82]" />
          )}
          <span>{pass ? "AA" : large ? "Yalnız büyük yazı" : "AA değil"}</span>
          <span className="text-text-muted">{formatRatio(ratio)}</span>
          <span className="sr-only">{badgeTitle}</span>
        </span>
      ) : null}
      {!focused && draftInvalid ? (
        <p className="w-full text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">Renk #RRGGBB biçiminde olmalı, ör. #C2ADD1.</p>
      ) : null}
    </div>
  );
}
