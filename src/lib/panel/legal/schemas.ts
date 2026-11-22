// Legal documents in the panel: validation for publishing and restoring versions, plus the pure helpers
// that keep the stored HTML in the shape the storefront expects.
//
// Stored body per locale = optional draft notice + body:
//   <aside class="legal-draft" role="note">…notice…</aside>\n…body…
// The /sayfa legal pages lift that aside out and show it as a styled note (LegalDocument.tsx); the
// checkout texts (legal-render.ts) sanitize the whole body, which drops the <aside> tag and keeps its
// text. The body itself has no placeholders: the checkout prepends the order block (seller from
// settings.general, buyer, items, totals, payment, delivery time, withdrawal) on its own.
// Pure (zod + the shared sanitizer): unit-testable and client-safe.
import { z } from "zod";
import type { LocalizedText } from "@/db/schema/common";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { idInput, localizedTextOf, updatedAtInput } from "@/lib/panel/schemas";
import { isDraftLegalVersion } from "./draft";

export { isDraftLegalVersion };

const LOCALE_KEYS = ["tr", "en", "ar"] as const;

/**
 * Keys whose current version is rendered into the checkout texts and stored with every order
 * (LEGAL_KEYS in src/lib/orders/legal-render.ts; not imported so this module stays light and client-safe).
 */
export const CHECKOUT_LEGAL_KEYS: readonly string[] = ["pre_information", "distance_sales"];

export const LEGAL_KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;
export const legalKeyInput = z
  .string({ error: "Geçersiz yasal metin." })
  .trim()
  .regex(LEGAL_KEY_PATTERN, "Geçersiz yasal metin.");

export const VERSION_MAX = 40;
const VERSION_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._\-/]*$/u;
export const VERSION_MESSAGE = "Sürüm adı harf veya rakamla başlamalı; yalnızca harf, rakam, boşluk, nokta, tire ve / içerebilir.";

/** Version label shown to buyers and stored with their consent ("taslak-2", "2026-11 v1"). */
export const versionLabelInput = z
  .string({ error: "Sürüm adını girin." })
  .trim()
  .min(1, "Sürüm adını girin.")
  .max(VERSION_MAX, `Sürüm adı en fazla ${VERSION_MAX} karakter olabilir.`)
  .regex(VERSION_PATTERN, VERSION_MESSAGE);

// ---------------------------------------------------------------------------------------------------
// HTML helpers

const DRAFT_NOTICE = /<aside\b[^>]*\blegal-draft\b[^>]*>([\s\S]*?)<\/aside\s*>/i;

/** Visible text of an HTML fragment (tags removed, entities for spaces folded). */
export function htmlText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const hasVisibleText = (html: string | null | undefined): boolean => htmlText(html).length > 0;

/** Splits a stored body into its draft notice (inner HTML of the first legal-draft aside) and the rest. */
export function splitDraftNotice(html: string | null | undefined): { notice: string; body: string } {
  const raw = html ?? "";
  const match = raw.match(DRAFT_NOTICE);
  if (!match) return { notice: "", body: raw.trim() };
  return { notice: match[1].trim(), body: raw.replace(DRAFT_NOTICE, "").trim() };
}

/** Same split for every locale of a stored document body. */
export function splitLocalizedBody(body: LocalizedText): { notice: LocalizedText; body: LocalizedText; hasNotice: boolean } {
  const notice: LocalizedText = { tr: "" };
  const rest: LocalizedText = { tr: "" };
  for (const locale of LOCALE_KEYS) {
    const value = body[locale];
    if (typeof value !== "string") continue;
    const parts = splitDraftNotice(value);
    if (parts.notice) notice[locale] = parts.notice;
    if (parts.body || locale === "tr") rest[locale] = parts.body;
  }
  return { notice, body: rest, hasNotice: LOCALE_KEYS.some((l) => Boolean(notice[l])) };
}

/**
 * The stored body: per locale, the (sanitized) draft notice wrapped in the aside the storefront lifts
 * out, then the sanitized body. A locale without body text is left out (the storefront falls back to
 * Turkish), and so is its notice.
 */
export function composeLegalBody(body: LocalizedText, notice: LocalizedText | null, showNotice: boolean): LocalizedText {
  const out: LocalizedText = { tr: "" };
  for (const locale of LOCALE_KEYS) {
    const text = sanitizeHtml(body[locale] ?? "").trim();
    if (!hasVisibleText(text)) continue;
    const note = showNotice && notice ? sanitizeHtml(notice[locale] ?? "").trim() : "";
    out[locale] = hasVisibleText(note) ? `<aside class="legal-draft" role="note">${note}</aside>\n${text}` : text;
  }
  return out;
}

/** Re-sanitizes a stored body (restore copies an old version through the same rules as a publish). */
export function cleanStoredBody(body: LocalizedText): LocalizedText {
  const parts = splitLocalizedBody(body);
  return composeLegalBody(parts.body, parts.notice, parts.hasNotice);
}

