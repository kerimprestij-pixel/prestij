// Field specs: how the panel's section editor renders each key of a section's content.
// Pure data + helpers (no React, no server imports), so schemas.ts, client editors and tests share it.
//
// Value shapes per type (what the editor reads and writes at `key`):
//   text           string (optional keys: undefined when empty)
//   localized      LocalizedText ({ tr, en?, ar? })
//   localizedLong  LocalizedText, multi-line plain text (blank line = new paragraph)
//   localizedRich  LocalizedText whose values are HTML (sanitized on save and on render)
//   media          media id (number) or null; `accept` says whether it holds an image (default) or a video
//   product        product id (number) or null
//   products       product id[] (order matters)
//   number         number
//   percent        number (0–100, usually capped lower by the schema)
//   select         one of `options[].value` (string or number)
//   switch         boolean
//   link           string href: canonical Turkish path ("/urunler/lavanta"), "#anchor", https://, mailto:, tel:
//   cta            { label: LocalizedText; href: string }, or undefined when `optional` and switched off
//   localizedList  LocalizedText[]
//   repeater       object[] whose items follow the nested `fields`

export type FieldSpecBase = {
  /** Content key, e.g. "headline". Inside a repeater: the key in each item. */
  key: string;
  /** Turkish label shown above the input. */
  label: string;
  /** One short Turkish sentence under the input explaining the effect. */
  help?: string;
  /** Show the required mark (the zod schema stays the authority). */
  required?: boolean;
};

export type SelectOption = { value: string | number; label: string };

export type TextFieldSpec = FieldSpecBase & { type: "text"; placeholder?: string; maxLength?: number };
export type LocalizedFieldSpec = FieldSpecBase & { type: "localized"; placeholder?: string; maxLength?: number };
export type LocalizedLongFieldSpec = FieldSpecBase & { type: "localizedLong"; rows?: number; maxLength?: number };
export type LocalizedRichFieldSpec = FieldSpecBase & { type: "localizedRich" };
/** Day 6: what a media field holds. */
export type MediaAccept = "image" | "video";

export type MediaFieldSpec = FieldSpecBase & {
  type: "media";
  /** Folder preselected in the media picker's upload tab. */
  folder?: string;
  /** Hint for the preview frame, e.g. "16/9", "2/3", "1/1". */
  aspect?: string;
  /**
   * Day 6: "image" (default: every field before day 6) or "video". The panel's picker offers only that
   * kind, and the page save refuses a media row of the other kind (pages-service.ts). Keys of video
   * fields end in "MediaId" (e.g. `videoMediaId`) so media usage tracking sees them.
   */
  accept?: MediaAccept;
};
export type ProductFieldSpec = FieldSpecBase & { type: "product" };
export type ProductsFieldSpec = FieldSpecBase & { type: "products"; max?: number };
export type NumberFieldSpec = FieldSpecBase & {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  /** Unit shown inside the input, e.g. "adet". */
  suffix?: string;
};
export type PercentFieldSpec = FieldSpecBase & { type: "percent"; min?: number; max?: number };
export type SelectFieldSpec = FieldSpecBase & { type: "select"; options: SelectOption[] };
export type SwitchFieldSpec = FieldSpecBase & { type: "switch" };
export type LinkFieldSpec = FieldSpecBase & { type: "link" };
export type CtaFieldSpec = FieldSpecBase & {
  type: "cta";
  /** The button can be switched off (the key is then left out). */
  optional?: boolean;
};
export type LocalizedListFieldSpec = FieldSpecBase & {
  type: "localizedList";
  max?: number;
  /** Singular noun for one entry, e.g. "Madde". */
  itemLabel?: string;
};
export type RepeaterFieldSpec = FieldSpecBase & {
  type: "repeater";
  /** Singular noun for one item, e.g. "Koku" → "Koku 1", "Koku ekle". */
  itemLabel: string;
  min?: number;
  max?: number;
  fields: FieldSpec[];
};

export type FieldSpec =
  | TextFieldSpec
  | LocalizedFieldSpec
  | LocalizedLongFieldSpec
  | LocalizedRichFieldSpec
  | MediaFieldSpec
  | ProductFieldSpec
  | ProductsFieldSpec
  | NumberFieldSpec
  | PercentFieldSpec
  | SelectFieldSpec
  | SwitchFieldSpec
  | LinkFieldSpec
  | CtaFieldSpec
  | LocalizedListFieldSpec
  | RepeaterFieldSpec;

export type FieldType = FieldSpec["type"];

export const FIELD_TYPES = [
  "text",
  "localized",
  "localizedLong",
  "localizedRich",
  "media",
  "product",
  "products",
  "number",
  "percent",
  "select",
  "switch",
  "link",
  "cta",
  "localizedList",
  "repeater",
] as const satisfies readonly FieldType[];

/**
 * Starting value for a field in a new repeater item or a newly enabled key. Required fields get an
 * empty value of the right shape; optional ones stay undefined so the schema default applies.
 */
export function emptyValueFor(spec: FieldSpec): unknown {
  switch (spec.type) {
    case "localized":
    case "localizedLong":
    case "localizedRich":
      return spec.required ? { tr: "" } : undefined;
    case "media":
    case "product":
      return null;
    case "products":
    case "localizedList":
      return [];
    case "number":
    case "percent":
      return spec.min ?? 0;
    case "select":
      return spec.options[0]?.value;
    case "switch":
      return false;
    case "text":
    case "link":
      return spec.required ? "" : undefined;
    case "cta":
      return spec.optional ? undefined : { label: { tr: "" }, href: "" };
    case "repeater":
      return Array.from({ length: spec.min ?? 0 }, () => emptyItemFor(spec.fields));
  }
}

/** A new repeater item: every nested field at its empty value (undefined keys omitted). */
export function emptyItemFor(fields: FieldSpec[]): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const field of fields) {
    const value = emptyValueFor(field);
    if (value !== undefined) item[field.key] = value;
  }
  return item;
}

/** Every spec in a list, nested repeater fields included (depth-first). */
export function flattenFieldSpecs(fields: FieldSpec[]): FieldSpec[] {
  return fields.flatMap((field) => (field.type === "repeater" ? [field, ...flattenFieldSpecs(field.fields)] : [field]));
}

/**
 * Day 6: what the media field at a dotted content path accepts ("imageId" → "image",
 * "items.2.imageId" → the repeater item's field, "videoMediaId" → "video"); null when the path is not a
 * media field. Repeater indexes are skipped, so the paths sectionRefs reports resolve directly.
 */
export function mediaAcceptAt(fields: readonly FieldSpec[], path: string): MediaAccept | null {
  const segments = path.split(".").filter((s) => s !== "" && !/^\d+$/.test(s));
  let level: readonly FieldSpec[] = fields;
  for (const [i, segment] of segments.entries()) {
    const spec = level.find((f) => f.key === segment);
    if (!spec) return null;
    const last = i === segments.length - 1;
    if (spec.type === "media") return last ? (spec.accept ?? "image") : null;
    if (spec.type !== "repeater" || last) return null;
    level = spec.fields;
  }
  return null;
}
