// CORE-DATA against the local PostgreSQL: the day-4 migration (drizzle/0003_day4.sql) — applied and
// unchanged since, its data fix (every staff account verified; the statement itself re-run on a test
// user), the partial unique indexes (barcode, reviews, e-mail dedupe key) and Better Auth's rate_limit
// table shape. Rows it creates are removed again and the id sequences put back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/migration-day4.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { pgConstraint, pgErrorCode } from "@/lib/db-errors";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `coredata-mig-${RUN}`;
const MIGRATION = readFileSync(path.resolve("drizzle/0003_day4.sql"), "utf8");
const SEQ_TABLES = ["products", "product_variants", "reviews", "email_messages"] as const;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let sequences: SeqState[] = [];

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

/** Puts the id sequences back unless someone else inserted rows meanwhile (other agents share the DB). */
async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

async function cleanup() {
  await db.delete(schema.products).where(like(schema.products.slug, `${PREFIX}%`)); // variants + reviews cascade
  await db.delete(schema.emailMessages).where(like(schema.emailMessages.template, `${PREFIX}%`));
  await db.delete(schema.user).where(like(schema.user.email, `${PREFIX}-%@test.local`));
}

/** Runs `fn`, expecting a unique violation of `constraint`. */
async function expectUnique(constraint: string, fn: () => Promise<unknown>) {
  await assert.rejects(fn, (error: unknown) => {
    assert.equal(pgErrorCode(error), "23505");
    assert.equal(pgConstraint(error), constraint);
    return true;
  });
}

before(async () => {
  await cleanup();
  sequences = await readSequences();
});

after(async () => {
  try {
    await cleanup();
    await restoreSequences();
  } finally {
    await db.$client.end();
  }
});

