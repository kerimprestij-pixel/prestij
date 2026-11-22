// Day 6 CORE against the local PostgreSQL:
//   - the migration drizzle/0005_day6_wheel_video.sql is applied unchanged and is additive only (pinned
//     statements, column types/defaults, constraints and indexes, and the rules they enforce);
//   - FK behaviour: a deleted account takes its wheel coupons and unlinks its spins; a deleted coupon or
//     poster is unlinked;
//   - the giftWheel settings key (defaults while no row exists, a save round-trips, tags settings + wheel);
//   - applyCouponToCart (manual = the old applyCouponCode body; auto never overwrites, keeps "not now");
//   - findActiveWheelCoupon, the media kind filter of listMedia / getPanelMedia, COUNTED_STATUSES;
//   - every content-day6 step is idempotent.
// Every write happens inside a transaction that is rolled back (test data: day6-test-… / DAY6TEST… /
// …@test.local); the id sequences those writes advance are put back, and the touched tables are compared
// before and after.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-core-api.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNTED_ORDER_STATUSES, COUNTED_STATUSES } from "@/lib/b2b/queries";
import { TAGS } from "@/lib/cache-tags";
import { applyCouponToCart } from "@/lib/cart/mutations";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { pgConstraint, pgErrorCode } from "@/lib/db-errors";
import { getPanelMedia, listMedia } from "@/lib/panel/media/queries";
import { SETTINGS_INPUTS } from "@/lib/panel/settings/schemas";
import { readSettingsRow, settingsActionOptions } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { findActiveWheelCoupon } from "@/lib/wheel/prize-coupons";
import { STEPS } from "../../scripts/content-day6";

const MIGRATION_FILE = "drizzle/0005_day6_wheel_video.sql";
const MIGRATION = readFileSync(path.resolve(MIGRATION_FILE), "utf8");
const RUN = randomBytes(3).toString("hex");
const CODE = (tag: string) => `DAY6TEST-${RUN}-${tag}`.toUpperCase();
const USER_A = `day6-test-core-a-${RUN}`;
const USER_B = `day6-test-core-b-${RUN}`;
const FOLDER = `day6-test-core-${RUN}`;

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Runs `fn` in a savepoint and returns the PostgreSQL error it raised (the outer transaction stays usable). */
async function failure(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<{ code: string | null; constraint: string | null }> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx);
    });
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  assert.fail("expected a database error");
}

type Seq = { last_value: string; is_called: boolean };
/** Sequences advanced by the rolled-back writes below (nextval is not transactional). */
const SEQUENCES = ["coupons_id_seq", "cart_items_id_seq", "media_id_seq", "wheel_spins_id_seq", "page_sections_id_seq", "pages_id_seq", "legal_documents_id_seq"] as const;
/** Tables compared before/after (the ones these tests write and the live site does not write while browsing). */
const SNAPSHOT_TABLES = ["coupons", "media", "wheel_spins", "settings", "product_media", "pages", "page_sections", "legal_documents"] as const;
const seqBefore = new Map<string, Seq>();
const tablesBefore = new Map<string, string>();

