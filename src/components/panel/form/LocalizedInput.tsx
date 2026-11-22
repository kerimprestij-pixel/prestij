"use client";
import { controlClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import LocalizedShell from "./LocalizedShell";
import type { LocalizedErrors, LocalizedText } from "./localized";
import Textarea from "./Textarea";

export type LocalizedInputProps = {
  label: React.ReactNode;
  value: LocalizedText | null | undefined;
  /** Receives the whole object; empty en/ar keys are removed, tr is always present. */
  onChange: (value: LocalizedText) => void;
  help?: React.ReactNode;
  error?: LocalizedErrors;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  name?: string;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  className?: string;
};

/** One-line text in TR/EN/AR (tabs with filled dots; Arabic is right-to-left). */
export function LocalizedInput({ placeholder, maxLength, disabled, ...shell }: LocalizedInputProps) {
  return (
    <LocalizedShell {...shell} footerAside={maxLength ? (_, text) => `${text.length} / ${maxLength}` : undefined}>
      {({ text, setText, controlProps }) => (
        <input
          type="text"
          {...controlProps}
          value={text}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          className={cn(controlClass, "h-10 px-3")}
        />
      )}
    </LocalizedShell>
  );
}

export type LocalizedTextareaProps = LocalizedInputProps & {
  /** Initial height in lines (grows with content). Default 4. */
  rows?: number;
};

/** Multi-line plain text in TR/EN/AR. A blank line starts a new paragraph on the storefront. */
export function LocalizedTextarea({ placeholder, maxLength, disabled, rows = 4, ...shell }: LocalizedTextareaProps) {
  return (
    <LocalizedShell {...shell} footerAside={maxLength ? (_, text) => `${text.length} / ${maxLength}` : undefined}>
      {({ text, setText, controlProps }) => (
        <Textarea
          {...controlProps}
          invalid={controlProps["aria-invalid"]}
          value={text}
          onChange={setText}
          rows={rows}
          placeholder={placeholder}
          maxLength={maxLength}
          showCount={false}
          disabled={disabled}
        />
      )}
    </LocalizedShell>
  );
}

export default LocalizedInput;
