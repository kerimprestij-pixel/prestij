// Plain-text hygiene for reviews and display names (pure). Reviews are stored and rendered as plain
// text (React and the e-mail renderer escape them); this only removes what has no place in a review:
// control and invisible/bidi-override characters, anything that looks like an HTML tag, and runs of
// blank space.

// C0/C1 controls except tab and newline; zero-width and bidi embedding/override/isolate characters,
// which can hide or visually reorder text; the BOM.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// "<b>", "</p>", "<img src=…>", "<!-- … -->" — but not "5 < 6" or "<3".
const TAG_LIKE = /<\/?[a-zA-Z][^<>]*>|<!--[\s\S]*?-->/g;

/** Single-line text (title, display name, reply author): tags removed, whitespace collapsed. */
export function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(TAG_LIKE, " ")
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multi-line text (review body, shop reply): like cleanLine, but keeps up to one blank line. */
export function cleanMultiline(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(TAG_LIKE, " ")
    .replace(CONTROL, (ch) => (ch === "\n" ? ch : " "))
    .replace(INVISIBLE, "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Length in user-perceived characters (an emoji or "İ" counts once), used for min/max checks. */
export function textLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Initials shown by default under a review: "Ayşe Yılmaz" → "A. Y.", "Mehmet Ali Kaya" → "M. K.",
 * "ayşe" → "A.". Turkish-aware upper case (i → İ). Empty when the name has no letters.
 */
export function initialsOf(fullName: string | null | undefined): string {
  const words = cleanLine(fullName ?? "")
    .split(" ")
    .map((w) => w.replace(/^[^\p{L}]+/u, ""))
    .filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return "";
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked.map((w) => `${Array.from(w)[0].toLocaleUpperCase("tr-TR")}.`).join(" ");
}