const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const tableHash = async (table: string): Promise<string> => {
  const [row] = await db.execute<{ h: string }>(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`));
  return row.h;
};

let settings: CommerceSettings;
let variant: { id: number; price: number };

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
  settings = await loadCommerceSettings();
  const [row] = await db.execute<{ id: number; price: number }>(
    sql`select v.id, v.price from product_variants v join products p on p.id = v.product_id
        where p.status = 'active' and p.type = 'standard' and not p.business_only and v.is_active
          and v.price > 0 and v.price < ${settings.shipping.freeThreshold} and (not v.track_stock or v.allow_backorder or v.stock >= 50)
        order by v.price, v.id limit 1`,
  );
  assert.ok(row, "a buyable standard variant below the free-shipping threshold");
  variant = { id: Number(row.id), price: Number(row.price) };
  const leftovers = await db.execute<{ n: string }>(sql`select count(*)::text as n from coupons where code like 'DAY6TEST%'`);
  assert.equal(leftovers[0].n, "0", "no DAY6TEST coupons left over from an earlier run");
});

after(async () => {
  try {
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      }
      assert.deepEqual(await readSeq(name), seq, `${name} restored`);
    }
    for (const t of SNAPSHOT_TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
    const [own] = await db.execute<{ users: string; carts: string }>(
      sql`select (select count(*) from "user" where id like ${"day6-test-core-%"})::text as users, (select count(*) from carts where user_id like ${"day6-test-core-%"})::text as carts`,
    );
    assert.deepEqual({ ...own }, { users: "0", carts: "0" }, "no test users or carts left");
  } finally {
    await db.$client.end();
  }
});

const EXPECTED_STATEMENTS = [
  "CREATE TABLE \"wheel_spins\" (\n\t\"id\" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name \"wheel_spins_id_seq\" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),\n\t\"round\" integer NOT NULL,\n\t\"slice_key\" text NOT NULL,\n\t\"prize\" jsonb NOT NULL,\n\t\"status\" text DEFAULT 'spun' NOT NULL,\n\t\"user_id\" text,\n\t\"bound_via\" text,\n\t\"coupon_id\" integer,\n\t\"locale\" text DEFAULT 'tr' NOT NULL,\n\t\"ip_hash\" text,\n\t\"page_path\" text,\n\t\"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n\t\"bound_at\" timestamp with time zone,\n\t\"claimed_at\" timestamp with time zone,\n\t\"reminded_at\" timestamp with time zone,\n\tCONSTRAINT \"wheel_spins_status_check\" CHECK (\"wheel_spins\".\"status\" in ('spun', 'bound', 'claimed', 'expired')),\n\tCONSTRAINT \"wheel_spins_bound_via_check\" CHECK (\"wheel_spins\".\"bound_via\" is null or \"wheel_spins\".\"bound_via\" in ('register', 'sign_in', 'signed_in')),\n\tCONSTRAINT \"wheel_spins_page_path_check\" CHECK (\"wheel_spins\".\"page_path\" is null or char_length(\"wheel_spins\".\"page_path\") <= 200)\n);",
  "ALTER TABLE \"media\" ADD COLUMN \"kind\" text DEFAULT 'image' NOT NULL;",
  "ALTER TABLE \"media\" ADD COLUMN \"duration_ms\" integer;",
  "ALTER TABLE \"media\" ADD COLUMN \"poster_id\" integer;",
  "ALTER TABLE \"product_media\" ADD COLUMN \"autoplay\" boolean DEFAULT false NOT NULL;",
  "ALTER TABLE \"coupons\" ADD COLUMN \"source\" text DEFAULT 'manual' NOT NULL;",
  "ALTER TABLE \"coupons\" ADD COLUMN \"user_id\" text;",
  "ALTER TABLE \"wheel_spins\" ADD CONSTRAINT \"wheel_spins_user_id_user_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"public\".\"user\"(\"id\") ON DELETE set null ON UPDATE no action;",
  "ALTER TABLE \"wheel_spins\" ADD CONSTRAINT \"wheel_spins_coupon_id_coupons_id_fk\" FOREIGN KEY (\"coupon_id\") REFERENCES \"public\".\"coupons\"(\"id\") ON DELETE set null ON UPDATE no action;",
  "CREATE INDEX \"wheel_spins_user_id_index\" ON \"wheel_spins\" USING btree (\"user_id\");",
  "CREATE INDEX \"wheel_spins_created_at_index\" ON \"wheel_spins\" USING btree (\"created_at\");",
  "CREATE UNIQUE INDEX \"wheel_spins_user_round_unique\" ON \"wheel_spins\" USING btree (\"user_id\",\"round\") WHERE \"wheel_spins\".\"user_id\" is not null and \"wheel_spins\".\"status\" in ('bound', 'claimed');",
  "CREATE UNIQUE INDEX \"wheel_spins_coupon_unique\" ON \"wheel_spins\" USING btree (\"coupon_id\") WHERE \"wheel_spins\".\"coupon_id\" is not null;",
  "ALTER TABLE \"media\" ADD CONSTRAINT \"media_poster_id_media_id_fk\" FOREIGN KEY (\"poster_id\") REFERENCES \"public\".\"media\"(\"id\") ON DELETE set null ON UPDATE no action;",
  "ALTER TABLE \"coupons\" ADD CONSTRAINT \"coupons_user_id_user_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"public\".\"user\"(\"id\") ON DELETE cascade ON UPDATE no action;",
  "CREATE INDEX \"media_poster_id_index\" ON \"media\" USING btree (\"poster_id\");",
  "CREATE INDEX \"coupons_source_index\" ON \"coupons\" USING btree (\"source\");",
  "CREATE INDEX \"coupons_user_id_index\" ON \"coupons\" USING btree (\"user_id\");",
  "CREATE INDEX \"orders_coupon_id_index\" ON \"orders\" USING btree (\"coupon_id\");",
  "ALTER TABLE \"media\" ADD CONSTRAINT \"media_kind_check\" CHECK (\"media\".\"kind\" in ('image', 'video'));",
  "ALTER TABLE \"media\" ADD CONSTRAINT \"media_kind_mime_check\" CHECK ((\"media\".\"kind\" = 'video') = (\"media\".\"mime\" like 'video/%'));",
  "ALTER TABLE \"coupons\" ADD CONSTRAINT \"coupons_source_check\" CHECK (\"coupons\".\"source\" in ('manual', 'wheel'));",
  "ALTER TABLE \"coupons\" ADD CONSTRAINT \"coupons_wheel_owner_check\" CHECK (\"coupons\".\"source\" <> 'wheel' or \"coupons\".\"user_id\" is not null);",
];

describe("migration 0005_day6_wheel_video", () => {
  test("is applied, and the applied file is the one in the repository", async () => {
    const rows = await db.execute<{ hash: string; created_at: string }>(sql`select hash, created_at::text from drizzle.__drizzle_migrations order by id`);
    assert.ok(rows.length >= 6);
    const expected = createHash("sha256").update(MIGRATION).digest("hex");
    assert.ok(rows.some((r) => r.hash === expected), `${MIGRATION_FILE} changed after it was applied: write a new migration instead`);
    const journal = JSON.parse(readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const entry = journal.entries.find((e) => e.tag === "0005_day6_wheel_video");
    assert.ok(entry && rows.some((r) => r.created_at === String(entry.when)), "journal entry and migration row agree");
  });

  test("is additive only: a new table, new nullable or defaulted columns, foreign keys, indexes and checks", () => {
    const statements = MIGRATION.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(statements, EXPECTED_STATEMENTS);
    for (const s of statements) assert.match(s, /^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE "\w+" ADD (COLUMN|CONSTRAINT))/);
    assert.doesNotMatch(MIGRATION, /\b(DROP|RENAME|TRUNCATE|ALTER COLUMN)\b|^\s*(DELETE|UPDATE|INSERT)\b/im);
  });

  test("columns: types, nullability and defaults", async () => {
    const cols = await db.execute<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      sql`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and (
            (table_name = 'media' and column_name in ('kind', 'duration_ms', 'poster_id')) or
            (table_name = 'product_media' and column_name = 'autoplay') or
            (table_name = 'coupons' and column_name in ('source', 'user_id')))
          order by table_name, column_name`,
    );
    assert.deepEqual(
      cols.map((c) => [c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default]),
      [
        ["coupons", "source", "text", "NO", "'manual'::text"],
        ["coupons", "user_id", "text", "YES", null],
        ["media", "duration_ms", "integer", "YES", null],
        ["media", "kind", "text", "NO", "'image'::text"],
        ["media", "poster_id", "integer", "YES", null],
        ["product_media", "autoplay", "boolean", "NO", "false"],
      ],
    );
    const spins = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'wheel_spins' order by ordinal_position`,
    );
    assert.deepEqual(
      spins.map((c) => c.column_name),
      ["id", "round", "slice_key", "prize", "status", "user_id", "bound_via", "coupon_id", "locale", "ip_hash", "page_path", "created_at", "bound_at", "claimed_at", "reminded_at"],
    );
  });

  test("existing rows took the defaults: media kinds agree with the mime, no owner-less wheel coupon", async () => {
    const [m] = await db.execute<{ n: string }>(sql`select count(*)::text as n from media where (kind = 'video') <> (mime like 'video/%')`);
    assert.equal(m.n, "0");
    const [c] = await db.execute<{ n: string }>(sql`select count(*)::text as n from coupons where source = 'wheel' and user_id is null`);
    assert.equal(c.n, "0");
  });
});

