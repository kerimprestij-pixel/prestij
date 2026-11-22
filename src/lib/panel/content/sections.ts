// Section content for the page builder: panel-side cleanup and validation (driven by each type's
// `fields` specs plus its zod schema), Turkish error messages, rich-text sanitizing and the one-line
// summary of a collapsed section. Pure and client-safe: the editor validates with the same code before
// sending, the server validates again on save.
import { z } from "zod";
import type { FieldSpec } from "@/components/sections/field-spec";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import { isSectionType, sectionMeta, type SectionType } from "@/components/sections/schemas";

export type ContentIssue = { path: (string | number)[]; message: string };
export type NormalizeResult = { ok: true; content: Record<string, unknown> } | { ok: false; issues: ContentIssue[] };

export const AUDIENCES = ["all", "retail", "business"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "all", label: "Herkes" },
  { value: "retail", label: "Bireysel ziyaretçiler" },
  { value: "business", label: "Yalnızca kurumsal müşteriler" },
];

/** Hard caps when a spec gives no maxLength (the storefront layout is the real limit). */
const MAX_TEXT = 2000;
const MAX_LONG = 6000;
const MAX_RICH = 60000;

const LOCALES = ["tr", "en", "ar"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Visible text of a value (HTML tags and &nbsp; ignored for rich text). */
export function plainText(value: unknown, html = false): string {
  if (typeof value !== "string") return "";
  const text = html
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;| /g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    : value;
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------------
// Turkish messages for zod issues raised by the section schemas (they carry no messages of their own,
// except the link rule's HREF_MESSAGE, which wins over this map).

type RawIssue = Parameters<z.core.$ZodErrorMap>[0];

/** Message for a failed union: a branch's own (custom) message, or the select message when every branch wanted a literal. */
function unionMessage(errors: unknown): string {
  if (!Array.isArray(errors)) return "Geçersiz değer.";
  const all = errors.flatMap((branch) => (Array.isArray(branch) ? (branch as { code?: string; message?: string }[]) : []));
  const custom = all.find((issue) => issue?.code === "custom" && issue.message && !/^invalid input$/i.test(issue.message));
  if (custom?.message) return custom.message;
  if (all.length > 0 && all.every((issue) => issue?.code === "invalid_value")) return "Listeden geçerli bir seçenek seçin.";
  return "Geçersiz değer.";
}

export const sectionErrorMap: z.core.$ZodErrorMap = (iss: RawIssue) => {
  switch (iss.code) {
    case "invalid_type":
      if (iss.input === undefined || iss.input === null || iss.input === "") return "Bu alan zorunlu.";
      if (iss.expected === "int") return "Tam sayı girin.";
      if (iss.expected === "number") return "Bir sayı girin.";
      return "Geçersiz değer.";
    case "too_small": {
      const min = Number(iss.minimum);
      if (iss.origin === "array" || iss.origin === "set") return `En az ${min} öğe ekleyin.`;
      if (iss.origin === "string") return min <= 1 ? "Bu alan boş bırakılamaz." : `En az ${min} karakter girin.`;
      return `En az ${min} olmalı.`;
    }
    case "too_big": {
      const max = Number(iss.maximum);
      if (iss.origin === "array" || iss.origin === "set") return `En fazla ${max} öğe ekleyebilirsiniz.`;
      if (iss.origin === "string") return `En fazla ${max} karakter girebilirsiniz.`;
      return `En fazla ${max} olabilir.`;
    }
    case "invalid_value":
      return "Listeden geçerli bir seçenek seçin.";
    case "invalid_union":
      return unionMessage(iss.errors);
    default:
      return "Geçersiz değer.";
  }
};

// ---------------------------------------------------------------------------------------------------
// Cleanup + panel rules (stricter than the storefront schemas, which accept e.g. an empty headline).

type LocalizedValue = { tr: string; en?: string; ar?: string };

/** Trimmed localized value; null when every locale is empty. */
function cleanLocalized(value: unknown, html: boolean): LocalizedValue | null {
  if (!isPlainObject(value)) return null;
  const out: LocalizedValue = { tr: "" };
  for (const locale of LOCALES) {
    const raw = value[locale];
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!plainText(text, html)) continue;
    out[locale] = text;
  }
  return LOCALES.some((l) => out[l]) ? out : null;
}

function checkLength(value: LocalizedValue, max: number, path: (string | number)[], issues: ContentIssue[]) {
  for (const locale of LOCALES) {
    const text = value[locale];
    if (text && text.length > max) issues.push({ path: [...path, locale], message: `En fazla ${max} karakter girebilirsiniz.` });
  }
}

function prepareFields(fields: readonly FieldSpec[], source: Record<string, unknown>, path: (string | number)[], issues: ContentIssue[]) {
  const out: Record<string, unknown> = { ...source };
  for (const field of fields) {
    const at = [...path, field.key];
    const value = out[field.key];
    switch (field.type) {
      case "localized":
      case "localizedLong":
      case "localizedRich": {
        const html = field.type === "localizedRich";
        const cleaned = cleanLocalized(value, html);
        if (!cleaned) {
          if (field.required) {
            issues.push({ path: [...at, "tr"], message: "Türkçe metin zorunlu." });
            out[field.key] = { tr: "" };
          } else {
            delete out[field.key];
          }
          break;
        }
        if (!cleaned.tr) issues.push({ path: [...at, "tr"], message: "Önce Türkçe metni girin." });
        const max = field.type === "localizedRich" ? MAX_RICH : (field.maxLength ?? (field.type === "localized" ? MAX_TEXT : MAX_LONG));
        checkLength(cleaned, max, at, issues);
        out[field.key] = cleaned;
        break;
      }
      case "text":
      case "link": {
        const text = typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : value;
        if (text === "") {
          delete out[field.key];
          if (field.required) issues.push({ path: at, message: field.type === "link" ? "Bağlantı seçin." : "Bu alan zorunlu." });
          break;
        }
        const max = field.type === "text" ? (field.maxLength ?? MAX_TEXT) : MAX_TEXT;
        if (typeof text === "string" && text.length > max) issues.push({ path: at, message: `En fazla ${max} karakter girebilirsiniz.` });
        out[field.key] = text;
        break;
      }
      case "cta": {
        if (value === undefined || value === null) {
          delete out[field.key];
          if (!field.optional) issues.push({ path: [...at, "label", "tr"], message: "Buton yazısı zorunlu." });
          break;
        }
        const cta = isPlainObject(value) ? value : {};
        const label = cleanLocalized(cta.label, false);
        const href = typeof cta.href === "string" ? cta.href.trim() : "";
        if (!label?.tr) issues.push({ path: [...at, "label", "tr"], message: label ? "Önce Türkçe metni girin." : "Buton yazısı zorunlu." });
        if (label) checkLength(label, 60, [...at, "label"], issues);
        if (!href) issues.push({ path: [...at, "href"], message: "Bağlantı seçin." });
        out[field.key] = { label: label ?? { tr: "" }, href };
        break;
      }
      case "media":
      case "product": {
        if (value === undefined || value === null || value === "") {
          if (value === "") out[field.key] = null;
          if (field.required) {
            const message = field.type === "media" ? (field.accept === "video" ? "Bir video seçin." : "Bir görsel seçin.") : "Bir ürün seçin.";
            issues.push({ path: at, message });
          }
        }
        break;
      }
      case "products": {
        out[field.key] = Array.isArray(value) ? value : [];
        break;
      }
      case "localizedList": {
        const list = Array.isArray(value) ? value : [];
        const kept: LocalizedValue[] = [];
        list.forEach((item) => {
          const cleaned = cleanLocalized(item, false);
          if (!cleaned) return; // empty lines are dropped silently
          const index = kept.length;
          if (!cleaned.tr) issues.push({ path: [...at, index, "tr"], message: "Önce Türkçe metni girin." });
          checkLength(cleaned, MAX_TEXT, [...at, index], issues);
          kept.push(cleaned);
        });
        out[field.key] = kept;
        break;
      }
      case "repeater": {
        if (!Array.isArray(value)) {
          out[field.key] = [];
          break;
        }
        out[field.key] = value.map((item, index) => prepareFields(field.fields, isPlainObject(item) ? item : {}, [...at, index], issues));
        break;
      }
      case "number":
      case "percent":
      case "select":
      case "switch":
        break;
    }
  }
  return out;
}

/** Runs sanitizeHtml over every localizedRich value (nested repeaters included). */
function sanitizeRich(fields: readonly FieldSpec[], content: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...content };
  for (const field of fields) {
    const value = out[field.key];
    if (field.type === "localizedRich" && isPlainObject(value)) {
      const clean: Record<string, string> = {};
      for (const [locale, html] of Object.entries(value)) if (typeof html === "string") clean[locale] = sanitizeHtml(html);
      out[field.key] = clean;
    } else if (field.type === "repeater" && Array.isArray(value)) {
      out[field.key] = value.map((item) => (isPlainObject(item) ? sanitizeRich(field.fields, item) : item));
    }
  }
  return out;
}