describe("day-4 migration", () => {
  test("is applied, and the applied file is the one in the repository", async () => {
    const rows = await db.execute<{ hash: string }>(sql`select hash from drizzle.__drizzle_migrations order by id`);
    assert.ok(rows.length >= 4);
    const expected = createHash("sha256").update(MIGRATION).digest("hex");
    assert.ok(
      rows.some((r) => r.hash === expected),
      "drizzle/0003_day4.sql changed after it was applied: write a new migration instead",
    );
  });

  test("every staff account is verified", async () => {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from "user" where role in ('admin', 'editor', 'staff') and email_verified = false`,
    );
    assert.equal(row.n, 0);
  });

  test("the data-fix statement verifies staff accounts and leaves customers alone", async () => {
    const statement = MIGRATION.split("--> statement-breakpoint")
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .find((s) => s.startsWith(`UPDATE "user" SET "email_verified" = true`));
    assert.ok(statement, "the UPDATE is in the migration");
    const users = ["staff", "editor", "admin", "customer"].map((role) => ({
      id: `${PREFIX}-${role}`,
      name: `Migration ${role}`,
      email: `${PREFIX}-${role}@test.local`,
      role: role as "staff" | "editor" | "admin" | "customer",
      emailVerified: false,
    }));
    await db.insert(schema.user).values(users);
    // Re-run the migration's statement, limited to this file's users (other agents share the table).
    await db.execute(sql.raw(`${statement.replace(/;\s*$/, "")} AND "email" LIKE '${PREFIX}-%@test.local'`));
    const after = await db
      .select({ role: schema.user.role, verified: schema.user.emailVerified })
      .from(schema.user)
      .where(inArray(schema.user.id, users.map((u) => u.id)));
    const byRole = Object.fromEntries(after.map((u) => [u.role, u.verified]));
    assert.deepEqual(byRole, { staff: true, editor: true, admin: true, customer: false });
  });

  test("barcodes are unique when set; null and empty may repeat", async () => {
    const [product] = await db
      .insert(schema.products)
      .values({ slug: `${PREFIX}-urun`, name: { tr: "Migration test" }, status: "draft" })
      .returning({ id: schema.products.id });
    const variant = (n: number, barcode: string | null) => ({ productId: product.id, sku: `${PREFIX}-${n}`.toUpperCase(), price: 1000, barcode });
    await db.insert(schema.productVariants).values([variant(1, "2000000000015"), variant(2, null), variant(3, null), variant(4, ""), variant(5, "")]);
    await expectUnique("product_variants_barcode_unique", () => db.insert(schema.productVariants).values(variant(6, "2000000000015")));
    // Changing another variant to a taken barcode is refused too.
    const [v2] = await db.select({ id: schema.productVariants.id }).from(schema.productVariants).where(eq(schema.productVariants.sku, `${PREFIX}-2`.toUpperCase()));
    await expectUnique("product_variants_barcode_unique", () =>
      db.update(schema.productVariants).set({ barcode: "2000000000015" }).where(eq(schema.productVariants.id, v2.id)),
    );
  });

  test("one review per customer and product, and per order and product", async () => {
    const [product] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, `${PREFIX}-urun`));
    assert.ok(product, "created by the previous test");
    const review = (extra: { userId?: string; orderId?: number }) => ({ productId: product.id, authorName: "M. T.", rating: 5, ...extra });
    await db.insert(schema.reviews).values([review({ userId: `${PREFIX}-customer` }), review({ orderId: 990001 }), review({}), review({})]);
    await expectUnique("reviews_product_user_unique", () => db.insert(schema.reviews).values(review({ userId: `${PREFIX}-customer` })));
    await expectUnique("reviews_product_order_unique", () => db.insert(schema.reviews).values(review({ orderId: 990001 })));
  });

  test("an e-mail dedupe key is used once; rows without a key may repeat", async () => {
    const mail = (dedupeKey: string | null) => ({
      template: `${PREFIX}-template`,
      toEmail: `${PREFIX}@test.local`,
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
      relatedType: "test" as const,
      dedupeKey,
    });
    await db.insert(schema.emailMessages).values([mail(`${PREFIX}:once`), mail(null), mail(null)]);
    await expectUnique("email_messages_dedupe_key_unique", () => db.insert(schema.emailMessages).values(mail(`${PREFIX}:once`)));
    const [row] = await db.select().from(schema.emailMessages).where(eq(schema.emailMessages.dedupeKey, `${PREFIX}:once`));
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
    assert.equal(row.locale, "tr");
    assert.ok(row.sendAfter instanceof Date);
  });

  test("Better Auth's rate_limit table has exactly the expected columns", async () => {
    const cols = await db.execute<{ column_name: string; data_type: string; is_nullable: string }>(
      sql`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'rate_limit' order by column_name`,
    );
    assert.deepEqual(
      cols.map((c) => [c.column_name, c.data_type, c.is_nullable]),
      [
        ["count", "integer", "NO"],
        ["id", "text", "NO"],
        ["key", "text", "NO"],
        ["last_request", "bigint", "NO"],
      ],
    );
    const [unique] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_indexes where tablename = 'rate_limit' and indexdef like 'CREATE UNIQUE INDEX%(key)'`,
    );
    assert.equal(unique.n, 1, "key is unique");
  });

  test("new columns have their defaults (existing rows keep working)", async () => {
    const cols = await db.execute<{ table_name: string; column_name: string; column_default: string | null; is_nullable: string }>(sql`
      select table_name, column_name, column_default, is_nullable from information_schema.columns
      where table_schema = 'public' and (table_name, column_name) in (
        ('subscriptions', 'skip_next'), ('subscriptions', 'failed_count'), ('subscriptions', 'locale'),
        ('email_campaigns', 'locale_mode'), ('newsletter_subscribers', 'status'), ('orders', 'subscription_id'))
      order by table_name, column_name`);
    const byName = Object.fromEntries(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
    assert.match(byName["subscriptions.skip_next"].column_default ?? "", /false/);
    assert.match(byName["subscriptions.failed_count"].column_default ?? "", /0/);
    assert.match(byName["subscriptions.locale"].column_default ?? "", /'tr'/);
    assert.match(byName["email_campaigns.locale_mode"].column_default ?? "", /'per_subscriber'/);
    assert.match(byName["newsletter_subscribers.status"].column_default ?? "", /'active'/, "existing flows stay active; opt-in inserts pending");
    assert.equal(byName["orders.subscription_id"].is_nullable, "YES");
  });
});
