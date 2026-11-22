"use client";
// One overridable wheel text (title, subtitle, button texts) in TR/EN/AR. Empty = the storefront's default
// text for that language, which the field shows as its placeholder, so the owner always sees what visitors
// will read. An all-empty value is stored as "no override" (undefined), never as { tr: "" }.
import LocalizedShell from "@/components/panel/form/LocalizedShell";
import type { LocalizedErrors } from "@/components/panel/form/localized";
import { controlClass } from "@/components/panel/ui/styles";
import type { Locale, LocalizedText } from "@/i18n/locales";
import { cn } from "@/lib/utils";

export default function WheelTextInput({
  label,
  value,
  onChange,
  defaults,
  maxLength,
  error,
  name,
  help,
}: {
  label: string;
  value: LocalizedText | undefined;
  onChange: (value: LocalizedText | undefined) => void;
  /** The dictionary text per locale (shown as placeholder and used when the field is empty). */
  defaults: Record<Locale, string>;
  maxLength: number;
  error?: LocalizedErrors;
  name: string;
  help?: React.ReactNode;
}) {
  return (
    <LocalizedShell
      label={label}
      value={value}
      name={name}
      error={error}
      help={help}
      onChange={(next) => onChange(next.tr?.trim() || next.en?.trim() || next.ar?.trim() ? next : undefined)}
      footerAside={(_, text) => (text ? `${text.length} / ${maxLength}` : "Varsayılan metin kullanılıyor")}
    >
      {({ locale, text, setText, controlProps }) => (
        <input
          type="text"
          {...controlProps}
          value={text}
          placeholder={defaults[locale]}
          maxLength={maxLength}
          onChange={(event) => setText(event.target.value)}
          className={cn(controlClass, "h-10 px-3")}
        />
      )}
    </LocalizedShell>
  );
}
