"use client";
// Generic editor for a section's content, driven by its `fields` specs (src/components/sections/
// field-spec.ts). Every spec type maps to a kit control; repeaters recurse. Values are written with
// path-based setters, so editing one field clears only that field's errors.
import {
  CtaInput,
  Field,
  LinkInput,
  LocalizedInput,
  LocalizedListInput,
  LocalizedRichText,
  LocalizedTextarea,
  MediaPicker,
  NumberInput,
  PercentInput,
  ProductPicker,
  Repeater,
  Select,
  Switch,
  TextInput,
  useProductLookup,
  type CtaValue,
} from "@/components/panel/form";
import type { LocalizedErrors } from "@/components/panel/form";
import type { FieldSpec, RepeaterFieldSpec } from "@/components/sections/field-spec";
import { emptyItemFor } from "@/components/sections/field-spec";
import type { LocalizedText } from "@/db/schema/common";
import { helpClass, labelClass } from "@/components/panel/ui/styles";
import { VIDEO_SPEECH_TIP } from "@/components/panel/media/video-guidance";
import { cn } from "@/lib/utils";

export type SectionFieldsEditorProps = {
  fields: readonly FieldSpec[];
  /** The object these fields edit (a section's content, or one repeater item). */
  value: Record<string, unknown>;
  /** Dotted form path of `value`, e.g. "sections.2.content" or "sections.2.content.items.0". */
  path: string;
  setField: (path: string, value: unknown) => void;
  /** Errors below a path, keyed relative to it ("" = the path itself). */
  errorsUnder: (path: string) => Record<string, string>;
  /** Folder preselected in the media picker's upload tab. */
  mediaFolder?: string;
};

/** Small controls that sit two per row on wider screens (paired only with the same kind). */
const COMPACT_KIND: Partial<Record<FieldSpec["type"], "control" | "picker">> = {
  select: "control",
  number: "control",
  percent: "control",
  switch: "control",
  media: "picker",
  product: "picker",
};
const isCompact = (field: FieldSpec) => COMPACT_KIND[field.type] !== undefined;

function hasAnyText(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((v) => typeof v === "string" && v.trim() !== "");
}

function localizedErrors(errors: Record<string, string>): LocalizedErrors {
  if (errors[""]) return errors[""];
  const out: Partial<Record<"tr" | "en" | "ar", string>> = {};
  for (const locale of ["tr", "en", "ar"] as const) if (errors[locale]) out[locale] = errors[locale];
  if (Object.keys(out).length > 0) return out;
  const first = Object.values(errors)[0];
  return first;
}

const firstError = (errors: Record<string, string>) => errors[""] ?? Object.values(errors)[0];

/** Groups consecutive compact fields into rows. */
function layout(fields: readonly FieldSpec[]): FieldSpec[][] {
  const rows: FieldSpec[][] = [];
  for (const field of fields) {
    const last = rows[rows.length - 1];
    const kind = COMPACT_KIND[field.type];
    if (kind && last && last.length < 2 && COMPACT_KIND[last[0].type] === kind) last.push(field);
    else rows.push([field]);
  }
  return rows;
}

export default function SectionFieldsEditor(props: SectionFieldsEditorProps) {
  const rows = layout(props.fields);
  return (
    <div className="space-y-5">
      {rows.map((row) =>
        row.length > 1 || isCompact(row[0]) ? (
          <div key={row.map((f) => f.key).join("+")} className="grid gap-5 sm:grid-cols-2">
            {row.map((field) => (
              <FieldControl key={field.key} spec={field} {...props} />
            ))}
          </div>
        ) : (
          <FieldControl key={row[0].key} spec={row[0]} {...props} />
        ),
      )}
    </div>
  );
}