function dedupeIssues(issues: ContentIssue[]): ContentIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issue.path.join(".");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * What the page service stores for a section: cleaned (empty optional texts removed), checked with the
 * panel rules and the type's zod schema (Turkish messages, paths relative to `content`), defaults
 * applied, rich text sanitized.
 */
export function normalizeSectionContent(type: SectionType, raw: unknown): NormalizeResult {
  const meta = sectionMeta[type];
  const issues: ContentIssue[] = [];
  const prepared = prepareFields(meta.fields, isPlainObject(raw) ? raw : {}, [], issues);
  const parsed = (meta.schema as z.ZodType).safeParse(prepared, { error: sectionErrorMap });
  if (!parsed.success) {
    // A panel rule already explains this spot (e.g. "Türkçe metin zorunlu." at headline.tr): skip the
    // schema's issue on the same field, its parent or its children.
    const panelPaths = issues.map((issue) => issue.path.join("."));
    const overlaps = (path: string) => panelPaths.some((p) => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`));
    for (const issue of parsed.error.issues) {
      const path = issue.path.map((p) => (typeof p === "number" ? p : String(p)));
      if (!overlaps(path.join("."))) issues.push({ path, message: issue.message });
    }
  }
  if (issues.length > 0) return { ok: false, issues: dedupeIssues(issues) };
  return { ok: true, content: sanitizeRich(meta.fields, parsed.data as Record<string, unknown>) };
}

/**
 * Editor state for stored content: the schema output (defaults filled in, ids coerced) when it parses,
 * otherwise the raw object (the editor then shows the errors on save).
 */
export function loadSectionContent(type: string, raw: unknown): Record<string, unknown> {
  const base = isPlainObject(raw) ? raw : {};
  if (!isSectionType(type)) return base;
  const parsed = (sectionMeta[type].schema as z.ZodType).safeParse(base);
  return parsed.success && isPlainObject(parsed.data) ? (parsed.data as Record<string, unknown>) : base;
}

/** Content of a newly added section: the type's defaults in editor shape. */
export function newSectionContent(type: SectionType): Record<string, unknown> {
  return loadSectionContent(type, structuredClone(sectionMeta[type].defaults));
}

/** True when the storefront would render the content (its schema parses). */
export function rendersOnStorefront(type: string, raw: unknown): boolean {
  return isSectionType(type) && (sectionMeta[type].schema as z.ZodType).safeParse(raw ?? {}).success;
}

// ---------------------------------------------------------------------------------------------------
// References (media / products) for existence checks on save.

export type ContentRefs = { media: { id: number; path: string }[]; products: { id: number; path: string }[] };

function toId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function collect(fields: readonly FieldSpec[], content: Record<string, unknown>, path: string, refs: ContentRefs) {
  for (const field of fields) {
    const value = content[field.key];
    const at = path ? `${path}.${field.key}` : field.key;
    if (field.type === "media" || field.type === "product") {
      const id = toId(value);
      if (id) (field.type === "media" ? refs.media : refs.products).push({ id, path: at });
    } else if (field.type === "products" && Array.isArray(value)) {
      value.forEach((v, i) => {
        const id = toId(v);
        if (id) refs.products.push({ id, path: `${at}.${i}` });
      });
    } else if (field.type === "repeater" && Array.isArray(value)) {
      value.forEach((item, i) => {
        if (isPlainObject(item)) collect(field.fields, item, `${at}.${i}`, refs);
      });
    }
  }
}

/** Media and product ids in a section's content with their dotted paths (relative to `content`). */
export function sectionRefs(type: SectionType, content: Record<string, unknown>): ContentRefs {
  const refs: ContentRefs = { media: [], products: [] };
  collect(sectionMeta[type].fields, content, "", refs);
  return refs;
}

// ---------------------------------------------------------------------------------------------------
// Summary line for a collapsed section card.

export type SectionSummary = {
  /** Turkish type label ("Kapak (hero)"), or a note for unknown types. */
  label: string;
  /** First heading-like text in the content (Turkish), if any. */
  heading: string | null;
  /** Short facts, e.g. "4 koku", "6 ürün". */
  facts: string[];
  known: boolean;
};

const HEADING_KEYS = ["headline", "title", "question"];

function trText(value: unknown, html = false): string {
  return isPlainObject(value) ? plainText(value.tr, html) : "";
}

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function findHeading(fields: readonly FieldSpec[], content: Record<string, unknown>): string | null {
  const localized = fields.filter((f) => f.type === "localized" || f.type === "localizedLong" || f.type === "localizedRich");
  const ordered = [
    ...localized.filter((f) => HEADING_KEYS.includes(f.key)),
    ...localized.filter((f) => !HEADING_KEYS.includes(f.key) && f.key !== "eyebrow" && f.type === "localized"),
    ...localized.filter((f) => f.key !== "eyebrow" && f.type !== "localized"),
    ...localized.filter((f) => f.key === "eyebrow"),
  ];
  for (const field of ordered) {
    const text = trText(content[field.key], field.type === "localizedRich");
    if (text) return truncate(text);
  }
  for (const field of fields) {
    if (field.type === "select" && field.required) {
      const option = field.options.find((o) => o.value === content[field.key]);
      if (option) return option.label;
    }
  }
  for (const field of fields) {
    if (field.type === "cta") {
      const cta = content[field.key];
      const text = isPlainObject(cta) ? trText(cta.label) : "";
      if (text) return truncate(text);
    }
  }
  return null;
}

export function sectionSummary(type: string, content: unknown): SectionSummary {
  if (!isSectionType(type)) return { label: `Bilinmeyen bölüm türü (${type})`, heading: null, facts: [], known: false };
  const meta = sectionMeta[type];
  const data = isPlainObject(content) ? content : {};
  const facts: string[] = [];
  for (const field of meta.fields) {
    const value = data[field.key];
    if (field.type === "repeater" && Array.isArray(value)) {
      facts.push(`${value.length} ${field.itemLabel.toLocaleLowerCase("tr-TR")}`);
    } else if (field.type === "products" && Array.isArray(value)) {
      facts.push(value.length > 0 ? `${value.length} ürün` : "Tüm ürünler");
    } else if (field.type === "localizedList" && Array.isArray(value) && value.length > 0) {
      facts.push(`${value.length} ${(field.itemLabel ?? "madde").toLocaleLowerCase("tr-TR")}`);
    }
  }
  return { label: meta.label, heading: findHeading(meta.fields, data), facts, known: true };
}

/** Stable JSON (sorted keys) for change detection. */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}
