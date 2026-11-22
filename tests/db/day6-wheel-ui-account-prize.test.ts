// Day 6 WHEEL-UI against the local PostgreSQL: the account card's prize query (queryAccountWheelPrize):
// the usable prize that expires first, else the latest used or expired one for 30 days after its end;
// never another account's, never a switched-off one; the label comes from the spin snapshot.
// Every write happens inside a transaction that is rolled back (users day6-test-wui-…@test.local, codes
// DAY6TEST…); the id sequences those writes advance are put back and the touched tables compared.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-wheel-ui-account-prize.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ACCOUNT_PRIZE_RECENT_DAYS, queryAccountWheelPrize } from "@/lib/data/wheel";
import type { Tx } from "@/lib/panel/tx";

const RUN = randomBytes(3).toString("hex");
const CODE = (tag: string) => `DAY6TEST-WUI-${RUN}-${tag}`.toUpperCase();
const USER_A = `day6-test-wui-a-${RUN}`;
const USER_B = `day6-test-wui-b-${RUN}`;
const NOW = new Date("2026-11-12T09:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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

type Seq = { last_value: string; is_called: boolean };
const SEQUENCES = ["coupons_id_seq", "wheel_spins_id_seq"] as const;
const TABLES = ["coupons", "wheel_spins"] as const;
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

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of TABLES) tablesBefore.set(t, await tableHash(t));
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
    for (const t of TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
    const [own] = await db.execute<{ users: string }>(sql`select count(*)::text as users from "user" where id like ${"day6-test-wui-%"}`);
    assert.equal(own.users, "0", "no test users left");
  } finally {
    await db.$client.end();
  }
});

async function users(tx: Tx) {
  await tx.insert(schema.user).values([
    { id: USER_A, name: "Day6 WUI A", email: `${USER_A}@test.local` },
    { id: USER_B, name: "Day6 WUI B", email: `${USER_B}@test.local` },
  ]);
}

type CouponOver = Partial<typeof schema.coupons.$inferInsert>;
/** One prize per account and round (wheel_spins_user_round_unique): every test prize gets its own round. */
let round = 0;
async function prize(tx: Tx, tag: string, over: CouponOver, label?: { tr: string; en?: string }) {
  const [coupon] = await tx
    .insert(schema.coupons)
    .values({
      code: CODE(tag),
      type: "percent",
      value: 10,
      source: "wheel",
      userId: USER_A,
      maxUses: 1,
      perCustomerLimit: 1,
      startsAt: new Date(NOW.getTime() - DAY),
      endsAt: new Date(NOW.getTime() + 2 * DAY),
      ...over,
    })
    .returning({ id: schema.coupons.id, code: schema.coupons.code });
  if (label) {
    await tx.insert(schema.wheelSpins).values({
      round: ++round,
      sliceKey: "indirim-10",
      prize: { type: "percent", value: 10, label, minOrderTotal: 0 },
      status: "claimed",
      userId: (over.userId as string | undefined) ?? USER_A,
      boundVia: "signed_in",
      couponId: coupon.id,
    });
  }
  return coupon;
}

describe("queryAccountWheelPrize", () => {
  test("no prize → null (also for another account's prize)", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      assert.equal(await queryAccountWheelPrize(tx, USER_A, NOW), null);
      await prize(tx, "b1", { userId: USER_B });
      assert.equal(await queryAccountWheelPrize(tx, USER_A, NOW), null);
      assert.equal((await queryAccountWheelPrize(tx, USER_B, NOW))?.status, "active");
    });
  });

  test("the usable prize that expires first, with the label of its spin", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      await prize(tx, "late", { endsAt: new Date(NOW.getTime() + 5 * DAY) }, { tr: "%15 indirim" });
      const soon = await prize(tx, "soon", { endsAt: new Date(NOW.getTime() + 3 * HOUR), value: 20, minOrderTotal: 75000 }, { tr: "%20 indirim", en: "20% off" });
      const got = await queryAccountWheelPrize(tx, USER_A, NOW);
      assert.deepEqual(got, {
        status: "active",
        code: soon.code,
        label: { tr: "%20 indirim", en: "20% off" },
        type: "percent",
        value: 20,
        minOrderTotal: 75000,
        endsAt: new Date(NOW.getTime() + 3 * HOUR).toISOString(),
      });
    });
  });

  test("a used prize shows as used; an expired one as expired, for 30 days after its end", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const used = await prize(tx, "used", { usedCount: 1 }, { tr: "%10 indirim" });
      let got = await queryAccountWheelPrize(tx, USER_A, NOW);
      assert.equal(got?.status, "used");
      assert.equal(got?.code, used.code);
      assert.deepEqual(got?.label, { tr: "%10 indirim" });
      await tx.delete(schema.wheelSpins).where(sql`${schema.wheelSpins.couponId} is not null and ${schema.wheelSpins.userId} = ${USER_A}`);
      await tx.delete(schema.coupons).where(sql`${schema.coupons.userId} = ${USER_A}`);

      await prize(tx, "exp", { endsAt: new Date(NOW.getTime() - 2 * DAY) });
      got = await queryAccountWheelPrize(tx, USER_A, NOW);
      assert.equal(got?.status, "expired");
      assert.equal(got?.label, null, "no spin row: the card builds the label from the coupon");
      assert.equal(await queryAccountWheelPrize(tx, USER_A, new Date(NOW.getTime() - 2 * DAY + ACCOUNT_PRIZE_RECENT_DAYS * DAY + HOUR)), null, "gone after 30 days");
    });
  });

  test("an active prize wins over a newer used one; a switched-off prize (staff, anonymization) is not shown", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      const active = await prize(tx, "act", { endsAt: new Date(NOW.getTime() + DAY) });
      await prize(tx, "used2", { usedCount: 1, startsAt: new Date(NOW.getTime() - HOUR) });
      assert.equal((await queryAccountWheelPrize(tx, USER_A, NOW))?.code, active.code);
      await tx.update(schema.coupons).set({ isActive: false }).where(sql`${schema.coupons.userId} = ${USER_A}`);
      assert.equal(await queryAccountWheelPrize(tx, USER_A, NOW), null);
    });
  });

  test("a prize that has not started yet is not announced", async () => {
    await inRollback(async (tx) => {
      await users(tx);
      await prize(tx, "future", { startsAt: new Date(NOW.getTime() + HOUR), endsAt: new Date(NOW.getTime() + DAY) });
      assert.equal(await queryAccountWheelPrize(tx, USER_A, NOW), null);
    });
  });
});
