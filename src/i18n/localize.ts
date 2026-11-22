import type { Locale, LocalizedText } from "@/db/schema/common";

/** Picks the text for `locale`, falling back to Turkish (the source language), then to "". */
export function localize(text: LocalizedText | null | undefined, locale: Locale): string {
  if (!text) return "";
  return (text[locale] ?? "").trim() || text.tr || "";
}
