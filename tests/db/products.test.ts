// Product and category panel rules against the local PostgreSQL: optimistic lock (stale updatedAt),
// SKU uniqueness ignoring case, the default-variant invariant, option/variant consistency, a slug
// change recording a redirect, the stock guard (quick edit and full save), deactivate-instead-of-delete
// for referenced variants, duplicate/delete rules, category delete with product move.
// Works only on rows it creates (slugs "products-test-…"), removes them again and restores the id
// sequences; the final hook checks that the row counts are back where they started.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/products.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { executePanelAction } from "@/lib/panel/action-core";
import { saveCategory, deleteCategory, reorderCategories, loadCategoryState } from "@/lib/panel/categories/service";
import { categorySaveSchema } from "@/lib/panel/categories/schema";
import { PanelError } from "@/lib/panel/errors";
import { loadProductState } from "@/lib/panel/products/queries";
import { productSaveSchema } from "@/lib/panel/products/schema";
import {
  createProduct,
  deleteProduct,
  duplicateProduct,
  quickStockEdit,
  reorderProducts,
  saveProduct,
  setProductStatus,
} from "@/lib/panel/products/service";
import { newKey, type ProductEditorState } from "@/lib/panel/products/types";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "products-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Products Test", email: "products@test.local", role: "editor", banned: false },
  session: { id: "products-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;
const PREFIX = "products-test";

const COUNT_TABLES = [
  "products",
  "product_variants",
  "product_options",
  "product_option_values",
  "variant_option_values",
  "product_media",
  "tier_prices",
  "group_prices",
  "bundle_items",
  "product_relations",
  "categories",
  "redirects",
  "audit_log",
  "carts",
  "cart_items",
] as const;
const SEQ_TABLES = ["products", "product_variants", "product_options", "product_option_values", "product_media", "tier_prices", "bundle_items", "categories", "redirects", "audit_log", "cart_items"] as const;

type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let counts: Record<string, number>;
let sequences: SeqState[] = [];
let positions: { id: number; position: number; updatedAt: Date }[] = [];
let categoryPositions: { id: number; position: number; updatedAt: Date }[] = [];
const cartIds: string[] = [];

/** The row's current updated_at (what an editor that just loaded it would send). */
async function stamp(table: typeof schema.products | typeof schema.categories, id: number): Promise<Date> {
  const [row] = await db.select({ updatedAt: table.updatedAt }).from(table).where(eq(table.id, id));
  return row.updatedAt;
}

async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${t}`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

async function cleanup() {
  if (cartIds.length) await db.delete(schema.carts).where(inArray(schema.carts.id, cartIds));
  const P = schema.products;
  const mine = await db.select({ id: P.id }).from(P).where(like(P.slug, `${PREFIX}%`));
  const ids = mine.map((r) => r.id);
  if (ids.length) {
    // Bundles first (bundle_items restrict deleting a component variant).
    await db.delete(schema.bundleItems).where(inArray(schema.bundleItems.bundleProductId, ids));
    await db.delete(P).where(inArray(P.id, ids));
  }
  await db.delete(schema.categories).where(like(schema.categories.slug, `${PREFIX}%`));
  await db
    .delete(schema.redirects)
    .where(
      or(
        like(schema.redirects.fromPath, `/urunler/${PREFIX}%`),
        like(schema.redirects.toPath, `/urunler/${PREFIX}%`),
        like(schema.redirects.fromPath, `/kategori/${PREFIX}%`),
        like(schema.redirects.toPath, `/kategori/${PREFIX}%`),
      ),
    );
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

before(async () => {
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
  positions = await db.select({ id: schema.products.id, position: schema.products.position, updatedAt: schema.products.updatedAt }).from(schema.products);
  categoryPositions = await db
    .select({ id: schema.categories.id, position: schema.categories.position, updatedAt: schema.categories.updatedAt })
    .from(schema.categories);
});

after(async () => {
  await cleanup();
  // Positions changed by the reorder tests go back (same updated_at: reorders never touch it).
  for (const p of positions) await db.execute(sql`update products set position = ${p.position} where id = ${p.id}`);
  for (const c of categoryPositions) await db.execute(sql`update categories set position = ${c.position} where id = ${c.id}`);
  await restoreSequences();
  try {
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
    const now = await db.select({ id: schema.products.id, position: schema.products.position, updatedAt: schema.products.updatedAt }).from(schema.products);
    for (const p of positions) {
      const row = now.find((r) => r.id === p.id);
      assert.ok(row, `product ${p.id} still exists`);
      assert.equal(row.position, p.position);
      assert.equal(row.updatedAt.getTime(), p.updatedAt.getTime(), `product ${p.id} updated_at untouched`);
    }
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------
// Helpers

async function create(name: string, type: "standard" | "bundle" | "sample" = "standard") {
  return db.transaction(async (tx) => createProduct(tx, { name, type, categoryId: null }));
}

async function state(id: number): Promise<ProductEditorState> {
  const s = await loadProductState(db, id);
  assert.ok(s, `product ${id} exists`);
  return s;
}

/** saveProduct through the real action pipeline (zod + transaction + audit). */
async function save(payload: unknown) {
  return executePanelAction(
    {
      schema: productSaveSchema,
      run: async (input, { tx }) => {
        const r = await saveProduct(tx, input);
        return { data: r, tags: r.tags, audit: r.audit };
      },
    },
    ACTOR,
    payload,
  );
}

function expectFail(result: { ok: boolean }, code: string, path?: string) {
  assert.equal(result.ok, false, "expected a failure");
  const r = result as { ok: false; code: string; fieldErrors?: Record<string, string>; error: string };
  assert.equal(r.code, code, `code (${r.error} ${JSON.stringify(r.fieldErrors)})`);
  if (path) assert.ok(r.fieldErrors?.[path], `field error at ${path}: ${JSON.stringify(r.fieldErrors)}`);
}

/** A product with an option axis (two values) and two variants, prices set. */
async function productWithVariants(slugSuffix: string) {
  const { id } = await create(`${PREFIX} ${slugSuffix}`);
  const s = await state(id);
  const a = newKey();
  const b = newKey();
  const base = s.variants[0];
  const payload: ProductEditorState = {
    ...s,
    options: [{ key: newKey(), id: null, name: { tr: "Boy" }, display: "buttons", values: [
      { key: a, id: null, value: { tr: "Küçük" }, swatchColor: "", swatchMediaId: null },
      { key: b, id: null, value: { tr: "Büyük" }, swatchColor: "", swatchMediaId: null },
    ] }],
    variants: [
      { ...base, sku: `PT-${slugSuffix.toUpperCase()}-K`, price: 10000, weightGrams: 500, optionValueKeys: [a] },
      { ...base, key: newKey(), id: null, sku: `PT-${slugSuffix.toUpperCase()}-B`, price: 20000, stock: 7, stockSeen: null, isDefault: false, weightGrams: 900, optionValueKeys: [b] },
    ],
  };
  const { result } = await save(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  return state(id);
}

// ---------------------------------------------------------------------------------------------

describe("create and save", () => {
  test("create makes a draft with a unique slug and one default variant", async () => {
    const one = await create(`${PREFIX} Gül`);
    const two = await create(`${PREFIX} Gül`);
    assert.equal(one.slug, `${PREFIX}-gul`);
    assert.equal(two.slug, `${PREFIX}-gul-2`);
    const s = await state(one.id);
    assert.equal(s.status, "draft");
    assert.equal(s.variants.length, 1);
    assert.equal(s.variants[0].isDefault, true);
    assert.equal(s.variants[0].sku, `PR-${PREFIX}-GUL`.toUpperCase());
  });

  test("a stale updatedAt is a conflict and changes nothing", async () => {
    const { id } = await create(`${PREFIX} kilit`);
    const s = await state(id);
    const first = await save({ ...s, name: { tr: `${PREFIX} kilit A` }, variants: [{ ...s.variants[0], price: 1000 }] });
    assert.equal(first.result.ok, true, JSON.stringify(first.result));
    // The second editor still holds the old updatedAt.
    const second = await save({ ...s, name: { tr: `${PREFIX} kilit B` }, variants: [{ ...s.variants[0], price: 1000 }] });
    expectFail(second.result, "conflict");
    assert.equal((await state(id)).name.tr, `${PREFIX} kilit A`);
  });

  test("tags: products + product:<slug>; categories when the category changes", async () => {
    const { id } = await create(`${PREFIX} etiket`);
    const s = await state(id);
    const { result, tags } = await save({ ...s, categoryId: 1, variants: [{ ...s.variants[0], price: 1000 }] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(tags.includes("products") && tags.includes(`product:${s.slug}`) && tags.includes("categories"), JSON.stringify(tags));
  });
});

describe("variants", () => {
  test("SKUs are unique ignoring case, against other products too", async () => {
    const { id } = await create(`${PREFIX} sku`);
    const s = await state(id);
    // PR-LVL-500 belongs to a seeded product.
    const clash = await save({ ...s, variants: [{ ...s.variants[0], sku: "pr-lvl-500", price: 1000 }] });
    expectFail(clash.result, "invalid", "variants.0.sku");
    const a = newKey();
    const b = newKey();
    const dup = await save({
      ...s,
      options: [{ key: newKey(), id: null, name: { tr: "Boy" }, display: "buttons", values: [
        { key: a, id: null, value: { tr: "A" }, swatchColor: "", swatchMediaId: null },
        { key: b, id: null, value: { tr: "B" }, swatchColor: "", swatchMediaId: null },
      ] }],
      variants: [
        { ...s.variants[0], sku: "PT-DUP", price: 1000, optionValueKeys: [a] },
        { ...s.variants[0], key: newKey(), id: null, sku: "pt-dup", price: 1000, isDefault: false, stockSeen: null, optionValueKeys: [b] },
      ],
    });
    expectFail(dup.result, "invalid", "variants.1.sku");
  });

  test("exactly one default variant, and it is active", async () => {
    const s = await productWithVariants("def");
    expectFail((await save({ ...s, variants: s.variants.map((v) => ({ ...v, isDefault: false })) })).result, "invalid", "variants");
    expectFail((await save({ ...s, variants: s.variants.map((v) => ({ ...v, isDefault: true })) })).result, "invalid", "variants");
    const inactiveDefault = s.variants.map((v) => (v.isDefault ? { ...v, isActive: false } : v));
    expectFail((await save({ ...s, variants: inactiveDefault })).result, "invalid", `variants.${s.variants.findIndex((v) => v.isDefault)}.isDefault`);
  });

  test("options and variant values stay consistent", async () => {
    const s = await productWithVariants("opt");
    assert.equal(s.options.length, 1);
    assert.equal(s.options[0].values.length, 2);
    assert.deepEqual(
      s.variants.map((v) => v.optionValueKeys.length),
      [1, 1],
    );
    // Same combination twice → refused.
    const same = await save({ ...s, variants: s.variants.map((v) => ({ ...v, optionValueKeys: [s.options[0].values[0].key] })) });
    expectFail(same.result, "invalid", "variants.1.optionValueKeys");
    // Removing a value that an active variant still uses → refused.
    const removed = await save({ ...s, options: [{ ...s.options[0], values: [s.options[0].values[0]] }] });
    expectFail(removed.result, "invalid", "variants.1.optionValueKeys");
    // Two variants without any option axis → refused.
    const noAxis = await save({ ...s, options: [], variants: s.variants.map((v) => ({ ...v, optionValueKeys: [] })) });
    expectFail(noAxis.result, "invalid", "variants");
    // Ids of another product's rows are refused.
    const other = await state((await create(`${PREFIX} yabanci`)).id);
    const foreign = await save({ ...s, variants: [s.variants[0], { ...s.variants[1], id: other.variants[0].id }] });
    expectFail(foreign.result, "invalid");
  });

  test("a variant a cart references is deactivated instead of deleted", async () => {
    const s = await productWithVariants("ref");
    const big = s.variants.find((v) => !v.isDefault)!;
    const [cart] = await db.insert(schema.carts).values({}).returning({ id: schema.carts.id });
    cartIds.push(cart.id);
    await db.insert(schema.cartItems).values({ cartId: cart.id, variantId: big.id!, quantity: 1 });
    const small = s.variants.find((v) => v.isDefault)!;
    const { result } = await save({ ...s, variants: [small] , options: s.options });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await state(s.id);
    const kept = after.variants.find((v) => v.id === big.id);
    assert.ok(kept, "referenced variant still exists");
    assert.equal(kept.isActive, false);
    assert.equal(kept.isDefault, false);
    assert.match((result as { message?: string }).message ?? JSON.stringify((result as { data?: { notes: string[] } }).data?.notes), /pasif/);
  });
});

describe("slug and redirects", () => {
  test("a slug change records a redirect and invalidates both product tags", async () => {
    const { id, slug } = await create(`${PREFIX} eski`);
    const s = await state(id);
    const { result, tags } = await save({ ...s, slug: `${PREFIX}-yeni`, variants: [{ ...s.variants[0], price: 1000 }] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(tags.includes("redirects") && tags.includes(`product:${slug}`) && tags.includes(`product:${PREFIX}-yeni`), JSON.stringify(tags));
    const rows = await db.select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/urunler/${slug}`));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].toPath, `/urunler/${PREFIX}-yeni`);
    // A slug another product uses is refused next to the field.
    const s2 = await state(id);
    const taken = await save({ ...s2, slug: "lavanta" });
    expectFail(taken.result, "invalid", "slug");
  });
});

