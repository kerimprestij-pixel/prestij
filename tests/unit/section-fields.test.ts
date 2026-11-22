// Page-builder metadata: defaults parse, every schema key (nested repeater keys too) has a field spec,
// and the specs are well-formed for the panel's generic section editor.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { emptyItemFor, emptyValueFor, FIELD_TYPES, flattenFieldSpecs, type FieldSpec } from "@/components/sections/field-spec";
import { sectionMeta, sectionTypes } from "@/components/sections/schemas";

/** Unwraps optional/nullable/default/pipe wrappers down to the underlying schema. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  for (let i = 0; i < 10; i++) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodPipe) {
      current = current.in as z.ZodType;
    } else {
      break;
    }
  }
  return current;
}

function objectKeys(schema: z.ZodType): string[] | null {
  const inner = unwrap(schema);
  return inner instanceof z.ZodObject ? Object.keys(inner.shape) : null;
}

function arrayElement(schema: z.ZodType): z.ZodType | null {
  const inner = unwrap(schema);
  return inner instanceof z.ZodArray ? (inner.element as z.ZodType) : null;
}

/** Compares spec keys with schema keys at one level and recurses into repeaters. */
function checkLevel(where: string, schema: z.ZodType, fields: FieldSpec[]) {
  const keys = objectKeys(schema);
  assert.ok(keys, `${where}: schema is an object`);
  const specKeys = fields.map((f) => f.key);
  assert.equal(new Set(specKeys).size, specKeys.length, `${where}: duplicate field keys`);
  for (const key of keys) assert.ok(specKeys.includes(key), `${where}: schema key "${key}" has no field spec`);
  for (const key of specKeys) assert.ok(keys.includes(key), `${where}: field spec "${key}" is not a schema key`);

  const shape = (unwrap(schema) as z.ZodObject).shape as Record<string, z.ZodType>;
  for (const field of fields) {
    if (field.type !== "repeater") continue;
    const element = arrayElement(shape[field.key]);
    assert.ok(element, `${where}.${field.key}: repeater over an array schema`);
    checkLevel(`${where}.${field.key}[]`, element, field.fields);
  }
}

describe("section metadata", () => {
  test("there is at least one section type", () => {
    assert.ok(sectionTypes.length > 0);
  });

  for (const type of sectionTypes) {
    const meta = sectionMeta[type];

    test(`${type}: defaults parse with the schema`, () => {
      const parsed = meta.schema.safeParse(meta.defaults);
      assert.ok(parsed.success, `${type} defaults: ${parsed.success ? "" : z.prettifyError(parsed.error)}`);
    });

    test(`${type}: every schema key has a field spec`, () => {
      checkLevel(type, meta.schema, meta.fields);
    });

    test(`${type}: label, description and specs are well-formed`, () => {
      assert.ok(meta.label.trim().length > 0, "label");
      assert.ok(meta.description.trim().length > 0, "description");
      assert.ok(!meta.description.includes("\n"), "description is one line");
      for (const field of flattenFieldSpecs(meta.fields)) {
        assert.ok((FIELD_TYPES as readonly string[]).includes(field.type), `${field.key}: known type`);
        assert.ok(field.label.trim().length > 0, `${field.key}: label`);
        if (field.type === "select") assert.ok(field.options.length > 0, `${field.key}: options`);
        if (field.type === "repeater") {
          assert.ok(field.itemLabel.trim().length > 0, `${field.key}: itemLabel`);
          assert.ok(field.fields.length > 0, `${field.key}: nested fields`);
          if (field.min !== undefined && field.max !== undefined) assert.ok(field.min <= field.max, `${field.key}: min ≤ max`);
        }
      }
    });

    test(`${type}: select options are values the schema accepts`, () => {
      const shape = (unwrap(meta.schema) as z.ZodObject).shape as Record<string, z.ZodType>;
      for (const field of meta.fields) {
        if (field.type !== "select") continue;
        for (const option of field.options) {
          const result = shape[field.key].safeParse(option.value);
          assert.ok(result.success, `${type}.${field.key}: option ${String(option.value)} is accepted`);
        }
      }
    });

    test(`${type}: a new repeater item built from its specs parses`, () => {
      const shape = (unwrap(meta.schema) as z.ZodObject).shape as Record<string, z.ZodType>;
      for (const field of meta.fields) {
        if (field.type !== "repeater") continue;
        const element = arrayElement(shape[field.key]);
        assert.ok(element);
        const item = emptyItemFor(field.fields);
        const result = element.safeParse(item);
        assert.ok(result.success, `${type}.${field.key}: empty item ${JSON.stringify(item)}`);
      }
    });
  }
});