describe("constraints and indexes", () => {
  test("media: kind is image|video and always agrees with the mime", async () => {
    await inRollback(async (tx) => {
      const row = (key: string, kind: string, mime: string) => ({ storageKey: `${FOLDER}/${key}`, url: `/uploads/${FOLDER}/${key}`, mime, kind: kind as "image", folder: FOLDER });
      assert.equal((await failure(tx, (sp) => sp.insert(schema.media).values(row("a.mp4", "image", "video/mp4")))).constraint, "media_kind_mime_check");
      assert.equal((await failure(tx, (sp) => sp.insert(schema.media).values(row("b.webp", "video", "image/webp")))).constraint, "media_kind_mime_check");
      assert.equal((await failure(tx, (sp) => sp.insert(schema.media).values(row("c.gif", "gif", "image/gif")))).constraint, "media_kind_check");
      const [ok] = await tx.insert(schema.media).values(row("d.mp4", "video", "video/mp4")).returning({ kind: schema.media.kind });
      assert.equal(ok.kind, "video");
      const [img] = await tx
        .insert(schema.media)
        .values({ storageKey: `${FOLDER}/e.webp`, url: `/uploads/${FOLDER}/e.webp`, mime: "image/webp", folder: FOLDER })
        .returning({ kind: schema.media.kind });
      assert.equal(img.kind, "image", "the default kind");
    });
  });

  test("coupons: source manual|wheel; a wheel prize must have an owner", async () => {
    await inRollback(async (tx) => {
      await tx.insert(schema.user).values({ id: USER_A, name: "Day6 Test A", email: `${USER_A}@test.local` });
      const base = { type: "percent" as const, value: 10 };
      assert.equal((await failure(tx, (sp) => sp.insert(schema.coupons).values({ ...base, code: CODE("w0"), source: "wheel" }))).constraint, "coupons_wheel_owner_check");
      assert.equal((await failure(tx, (sp) => sp.insert(schema.coupons).values({ ...base, code: CODE("x0"), source: "gift" as "wheel" }))).constraint, "coupons_source_check");
      const [manual] = await tx.insert(schema.coupons).values({ ...base, code: CODE("m0") }).returning({ source: schema.coupons.source, userId: schema.coupons.userId });
      assert.deepEqual(manual, { source: "manual", userId: null });
      await tx.insert(schema.coupons).values({ ...base, code: CODE("w1"), source: "wheel", userId: USER_A });
      const dup = await failure(tx, (sp) => sp.insert(schema.coupons).values({ ...base, code: CODE("w1").toLowerCase(), source: "wheel", userId: USER_A }));
      assert.equal(dup.code, "23505", "codes stay unique case-insensitively");
    });
  });

  test("wheel_spins: statuses, bound_via, page_path length; one bound/claimed spin per account and round", async () => {
    await inRollback(async (tx) => {
      await tx.insert(schema.user).values({ id: USER_A, name: "Day6 Test A", email: `${USER_A}@test.local` });
      const prize = { type: "percent" as const, value: 10, label: { tr: "%10 indirim" }, minOrderTotal: 0 };
      const spin = (over: Partial<typeof schema.wheelSpins.$inferInsert> = {}) => ({ round: 1, sliceKey: "indirim-10", prize, ...over });
      assert.equal((await failure(tx, (sp) => sp.insert(schema.wheelSpins).values(spin({ status: "won" as "spun" })))).constraint, "wheel_spins_status_check");
      assert.equal((await failure(tx, (sp) => sp.insert(schema.wheelSpins).values(spin({ boundVia: "email" as "register" })))).constraint, "wheel_spins_bound_via_check");
      assert.equal((await failure(tx, (sp) => sp.insert(schema.wheelSpins).values(spin({ pagePath: `/${"x".repeat(200)}` })))).constraint, "wheel_spins_page_path_check");
      const [first] = await tx.insert(schema.wheelSpins).values(spin()).returning();
      assert.equal(first.status, "spun");
      assert.equal(first.locale, "tr");
      // Anonymous spins and the account's "spun"/"expired" spins do not count.
      await tx.insert(schema.wheelSpins).values([spin({ userId: USER_A, status: "spun" }), spin({ userId: USER_A, status: "expired" })]);
      await tx.insert(schema.wheelSpins).values(spin({ userId: USER_A, status: "bound", boundVia: "register" }));
      const dup = await failure(tx, (sp) => sp.insert(schema.wheelSpins).values(spin({ userId: USER_A, status: "claimed", boundVia: "sign_in" })));
      assert.deepEqual(dup, { code: "23505", constraint: "wheel_spins_user_round_unique" });
      await tx.insert(schema.wheelSpins).values(spin({ userId: USER_A, round: 2, status: "claimed", boundVia: "signed_in" }));
    });
  });

  test("indexes exist", async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' and indexname in (
            'coupons_source_index', 'coupons_user_id_index', 'orders_coupon_id_index', 'media_poster_id_index',
            'wheel_spins_user_id_index', 'wheel_spins_created_at_index', 'wheel_spins_user_round_unique', 'wheel_spins_coupon_unique')
          order by indexname`,
    );
    assert.equal(rows.length, 8);
  });
});

describe("foreign keys", () => {
  // The two account paths are checked one by one: a spin row inserted in the SAME transaction as the
  // account delete re-checks its coupon FK before the coupon's own SET NULL has run (PostgreSQL skips that
  // check for rows of earlier transactions, i.e. every real spin). See DAY6-CORE-API.md "Gotchas".
  test("a deleted account takes its wheel coupons and unlinks its spins; deleted coupons and posters are unlinked", async () => {
    await inRollback(async (tx) => {
      await tx.insert(schema.user).values({ id: USER_A, name: "Day6 Test A", email: `${USER_A}@test.local` });
      const prize = { type: "free_shipping" as const, value: 0, label: { tr: "Ücretsiz kargo" }, minOrderTotal: 0 };
      const [coupon] = await tx
        .insert(schema.coupons)
        .values({ code: CODE("fk"), type: "free_shipping", source: "wheel", userId: USER_A })
        .returning({ id: schema.coupons.id });
      const [spin] = await tx
        .insert(schema.wheelSpins)
        .values({ round: 1, sliceKey: "ucretsiz-kargo", prize, status: "claimed", userId: USER_A, boundVia: "signed_in", couponId: coupon.id })
        .returning({ id: schema.wheelSpins.id });
      const second = await failure(tx, (sp) => sp.insert(schema.wheelSpins).values({ round: 1, sliceKey: "x", prize, couponId: coupon.id }));
      assert.equal(second.constraint, "wheel_spins_coupon_unique", "a prize coupon belongs to one spin");
      await tx.delete(schema.coupons).where(eq(schema.coupons.id, coupon.id));
      const [unlinked] = await tx.select({ couponId: schema.wheelSpins.couponId }).from(schema.wheelSpins).where(eq(schema.wheelSpins.id, spin.id));
      assert.equal(unlinked.couponId, null, "a deleted coupon is unlinked from its spin");

      const [personal] = await tx
        .insert(schema.coupons)
        .values({ code: CODE("fk2"), type: "free_shipping", source: "wheel", userId: USER_A })
        .returning({ id: schema.coupons.id });
      await tx.delete(schema.user).where(eq(schema.user.id, USER_A));
      assert.equal((await tx.select().from(schema.coupons).where(eq(schema.coupons.id, personal.id))).length, 0, "the personal prize went with the account");
      const [kept] = await tx.select({ userId: schema.wheelSpins.userId }).from(schema.wheelSpins).where(eq(schema.wheelSpins.id, spin.id));
      assert.equal(kept.userId, null, "the spin row stays for statistics, without the account");

      const [poster] = await tx
        .insert(schema.media)
        .values({ storageKey: `${FOLDER}/p.webp`, url: `/uploads/${FOLDER}/p.webp`, mime: "image/webp", folder: FOLDER })
        .returning({ id: schema.media.id });
      const [video] = await tx
        .insert(schema.media)
        .values({ storageKey: `${FOLDER}/v.mp4`, url: `/uploads/${FOLDER}/v.mp4`, mime: "video/mp4", kind: "video", durationMs: 12_000, posterId: poster.id, folder: FOLDER })
        .returning({ id: schema.media.id });
      await tx.delete(schema.media).where(eq(schema.media.id, poster.id));
      const [v] = await tx.select({ posterId: schema.media.posterId }).from(schema.media).where(eq(schema.media.id, video.id));
      assert.equal(v.posterId, null);
    });
  });
});

describe("giftWheel settings", () => {
  test("reads a complete document whatever is stored, and the panel editor accepts it", async () => {
    const row = await readSettingsRow("giftWheel");
    assert.equal(typeof row.value.enabled, "boolean");
    assert.ok(row.value.slices.length >= 4 && row.value.slices.length <= 8);
    if (row.updatedAt === null) assert.equal(row.value.enabled, false, "no row yet: the code default keeps the wheel off");
    assert.ok(SETTINGS_INPUTS.giftWheel.safeParse(row.value).success);
  });

  test("a save round-trips and invalidates the settings and wheel tags", async () => {
    await inRollback(async (tx) => {
      const row = await readSettingsRow("giftWheel", tx);
      const value = SETTINGS_INPUTS.giftWheel.parse({
        ...row.value,
        enabled: true,
        round: row.value.round + 1,
        startsAt: "2026-12-01T09:00",
        texts: { title: { tr: "Yılbaşı Çarkı" } },
      });
      const result = await settingsActionOptions("giftWheel").run({ value, updatedAt: row.updatedAt ? new Date(row.updatedAt) : null }, { tx });
      assert.deepEqual(result.tags, [TAGS.settings, TAGS.wheel]);
      assert.equal(result.message, "Hediye çarkı ayarları kaydedildi.");
      const back = await readSettingsRow("giftWheel", tx);
      assert.equal(back.value.enabled, true);
      assert.equal(back.value.startsAt, "2026-12-01T06:00:00.000Z");
      assert.deepEqual(back.value.texts.title, { tr: "Yılbaşı Çarkı" });
      assert.deepEqual(back.value.slices, row.value.slices);
    });
  });
});

describe("applyCouponToCart", () => {
  const owner: CustomerContext = { ...RETAIL_CUSTOMER, userId: USER_A };
  const now = () => new Date();

  async function setup(tx: Tx, quantity = 1, couponCode: string | null = null) {
    await tx.insert(schema.user).values([
      { id: USER_A, name: "Day6 Test A", email: `${USER_A}@test.local` },
      { id: USER_B, name: "Day6 Test B", email: `${USER_B}@test.local` },
    ]);
    const [cart] = await tx
      .insert(schema.carts)
      .values({ userId: USER_A, locale: "tr", couponCode, expiresAt: new Date(Date.now() + 86400_000) })
      .returning({ id: schema.carts.id });
    await tx.insert(schema.cartItems).values({ cartId: cart.id, variantId: variant.id, quantity });
    const coupon = async (tag: string, over: Partial<typeof schema.coupons.$inferInsert> = {}) => {
      const code = CODE(tag);
      await tx.insert(schema.coupons).values({ code, type: "percent", value: 10, ...over });
      return code;
    };
    const stored = async () => (await tx.select({ code: schema.carts.couponCode }).from(schema.carts).where(eq(schema.carts.id, cart.id)))[0].code;
    return { cartId: cart.id, coupon, stored };
  }

  test("manual: applies a valid code; refusals carry the cart error and write nothing", async () => {
    await inRollback(async (tx) => {
      const { cartId, coupon, stored } = await setup(tx);
      const ten = await coupon("m10");
      const high = await coupon("mhigh", { minOrderTotal: 10_000_000 });
      const r = await applyCouponToCart(tx, { cartId, code: ` ${ten.toLowerCase()} `, customer: owner, now: now(), mode: "manual", locale: "en", settings });
      assert.equal(r.status, "applied");
      assert.equal(r.status === "applied" && r.code, ten);
      assert.equal(await stored(), ten);
      const [{ locale }] = await tx.select({ locale: schema.carts.locale }).from(schema.carts).where(eq(schema.carts.id, cartId));
      assert.equal(locale, "en", "the cart write keeps setting the locale");
      assert.deepEqual(await applyCouponToCart(tx, { cartId, code: high, customer: owner, now: now(), mode: "manual", settings }), {
        status: "refused",
        cartId,
        code: "coupon_min_order",
        reason: "min_order",
        vars: { amount: 10_000_000 },
      });
      assert.deepEqual(await applyCouponToCart(tx, { cartId, code: "  ", customer: owner, now: now(), mode: "manual", settings }), {
        status: "refused",
        cartId,
        code: "coupon_empty",
      });
      assert.deepEqual(await applyCouponToCart(tx, { cartId, code: "DAY6TEST-NOPE", customer: owner, now: now(), mode: "manual", settings }), {
        status: "refused",
        cartId,
        code: "coupon_not_found",
        reason: "not_found",
      });
      assert.equal(await stored(), ten, "the earlier code stays");
    });
  });

  test("an account-bound code answers 'not found' to anyone else, in both modes", async () => {
    await inRollback(async (tx) => {
      const { cartId, coupon, stored } = await setup(tx);
      const prize = await coupon("own", {
        source: "wheel",
        userId: USER_B,
        maxUses: 1,
        perCustomerLimit: 1,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 72 * 3600_000),
      });
      for (const mode of ["manual", "auto"] as const) {
        const r = await applyCouponToCart(tx, { cartId, code: prize, customer: owner, now: now(), mode, settings });
        assert.deepEqual(r, { status: "refused", cartId, code: "coupon_not_found", reason: "not_owner" }, mode);
      }
      assert.equal(await stored(), null);
      const mine = await applyCouponToCart(tx, { cartId, code: prize, customer: { ...RETAIL_CUSTOMER, userId: USER_B }, now: now(), mode: "auto", settings });
      assert.equal(mine.status, "applied", "the owner gets it");
    });
  });

  test("auto: never overwrites a code on the cart; 'not now' outcomes are kept, dead prizes refused", async () => {
    await inRollback(async (tx) => {
      const { cartId, coupon, stored } = await setup(tx, 1, "TYPED-BY-BUYER");
      const prize = await coupon("auto");
      const auto = (code: string, id: string | null = cartId) => applyCouponToCart(tx, { cartId: id, code, customer: owner, now: now(), mode: "auto", settings });
      assert.deepEqual(await auto(prize), { status: "kept", cartId, reason: "cart_has_code" });
      assert.equal(await stored(), "TYPED-BY-BUYER");
      await tx.update(schema.carts).set({ couponCode: prize.toLowerCase() }).where(eq(schema.carts.id, cartId));
      assert.deepEqual(await auto(prize), { status: "kept", cartId, reason: "already_applied" });
      assert.deepEqual(await auto(prize, null), { status: "kept", cartId: null, reason: "no_cart" });
      await tx.update(schema.carts).set({ couponCode: null }).where(eq(schema.carts.id, cartId));
      assert.deepEqual(await auto(await coupon("ahigh", { minOrderTotal: 10_000_000 })), { status: "kept", cartId, reason: "min_order" });
      assert.deepEqual(await auto(await coupon("aother", { productIds: [-1] })), { status: "kept", cartId, reason: "no_eligible_items" });
      assert.deepEqual(await auto(await coupon("aexp", { endsAt: new Date(Date.now() - 1000) })), {
        status: "refused",
        cartId,
        code: "coupon_expired",
        reason: "expired",
      });
      assert.equal(await stored(), null, "nothing invalid was left on the cart");
      assert.equal((await auto(prize)).status, "applied");
      assert.equal(await stored(), prize);
    });
  });

  test("auto: free shipping on a cart that already ships free is kept for later (manual: coupon_no_benefit)", async () => {
    await inRollback(async (tx) => {
      const quantity = Math.ceil(settings.shipping.freeThreshold / variant.price);
      const { cartId, coupon, stored } = await setup(tx, quantity);
      const ship = await coupon("ship", { type: "free_shipping", value: 0 });
      assert.deepEqual(await applyCouponToCart(tx, { cartId, code: ship, customer: owner, now: now(), mode: "auto", settings }), {
        status: "kept",
        cartId,
        reason: "no_benefit",
      });
      assert.deepEqual(await applyCouponToCart(tx, { cartId, code: ship, customer: owner, now: now(), mode: "manual", settings }), {
        status: "refused",
        cartId,
        code: "coupon_no_benefit",
      });
      assert.equal(await stored(), null);
    });
  });
});

describe("findActiveWheelCoupon", () => {
  test("the account's usable prize that expires first, with the spin's label; nothing else", async () => {
    await inRollback(async (tx) => {
      await tx.insert(schema.user).values([
        { id: USER_A, name: "Day6 Test A", email: `${USER_A}@test.local` },
        { id: USER_B, name: "Day6 Test B", email: `${USER_B}@test.local` },
      ]);
      const now = new Date();
      const h = (n: number) => new Date(now.getTime() + n * 3600_000);
      const wheel = (tag: string, over: Partial<typeof schema.coupons.$inferInsert> = {}) => ({
        code: CODE(tag),
        type: "percent" as const,
        value: 10,
        source: "wheel" as const,
        userId: USER_A,
        maxUses: 1,
        perCustomerLimit: 1,
        startsAt: h(-1),
        endsAt: h(48),
        ...over,
      });
      assert.equal(await findActiveWheelCoupon(tx, USER_A, now), null);
      await tx.insert(schema.coupons).values([
        wheel("used", { usedCount: 1, endsAt: h(2) }),
        wheel("expired", { endsAt: h(-0.5) }),
        wheel("off", { isActive: false, endsAt: h(3) }),
        wheel("future", { startsAt: h(1), endsAt: h(4) }),
        wheel("other", { userId: USER_B, endsAt: h(5) }),
        { code: CODE("manual"), type: "percent" as const, value: 10, userId: USER_A, endsAt: h(6) },
        wheel("later", { endsAt: h(70) }),
      ]);
      const [soon] = await tx
        .insert(schema.coupons)
        .values(wheel("soon", { type: "fixed", value: 5000, minOrderTotal: 30000, endsAt: h(24) }))
        .returning({ id: schema.coupons.id });
      await tx.insert(schema.wheelSpins).values({
        round: 1,
        sliceKey: "indirim-50-tl",
        status: "claimed",
        userId: USER_A,
        boundVia: "signed_in",
        couponId: soon.id,
        prize: { type: "fixed", value: 5000, label: { tr: "50 TL indirim", en: "₺50 off" }, minOrderTotal: 30000 },
      });
      const found = await findActiveWheelCoupon(tx, USER_A, now);
      assert.deepEqual(found && { ...found, endsAt: found.endsAt.toISOString() }, {
        couponId: soon.id,
        code: CODE("soon"),
        endsAt: h(24).toISOString(),
        label: { tr: "50 TL indirim", en: "₺50 off" },
        type: "fixed",
        value: 5000,
        minOrderTotal: 30000,
      });
      assert.equal((await findActiveWheelCoupon(tx, USER_B, now))?.code, CODE("other"));
      assert.equal(await findActiveWheelCoupon(tx, "", now), null);
      const later = await findActiveWheelCoupon(tx, USER_A, h(30));
      assert.equal(later?.code, CODE("later"), "after the first one ends, the next");
      assert.equal(later?.label, undefined, "no spin row: no label");
    });
  });
});

describe("media kind filter", () => {
  test("listMedia offers images by default, videos (with their poster) on request, both with 'all'", async () => {
    await inRollback(async (tx) => {
      const [poster] = await tx
        .insert(schema.media)
        .values({ storageKey: `${FOLDER}/kapak-768.webp`, url: `/uploads/${FOLDER}/kapak-768.webp`, mime: "image/webp", width: 768, height: 432, folder: FOLDER, originalName: "kapak.jpg" })
        .returning({ id: schema.media.id });
      const [video] = await tx
        .insert(schema.media)
        .values({
          storageKey: `${FOLDER}/tanitim.mp4`,
          url: `/uploads/${FOLDER}/tanitim.mp4`,
          mime: "video/mp4",
          kind: "video",
          width: 1920,
          height: 1080,
          durationMs: 42_000,
          posterId: poster.id,
          folder: FOLDER,
          originalName: "tanitim.mp4",
        })
        .returning({ id: schema.media.id });
      const ids = async (kind?: "image" | "video" | "all") => (await listMedia({ folder: FOLDER, ...(kind ? { kind } : {}) }, tx)).items.map((m) => m.id);
      assert.deepEqual(await ids(), [poster.id], "default: images only (every existing picker)");
      assert.deepEqual(await ids("image"), [poster.id]);
      assert.deepEqual(await ids("video"), [video.id]);
      assert.deepEqual(await ids("all"), [video.id, poster.id]);
      assert.deepEqual(await ids("bogus" as "all"), [poster.id], "unknown → images");
      const [v] = (await listMedia({ folder: FOLDER, kind: "video" }, tx)).items;
      assert.equal(v.kind, "video");
      assert.equal(v.durationMs, 42_000);
      assert.equal(v.posterId, poster.id);
      assert.equal(v.poster?.id, poster.id);
      assert.equal(v.poster?.url, `/uploads/${FOLDER}/kapak-768.webp`);
      const byId = await getPanelMedia([video.id, poster.id], tx);
      assert.deepEqual(
        byId.map((m) => [m.id, m.kind, m.poster?.id ?? null]),
        [
          [video.id, "video", poster.id],
          [poster.id, "image", null],
        ],
      );
    });
  });
});

describe("COUNTED_STATUSES", () => {
  test("the exported list and its SQL tuple agree and run", async () => {
    assert.deepEqual([...COUNTED_ORDER_STATUSES], ["paid", "processing", "shipped", "delivered", "awaiting_transfer"]);
    const [row] = await db.execute<{ n: string; m: string }>(
      sql`select (select count(*) from orders where status in ${COUNTED_STATUSES})::text as n,
                 (select count(*) from orders where status in (${sql.join(COUNTED_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `)}))::text as m`,
    );
    assert.equal(row.n, row.m);
  });
});

describe("content-day6 steps", () => {
  for (const step of STEPS) {
    test(`${step.key} (${step.owner}) is idempotent: a second run has nothing to do`, async () => {
      await inRollback(async (tx) => {
        await step.run(tx as never);
        const second = await step.run(tx as never);
        assert.deepEqual([second.inserted, second.updated], [[], []], second.inserted.concat(second.updated).join("\n"));
      });
    });
  }
});