describe("stock guard", () => {
  test("quick edit is refused when the stock changed since the user saw it", async () => {
    const s = await productWithVariants("stok");
    const v = s.variants.find((x) => !x.isDefault)!;
    assert.equal(v.stock, 7);
    // An order decrements the stock meanwhile.
    await db.update(schema.productVariants).set({ stock: 5 }).where(eq(schema.productVariants.id, v.id!));
    await assert.rejects(
      db.transaction((tx) => quickStockEdit(tx, { productId: s.id, items: [{ variantId: v.id!, seenStock: 7, stock: 20 }] })),
      (e: unknown) => e instanceof PanelError && e.code === "conflict" && Boolean(e.fieldErrors?.["items.0.stock"]),
    );
    const ok = await db.transaction((tx) => quickStockEdit(tx, { productId: s.id, items: [{ variantId: v.id!, seenStock: 5, stock: 20 }] }));
    assert.deepEqual(ok.stocks, [{ variantId: v.id, stock: 20 }]);
    // Another product's variant id is refused.
    await assert.rejects(
      db.transaction((tx) => quickStockEdit(tx, { productId: s.id, items: [{ variantId: 1, seenStock: 100, stock: 1 }] })),
      (e: unknown) => e instanceof PanelError && e.code === "invalid",
    );
  });

  test("the editor never overwrites a stock that changed meanwhile", async () => {
    const s = await productWithVariants("stok2");
    const i = s.variants.findIndex((x) => !x.isDefault);
    const v = s.variants[i];
    await db.update(schema.productVariants).set({ stock: 3 }).where(eq(schema.productVariants.id, v.id!));
    // Untouched stock in the editor: the save keeps the database value.
    const keep = await save({ ...s, name: { tr: `${PREFIX} stok2 ad` } });
    assert.equal(keep.result.ok, true, JSON.stringify(keep.result));
    assert.equal((await state(s.id)).variants[i].stock, 3);
    // Edited stock based on an old value: conflict at the field.
    const s2 = await state(s.id);
    const edited = await save({ ...s2, variants: s2.variants.map((x, j) => (j === i ? { ...x, stock: 50, stockSeen: 7 } : x)) });
    expectFail(edited.result, "conflict", `variants.${i}.stock`);
    // Edited from the current value: written.
    const fresh = await save({ ...s2, variants: s2.variants.map((x, j) => (j === i ? { ...x, stock: 50 } : x)) });
    assert.equal(fresh.result.ok, true, JSON.stringify(fresh.result));
    assert.equal((await state(s.id)).variants[i].stock, 50);
  });
});