describe("field spec helpers", () => {
  test("empty values have the right shape", () => {
    assert.deepEqual(emptyValueFor({ key: "t", type: "localized", label: "T", required: true }), { tr: "" });
    assert.equal(emptyValueFor({ key: "t", type: "localized", label: "T" }), undefined);
    assert.equal(emptyValueFor({ key: "m", type: "media", label: "M" }), null);
    assert.deepEqual(emptyValueFor({ key: "p", type: "products", label: "P" }), []);
    assert.equal(emptyValueFor({ key: "s", type: "select", label: "S", options: [{ value: 4, label: "4" }] }), 4);
    assert.equal(emptyValueFor({ key: "c", type: "cta", label: "C", optional: true }), undefined);
    assert.deepEqual(emptyValueFor({ key: "c", type: "cta", label: "C" }), { label: { tr: "" }, href: "" });
    assert.deepEqual(
      emptyValueFor({ key: "r", type: "repeater", label: "R", itemLabel: "Öğe", min: 2, fields: [{ key: "q", type: "localized", label: "Q", required: true }] }),
      [{ q: { tr: "" } }, { q: { tr: "" } }],
    );
  });
});

describe("section links follow the href rule (save and render)", () => {
  const base = { title: { tr: "Başlık" } };
  test("CTA hrefs: safe paths pass, javascript:/data:/http:/protocol-relative fail", () => {
    const schema = sectionMeta.sample_cta.schema;
    for (const href of ["/numune", "/iletisim?konu=numune", "#sss", "https://wa.me/905321234567", "mailto:info@prestij.com.tr", "tel:+903520000000"]) {
      assert.equal(schema.safeParse({ ...base, cta: { label: { tr: "Git" }, href } }).success, true, href);
    }
    for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "http://example.com", "//evil.example", String.raw`/\evil.example`]) {
      assert.equal(schema.safeParse({ ...base, cta: { label: { tr: "Git" }, href } }).success, false, href);
    }
  });
  test("optional gallery links: missing and '' are fine, unsafe is refused", () => {
    const schema = sectionMeta.lifestyle_gallery.schema;
    assert.equal(schema.safeParse({ items: [{ imageId: 1 }] }).success, true);
    assert.equal(schema.safeParse({ items: [{ imageId: 1, href: "" }] }).success, true);
    assert.equal(schema.safeParse({ items: [{ imageId: 1, href: "javascript:alert(1)" }] }).success, false);
  });
  test("hero video: site path or https only", () => {
    const schema = sectionMeta.hero.schema;
    const hero = { headline: { tr: "Merhaba" } };
    assert.equal(schema.safeParse({ ...hero, videoUrl: "https://cdn.example.com/kapak.mp4" }).success, true);
    assert.equal(schema.safeParse({ ...hero, videoUrl: "/media/kapak.mp4" }).success, true);
    assert.equal(schema.safeParse({ ...hero, videoUrl: "" }).success, true);
    assert.equal(schema.safeParse({ ...hero, videoUrl: "javascript:alert(1)" }).success, false);
    assert.equal(schema.safeParse({ ...hero, videoUrl: "mailto:a@b.co" }).success, false);
  });
  test("resolveLink renders unsafe stored links as the home page", async () => {
    const { resolveLink } = await import("@/components/sections/links");
    assert.equal(resolveLink("en", "/urunler/lavanta"), "/en/products/lavanta");
    assert.equal(resolveLink("tr", "javascript:alert(1)"), "/tr");
    assert.equal(resolveLink("ar", "//evil.example"), "/ar");
    assert.equal(resolveLink("tr", "https://wa.me/905321234567"), "https://wa.me/905321234567");
  });
});