function FieldControl({ spec, value, path, setField, errorsUnder, mediaFolder }: SectionFieldsEditorProps & { spec: FieldSpec }) {
  const at = `${path}.${spec.key}`;
  const current = value[spec.key];
  const errors = errorsUnder(at);
  const error = firstError(errors);
  const set = (next: unknown) => setField(at, next);

  switch (spec.type) {
    case "text":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <TextInput
            value={typeof current === "string" ? current : ""}
            onChange={(text) => set(text === "" && !spec.required ? undefined : text)}
            placeholder={spec.placeholder}
            maxLength={spec.maxLength}
          />
        </Field>
      );
    case "localized":
    case "localizedLong":
    case "localizedRich": {
      const onChange = (next: LocalizedText) => set(!spec.required && !hasAnyText(next) ? undefined : next);
      const common = {
        label: spec.label,
        help: spec.help,
        required: spec.required,
        value: (current as LocalizedText | undefined) ?? null,
        onChange,
        error: localizedErrors(errors),
        name: at,
      };
      if (spec.type === "localizedRich") return <LocalizedRichText {...common} />;
      if (spec.type === "localizedLong") return <LocalizedTextarea {...common} rows={spec.rows ?? 3} maxLength={spec.maxLength} />;
      return <LocalizedInput {...common} maxLength={spec.maxLength} placeholder={spec.placeholder} />;
    }
    case "media":
      return (
        <Field
          label={spec.label}
          help={
            spec.accept === "video" ? (
              // D16: the tip about speech and subtitles under every video field (hero, video section).
              <>
                {spec.help}
                <span className="mt-1 block" data-video-tip="">
                  {VIDEO_SPEECH_TIP}
                </span>
              </>
            ) : (
              spec.help
            )
          }
          required={spec.required}
          error={error}
          name={at}
        >
          <MediaPicker
            value={typeof current === "number" ? current : null}
            onChange={(id) => set(id)}
            folder={spec.folder ?? mediaFolder}
            aspect={spec.aspect}
            dialogTitle={`${spec.label} seçin`}
            kind={spec.accept ?? "image"}
          />
        </Field>
      );
    case "product":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <ProductPicker value={typeof current === "number" ? current : null} onChange={(id) => set(id)} dialogTitle={`${spec.label} seçin`} />
        </Field>
      );
    case "products":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <ProductPicker
            multiple
            value={Array.isArray(current) ? (current as number[]) : []}
            onChange={(ids) => set(ids)}
            max={spec.max}
            dialogTitle={`${spec.label} seçin`}
          />
        </Field>
      );
    case "number":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <NumberInput
            value={typeof current === "number" ? current : null}
            onChange={(n) => set(n ?? spec.min ?? 0)}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            suffix={spec.suffix}
            nullable={false}
          />
        </Field>
      );
    case "percent":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <PercentInput value={typeof current === "number" ? current : null} onChange={(n) => set(n ?? spec.min ?? 0)} min={spec.min} max={spec.max} />
        </Field>
      );
    case "select":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <Select
            value={(current as string | number | undefined) ?? null}
            onChange={(v) => set(v)}
            options={spec.options}
            placeholder="Seçin…"
          />
        </Field>
      );
    case "switch":
      return (
        <div data-field={at}>
          <Switch checked={current === true} onChange={(on) => set(on)} label={spec.label} description={spec.help} invalid={Boolean(error)} />
          {error ? <p className="mt-1 text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{error}</p> : null}
        </div>
      );
    case "link":
      return (
        <Field label={spec.label} help={spec.help} required={spec.required} error={error} name={at}>
          <LinkInput value={typeof current === "string" ? current : ""} onChange={(href) => set(href === "" && !spec.required ? undefined : href)} />
        </Field>
      );
    case "cta":
      return (
        <CtaInput
          label={spec.label}
          help={spec.help}
          optional={spec.optional}
          required={spec.required}
          value={(current as CtaValue | undefined) ?? null}
          onChange={(next) => set(next)}
          errors={errors}
          name={at}
        />
      );
    case "localizedList":
      return (
        <LocalizedListInput
          label={spec.label}
          help={spec.help}
          value={Array.isArray(current) ? (current as LocalizedText[]) : []}
          onChange={(next) => set(next)}
          itemLabel={spec.itemLabel}
          max={spec.max}
          errors={errors}
          name={at}
        />
      );
    case "repeater":
      return (
        <RepeaterField
          spec={spec}
          items={Array.isArray(current) ? (current as Record<string, unknown>[]) : []}
          path={at}
          setField={setField}
          errorsUnder={errorsUnder}
          mediaFolder={mediaFolder}
        />
      );
  }
}

/** Header text of a repeater item: its product's name, else its first localized text. */
function useItemSummary(spec: RepeaterFieldSpec, items: Record<string, unknown>[]) {
  const productField = spec.fields.find((f) => f.type === "product");
  const productIds = productField
    ? items.map((item) => item[productField.key]).filter((id): id is number => typeof id === "number")
    : [];
  const lookup = useProductLookup(productIds);
  return (item: Record<string, unknown>): string | null => {
    if (productField) {
      const id = item[productField.key];
      const product = typeof id === "number" ? lookup(id) : undefined;
      if (product) return product.subtitle ? `${product.name} — ${product.subtitle}` : product.name;
    }
    for (const field of spec.fields) {
      if (field.type !== "localized" && field.type !== "localizedLong") continue;
      const text = (item[field.key] as LocalizedText | undefined)?.tr?.trim();
      if (text) return text.length > 70 ? `${text.slice(0, 69)}…` : text;
    }
    return null;
  };
}

function RepeaterField({
  spec,
  items,
  path,
  setField,
  errorsUnder,
  mediaFolder,
}: {
  spec: RepeaterFieldSpec;
  items: Record<string, unknown>[];
  path: string;
  setField: (path: string, value: unknown) => void;
  errorsUnder: (path: string) => Record<string, string>;
  mediaFolder?: string;
}) {
  const summary = useItemSummary(spec, items);
  const errors = errorsUnder(path);
  const listError = errors[""];
  return (
    <fieldset className="min-w-0 space-y-2" data-field={path}>
      <legend className={cn(labelClass, "mb-1")}>
        {spec.label}
        {spec.required ? (
          <span aria-hidden className="ms-0.5 text-[#B3261E] dark:text-[#F28B82]">
            *
          </span>
        ) : null}
      </legend>
      {spec.help ? <p className={cn(helpClass, "-mt-1")}>{spec.help}</p> : null}
      <Repeater
        items={items}
        onChange={(next) => setField(path, next)}
        createItem={() => emptyItemFor(spec.fields)}
        noun={spec.itemLabel}
        itemSummary={(item) => summary(item)}
        ariaLabel={spec.label}
        min={spec.min}
        max={spec.max}
        itemHasError={(index) => Object.keys(errorsUnder(`${path}.${index}`)).length > 0}
        renderItem={(item, { index }) => (
          <SectionFieldsEditor
            fields={spec.fields}
            value={item}
            path={`${path}.${index}`}
            setField={setField}
            errorsUnder={errorsUnder}
            mediaFolder={mediaFolder}
          />
        )}
      />
      {listError ? (
        <p role="alert" className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">
          {listError}
        </p>
      ) : null}
    </fieldset>
  );
}