describe("status, duplicate, delete, reorder", () => {
  test("duplicate makes a draft with -kopya slug, suffixed SKUs and no barcodes", async () => {
    const s = await productWithVariants("kopya");
    const copy = await db.transaction((tx) => duplicateProduct(tx, s.id));
    const c = await state(copy.id);
    assert.equal(c.slug, `${s.slug}-kopya`);
    assert.equal(c.status, "draft");
    assert.deepEqual(
      c.variants.map((v) => v.sku),
      s.variants.map((v) => `${v.sku}-KOPYA`),
    );
    assert.ok(c.variants.every((v) => v.barcode === "" && v.stock === 0));
    assert.equal(c.options[0].values.length, 2);
    assert.ok(c.variants.every((v) => v.optionValueKeys.length === 1));
  });

  test("activation needs priced, active variants; delete only drafts without references", async () => {
    const { id } = await create(`${PREFIX} sil`);
    const unpriced = await db.transaction((tx) => setProductStatus(tx, [id], "active"));
    assert.equal(unpriced.changed.length, 0);
    assert.equal(unpriced.skipped.length, 1);

    const s = await productWithVariants("silinmez");
    await db.transaction((tx) => setProductStatus(tx, [s.id], "active"));
    await assert.rejects(
      stamp(schema.products, s.id).then((updatedAt) => db.transaction((tx) => deleteProduct(tx, { id: s.id, updatedAt }))),
      (e: unknown) => e instanceof PanelError && e.code === "in_use",
    );
    // A draft used inside another bundle cannot be deleted either.
    await db.transaction((tx) => setProductStatus(tx, [s.id], "draft"));
    const bundle = await create(`${PREFIX} set`, "bundle");
    await db.insert(schema.bundleItems).values({ bundleProductId: bundle.id, variantId: s.variants[0].id!, quantity: 1 });
    await assert.rejects(
      stamp(schema.products, s.id).then((updatedAt) => db.transaction((tx) => deleteProduct(tx, { id: s.id, updatedAt }))),
      (e: unknown) => e instanceof PanelError && e.code === "in_use",
    );
    await db.delete(schema.bundleItems).where(eq(schema.bundleItems.bundleProductId, bundle.id));
    const updatedAt = await stamp(schema.products, id);
    const deleted = await db.transaction((tx) => deleteProduct(tx, { id, updatedAt }));
    assert.equal(deleted.slug, `${PREFIX}-sil`);
    assert.equal((await db.select().from(schema.products).where(eq(schema.products.id, id))).length, 0);
  });

  test("reorder needs the full list and leaves updated_at alone", async () => {
    const all = await db.select({ id: schema.products.id, updatedAt: schema.products.updatedAt }).from(schema.products).orderBy(schema.products.position, schema.products.id);
    const ids = all.map((r) => r.id);
    await assert.rejects(
      db.transaction((tx) => reorderProducts(tx, ids.slice(1))),
      (e: unknown) => e instanceof PanelError && e.code === "conflict",
    );
    const reversed = [...ids].reverse();
    await db.transaction((tx) => reorderProducts(tx, reversed));
    const now = await db.select({ id: schema.products.id, position: schema.products.position, updatedAt: schema.products.updatedAt }).from(schema.products);
    for (const r of now) {
      assert.equal(r.position, reversed.indexOf(r.id));
      assert.equal(r.updatedAt.getTime(), all.find((a) => a.id === r.id)!.updatedAt.getTime());
    }
  });
});

