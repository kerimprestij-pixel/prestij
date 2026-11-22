// Go-live data path: the table allow-list against src/db/schema (every table classified once, no
// content table pointing at a table that is not copied), the parents-first copy order, and the column
// compatibility rule of scripts/golive/copy-content.ts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import {
  CONTENT_TABLES,
  NEVER_COPY_TABLES,
  columnMismatch,
  externalParents,
  orderParentsFirst,
  type Column,
  type ForeignKeyEdge,
} from "../../scripts/golive/rules";

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
const schemaNames = tables.map((t) => getTableName(t)).sort();
const schemaEdges: ForeignKeyEdge[] = tables.flatMap((t) =>
  getTableConfig(t).foreignKeys.map((fk) => ({ child: getTableName(t), parent: getTableName(fk.reference().foreignTable) })),
);

describe("allow-list vs src/db/schema", () => {
  test("every schema table is either copied or never copied, exactly once", () => {
    const content = new Set<string>(CONTENT_TABLES);
    const never = new Set<string>(NEVER_COPY_TABLES);
    assert.equal(content.size, CONTENT_TABLES.length, "no duplicates in CONTENT_TABLES");
    assert.equal(never.size, NEVER_COPY_TABLES.length, "no duplicates in NEVER_COPY_TABLES");
    assert.deepEqual([...content].filter((t) => never.has(t)), [], "a table cannot be in both lists");
    assert.deepEqual([...content, ...never].sort(), schemaNames, "classify new tables in scripts/golive/rules.ts");
  });

  test("accounts, sessions, carts, orders and customer data are never copied", () => {
    for (const t of ["user", "account", "session", "verification", "carts", "cart_items", "orders", "payments", "coupons", "reviews", "newsletter_subscribers", "audit_log"]) {
      assert.ok((NEVER_COPY_TABLES as readonly string[]).includes(t), t);
    }
  });

  test("no copied table has a foreign key to a table that is not copied", () => {
    assert.deepEqual(externalParents(CONTENT_TABLES, schemaEdges), []);
  });

  test("the schema's foreign keys give a parents-first order of all content tables", () => {
    const order = orderParentsFirst(CONTENT_TABLES, schemaEdges);
    assert.deepEqual([...order].sort(), [...CONTENT_TABLES].sort());
    const at = new Map(order.map((t, i) => [t, i]));
    for (const { child, parent } of schemaEdges) {
      if (child === parent || !at.has(child) || !at.has(parent)) continue;
      assert.ok(at.get(parent)! < at.get(child)!, `${parent} before ${child}`);
    }
    assert.ok(at.get("media")! < at.get("categories")!);
    assert.ok(at.get("product_variants")! < at.get("variant_option_values")!);
    assert.ok(at.get("pages")! < at.get("page_sections")!);
  });
});

describe("orderParentsFirst", () => {
  test("keeps the input order when nothing forces a change", () => {
    assert.deepEqual(orderParentsFirst(["a", "b", "c"], []), ["a", "b", "c"]);
  });

  test("moves parents forward, ignores self references and tables outside the list", () => {
    const edges = [
      { child: "a", parent: "c" },
      { child: "b", parent: "b" },
      { child: "c", parent: "outside" },
      { child: "outside", parent: "a" },
    ];
    assert.deepEqual(orderParentsFirst(["a", "b", "c"], edges), ["b", "c", "a"]);
  });

  test("throws on a cycle between different tables", () => {
    assert.throws(() => orderParentsFirst(["a", "b"], [{ child: "a", parent: "b" }, { child: "b", parent: "a" }]), /cycle between: a, b/);
  });

  test("externalParents lists only edges leaving the list", () => {
    const edges = [
      { child: "a", parent: "b" },
      { child: "a", parent: "user" },
      { child: "x", parent: "user" },
    ];
    assert.deepEqual(externalParents(["a", "b"], edges), [{ child: "a", parent: "user" }]);
  });
});

describe("columnMismatch", () => {
  const col = (name: string, type = "integer", notNull = false, hasDefault = false): Column => ({ name, type, notNull, hasDefault });

  test("same columns in another physical order are compatible", () => {
    assert.equal(columnMismatch([col("id"), col("name", "text")], [col("name", "text"), col("id")]), null);
  });

  test("a missing column or another type is refused", () => {
    assert.match(columnMismatch([col("id"), col("extra")], [col("id")]) ?? "", /extra is missing on the target/);
    assert.match(columnMismatch([col("id")], [col("id", "bigint")]) ?? "", /integer locally but bigint/);
    assert.equal(columnMismatch(undefined, [col("id")]), "table missing");
  });

  test("extra target columns are fine when nullable or defaulted, refused when NOT NULL without default", () => {
    assert.equal(columnMismatch([col("id")], [col("id"), col("note", "text"), col("flag", "boolean", true, true)]), null);
    assert.match(columnMismatch([col("id")], [col("id"), col("must", "text", true, false)]) ?? "", /must are NOT NULL/);
  });
});