/** "[e-posta adresi]" style markers the drafts use for data that is still missing (unique, in order). */
export function findMissingFields(...html: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const fragment of html) {
    for (const m of htmlText(fragment).matchAll(/\[([^[\]]{2,120})\]/g)) {
      const label = m[1].trim();
      if (label && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

/** Next free version label: "taslak-1" → "taslak-2", "v1.9" → "v1.10", "2026" → "2027", "ilk" → "ilk-2". */
export function suggestNextVersion(current: string | null | undefined, existing: readonly string[] = []): string {
  const taken = new Set(existing.map((v) => v.trim().toLocaleLowerCase("tr")));
  const free = (label: string) => !taken.has(label.toLocaleLowerCase("tr")) && label.length <= VERSION_MAX;
  const raw = (current ?? "").trim();
  const m = raw.match(/^(.*?)(\d+)$/);
  const prefix = !raw ? "sürüm-" : m ? m[1] : `${raw}-`;
  let n = !raw ? 1 : m ? Number(m[2]) + 1 : 2;
  while (!free(`${prefix}${n}`)) {
    n += 1;
    if (`${prefix}${n}`.length > VERSION_MAX) return free(`sürüm-${n}`) ? `sürüm-${n}` : `sürüm-${Date.now()}`;
  }
  return `${prefix}${n}`;
}

/** "2026-11" for `now` in Istanbul time. */
function istanbulMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** First free label of the approved form for the Istanbul month of `now`: "2026-11 v1", "2026-11 v2", … */
export function approvedVersionLabel(now: Date, existing: readonly string[] = []): string {
  return suggestNextVersion(`${istanbulMonth(now)} v0`, existing);
}

export type LegalVersionSuggestions = {
  /** Label for an approved text: never starts with "taslak" (after a draft: "2026-11 v1"; after "2026-11 v1": "2026-11 v2"). */
  approved: string;
  /** Label for a text that is still a draft: "taslak-N" (the next free number). */
  draft: string;
};

/**
 * The two labels the legal editor offers for the next publish. The editor pre-fills `draft` while the draft
 * notice is on and `approved` once it is switched off, so a lawyer-approved text is never published under a
 * "taslak…" label by accident (that label would keep the checkout closed). Pure: `now` comes from the caller.
 */
export function legalVersionSuggestions(current: string | null | undefined, existing: readonly string[], now: Date): LegalVersionSuggestions {
  const label = (current ?? "").trim();
  const draftNow = !label || isDraftLegalVersion(label);
  return {
    approved: draftNow ? approvedVersionLabel(now, existing) : suggestNextVersion(label, existing),
    draft: suggestNextVersion(draftNow && label ? label : "taslak-0", existing),
  };
}

// ---------------------------------------------------------------------------------------------------
// Action schemas

const BODY_MAX = 150_000;

/** Rich text per locale, sanitized; Turkish must have visible text. */
export function legalRichTextOf({ required, max = BODY_MAX, requiredMessage = "Türkçe metni girin." }: { required: boolean; max?: number; requiredMessage?: string }) {
  const locale = z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? v : ""))
    .pipe(z.string().max(max, "Metin çok uzun."))
    .transform((v) => sanitizeHtml(v).trim());
  return z
    .object({ tr: locale, en: locale, ar: locale }, { error: requiredMessage })
    .superRefine((v, ctx) => {
      if (required && !hasVisibleText(v.tr)) ctx.addIssue({ code: "custom", message: requiredMessage, path: ["tr"] });
      if (!hasVisibleText(v.tr) && (hasVisibleText(v.en) || hasVisibleText(v.ar))) {
        ctx.addIssue({ code: "custom", message: "Önce Türkçe metni girin; çeviriler Türkçe metnin yanında gösterilir.", path: ["tr"] });
      }
    })
    .transform((v): LocalizedText => {
      const out: LocalizedText = { tr: hasVisibleText(v.tr) ? v.tr : "" };
      if (hasVisibleText(v.en)) out.en = v.en;
      if (hasVisibleText(v.ar)) out.ar = v.ar;
      return out;
    });
}

/** The version the editor started from (null when the key had no current version). */
const baseFields = {
  key: legalKeyInput,
  baseId: z.union([idInput, z.null()]),
  baseUpdatedAt: z.union([updatedAtInput, z.null()]),
};

export const legalPublishInput = z
  .object({
    ...baseFields,
    version: versionLabelInput,
    title: localizedTextOf({ max: 160, requiredMessage: "Türkçe başlığı girin." }),
    showNotice: z.boolean(),
    notice: legalRichTextOf({ required: false, max: 4000 }),
    body: legalRichTextOf({ required: true }),
  })
  .superRefine((v, ctx) => {
    if (v.showNotice && !hasVisibleText(v.notice.tr)) {
      ctx.addIssue({ code: "custom", message: "Uyarı metnini girin ya da uyarıyı kapatın.", path: ["notice", "tr"] });
    }
  });

export type LegalPublishInput = z.output<typeof legalPublishInput>;

export const legalRestoreInput = z.object({
  ...baseFields,
  sourceId: idInput,
  version: versionLabelInput,
});

export type LegalRestoreInput = z.output<typeof legalRestoreInput>;