describe("categories", () => {
  test("create, rename slug (redirect), delete only after moving products", async () => {
    const parsed = categorySaveSchema.parse({
      id: null,
      updatedAt: null,
      slug: `${PREFIX}-kat`,
      name: { tr: "Test kategori" },
      description: null,
      imageId: null,
      accentColor: "",
      isVisible: false,
      seo: { title: null, description: null, ogImageId: null, noIndex: false },
    });
    const created = await db.transaction((tx) => saveCategory(tx, parsed));
    assert.equal(created.created, true);
    const loaded = await loadCategoryState(db, created.id);
    assert.ok(loaded);

    const renamed = await db.transaction((tx) =>
      saveCategory(tx, categorySaveSchema.parse({ ...loaded, slug: `${PREFIX}-kat-yeni` })),
    );
    assert.ok(renamed.tags.includes("redirects"));
    const [redirect] = await db.select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/kategori/${PREFIX}-kat`));
    assert.equal(redirect?.toPath, `/kategori/${PREFIX}-kat-yeni`);
    // Stale updatedAt → conflict.
    await assert.rejects(
      db.transaction((tx) => saveCategory(tx, categorySaveSchema.parse({ ...loaded, name: { tr: "X" } }))),
      (e: unknown) => e instanceof PanelError && e.code === "conflict",
    );

    // A product in the category blocks the delete until it is moved.
    const product = await create(`${PREFIX} kategorili`);
    await db.update(schema.products).set({ categoryId: created.id }).where(eq(schema.products.id, product.id));
    await assert.rejects(
      stamp(schema.categories, created.id).then((updatedAt) => db.transaction((tx) => deleteCategory(tx, { id: created.id, updatedAt }))),
      (e: unknown) => e instanceof PanelError && e.code === "in_use",
    );
    const categoryStamp = await stamp(schema.categories, created.id);
    const removed = await db.transaction((tx) => deleteCategory(tx, { id: created.id, updatedAt: categoryStamp, moveProductsTo: "none" }));
    assert.equal(removed.movedProducts.length, 1);
    const [p] = await db.select({ categoryId: schema.products.categoryId }).from(schema.products).where(eq(schema.products.id, product.id));
    assert.equal(p.categoryId, null);
    // Redirects to the deleted category are dropped.
    const left = await db.select().from(schema.redirects).where(and(like(schema.redirects.toPath, `/kategori/${PREFIX}%`)));
    assert.equal(left.length, 0);
  });

  test("category reorder needs the full list", async () => {
    const ids = categoryPositions.map((c) => c.id);
    await assert.rejects(
      db.transaction((tx) => reorderCategories(tx, ids.slice(1))),
      (e: unknown) => e instanceof PanelError && e.code === "conflict",
    );
  });
});
