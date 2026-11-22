"use client";
import LocalizedShell from "./LocalizedShell";
import type { LocalizedErrors, LocalizedText } from "./localized";
import RichTextEditor from "./RichTextEditor";

export type LocalizedRichTextProps = {
  label: React.ReactNode;
  /** HTML per locale. */
  value: LocalizedText | null | undefined;
  onChange: (value: LocalizedText) => void;
  help?: React.ReactNode;
  error?: LocalizedErrors;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Minimum editor height in rem (default 12). */
  minHeight?: number;
  name?: string;
  className?: string;
};

/** Rich text in TR/EN/AR: one editor per language tab (Arabic right-to-left), "TR'den kopyala". */
export default function LocalizedRichText({ placeholder, disabled, minHeight = 12, ...shell }: LocalizedRichTextProps) {
  return (
    <LocalizedShell {...shell} html>
      {({ locale, text, setText, controlProps }) => (
        <RichTextEditor
          key={locale}
          {...controlProps}
          value={text}
          onChange={setText}
          placeholder={placeholder}
          disabled={disabled}
          minHeight={minHeight}
        />
      )}
    </LocalizedShell>
  );
}
