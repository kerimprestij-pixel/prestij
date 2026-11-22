// Go-live CF-18: row level security on every table of the public schema (migration 0006_golive_rls), with no
// policies. The app connects as the tables' owner, which bypasses RLS (not FORCEd), so it reads and writes as
// before; any other role without BYPASSRLS (Supabase's anon / authenticated behind the Data API) sees no rows
// even when it has been granted SELECT. The role is created inside a transaction that is rolled back, and the
// write is rolled back too: nothing is left behind (no sequence is used).
import "./setup/local-only";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is, sql } from "drizzle-orm";
import { db, schema } from "@/db";

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction that is always rolled back. */
async function inRollback(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
}

const schemaTables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable)).map((t) => getTableConfig(t).name);

describe("CF-18: row level security", () => {
  test("enabled (not forced) on every table of the public schema, which the app's role owns; migration 0006 applied", async () => {
    const rows = await db.execute<{ name: string; rls: boolean; forced: boolean; owner: string; policies: number }>(sql`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`);
    assert.deepEqual(rows.map((r) => r.name).sort(), [...schemaTables].sort(), "every public table is a schema table");
    const [{ me }] = await db.execute<{ me: string }>(sql`select current_user as me`);
    for (const r of rows) {
      assert.equal(r.rls, true, `${r.name}: RLS enabled`);
      assert.equal(r.forced, false, `${r.name}: not forced (the owner bypasses it)`);
      assert.equal(r.policies, 0, `${r.name}: no policies`);
      assert.equal(r.owner, me, `${r.name}: owned by the app's role`);
    }
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    assert.ok(n >= 7, `migrations applied: ${n}`);
  });

  test("the app's role still reads and writes normally", async () => {
    await inRollback(async (tx) => {
      const [{ products }] = await tx.execute<{ products: number }>(sql`select count(*)::int as products from products`);
      assert.ok(products > 0, "catalog visible");
      const id = "golive-test-rls-verification";
      await tx.insert(schema.verification).values({ id, identifier: "golive-test-rls@test.local", value: "golive-test", expiresAt: new Date(Date.now() + 60_000) });
      const back = await tx.execute<{ id: string }>(sql`select id from verification where id = ${id}`);
      assert.equal(back.length, 1);
      await tx.execute(sql`update verification set value = 'golive-test-2' where id = ${id}`);
      await tx.execute(sql`delete from verification where id = ${id}`);
    });
    const [{ left }] = await db.execute<{ left: number }>(sql`select count(*)::int as "left" from verification where id like 'golive-test-%'`);
    assert.equal(left, 0);
  });

  test("a fresh role without BYPASSRLS sees zero rows, even with SELECT granted", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql.raw(`create role golive_test_role nologin nosuperuser nobypassrls`));
      await tx.execute(sql.raw(`grant usage on schema public to golive_test_role`));
      await tx.execute(sql.raw(`grant select on public.products, public.settings, public."user", public.orders to golive_test_role`));
      const [{ owner }] = await tx.execute<{ owner: number }>(sql`select count(*)::int as owner from products`);
      assert.ok(owner > 0);
      await tx.execute(sql.raw(`set local role golive_test_role`));
      for (const table of ["products", "settings", `"user"`, "orders"]) {
        const [{ n }] = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from public.${table}`));
        assert.equal(n, 0, `${table} is empty for a non-owner role`);
      }
      const [{ bypass }] = await tx.execute<{ bypass: boolean }>(sql`select rolbypassrls as bypass from pg_roles where rolname = current_user`);
      assert.equal(bypass, false);
      await tx.execute(sql.raw(`reset role`));
    });
    const roles = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_roles where rolname = 'golive_test_role'`);
    assert.equal(roles[0].n, 0, "the role was rolled back");
  });
});
