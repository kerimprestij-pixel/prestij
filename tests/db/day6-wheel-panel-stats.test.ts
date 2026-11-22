// Day 6 WHEEL-PANEL against the local PostgreSQL, on throwaway rows inside rolled-back transactions:
//   - overview statistics for 7/30/90 Istanbul days (spins, claims, claim rate, sign-ups, orders and
//     revenue with a wheel code, revenue statuses only), the period boundary at Istanbul midnight, the
//     zero-filled daily series and the per-slice table (current slices first, removed ones after);
//   - the winners list: derived statuses, counts per tab, linked order, search (code for editors, code or
//     e-mail for admins), e-mail masking for editors, newest first, pagination; the admin CSV export;
//   - "Yeni tur başlat": round + 1 under the settings lock, stale pages refused, the round limit.
// Deltas are measured against a baseline read in the same transaction, so rows that exist on the live
// database never disturb the assertions. Test data: user ids day6-test-wp-…, e-mails …@test.local,
// codes and order numbers DAY6TEST-WP…; the id sequences the writes advance are put back afterwards.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-wheel-panel-stats.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderStatus } from "@/db/schema/commerce";
import type { WheelBoundVia, WheelSpinStatus } from "@/db/schema/wheel";
import { startWheelRoundInput } from "@/lib/panel/gift-wheel/action-defs";
import {
  databaseNow,
  exportWheelWinnersCsv,
  getWheelDaily,
  getWheelPeriodStats,
  getWheelSliceStats,
  listWheelWinners,
  WINNER_EXPORT_HEADER,
} from "@/lib/panel/gift-wheel/queries";
import { startNewWheelRound } from "@/lib/panel/gift-wheel/service";
import { isPanelError } from "@/lib/panel/errors";
import { readSettingsRow } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { WHEEL_LIMITS, type GiftWheelSlice } from "@/lib/settings/types";

const RUN = randomBytes(3).toString("hex");
const TAG = `day6test-wp${RUN}`; // e-mail local parts (lower) and, upper-cased, the coupon codes: one search finds both
const CODE = (tag: string) => `${TAG}-${tag}`.toUpperCase();
const USER = (tag: string) => `day6-test-wp-${RUN}-${tag}`;
const EMAIL = (tag: string) => `${TAG}-${tag}@test.local`;
const KEY = (tag: string) => `day6-test-${RUN}-${tag}`;

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

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isPanelError(error), `expected a PanelError, got ${String(error)}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected PanelError(${code})`);
}

type Seq = { last_value: string; is_called: boolean };
const SEQUENCES = ["coupons_id_seq", "wheel_spins_id_seq", "orders_id_seq"] as const;
const SNAPSHOT_TABLES = ["coupons", "wheel_spins", "settings"] as const;
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
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
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
    const [own] = await db.execute<{ users: string; orders: string; coupons: string }>(
      sql`select (select count(*) from "user" where id like ${"day6-test-wp-%"})::text as users,
                 (select count(*) from orders where order_number like ${"DAY6TEST-WP%"})::text as orders,
                 (select count(*) from coupons where code like ${"DAY6TEST-WP%"})::text as coupons`,
    );
    assert.deepEqual({ ...own }, { users: "0", orders: "0", coupons: "0" }, "no test rows left");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------
// Fixtures (all inside the caller's transaction)

const ago = (days: number, extra = ""): SQL => sql.raw(`(now() - interval '${Math.trunc(days)} days'${extra ? ` - interval '${extra}'` : ""})`);
const ahead = (days: number): SQL => sql.raw(`(now() + interval '${Math.trunc(days)} days')`);
/** Istanbul midnight that starts a period of `days` days ending today (the queries' own boundary). */
const periodStart = (days: number): SQL =>
  sql.raw(`((date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '${days - 1} days') at time zone 'Europe/Istanbul')`);

async function addUser(tx: Tx, tag: string): Promise<string> {
  await tx.insert(schema.user).values({ id: USER(tag), name: `Day6 WP ${tag}`, email: EMAIL(tag) });
  return USER(tag);
}

async function addCoupon(
  tx: Tx,
  o: { tag: string; userId: string | null; source?: "wheel" | "manual"; usedCount?: number; endsAt?: SQL; isActive?: boolean },
): Promise<number> {
  const [row] = await tx
    .insert(schema.coupons)
    .values({
      code: CODE(o.tag),
      type: "percent",
      value: 10,
      maxUses: 1,
      perCustomerLimit: 1,
      usedCount: o.usedCount ?? 0,
      isActive: o.isActive ?? true,
      source: o.source ?? "wheel",
      userId: o.userId,
      startsAt: ago(30) as unknown as Date,
      endsAt: (o.endsAt ?? ahead(3)) as unknown as Date,
    })
    .returning({ id: schema.coupons.id });
  return row.id;
}

async function addSpin(
  tx: Tx,
  o: {
    key: string;
    label?: string;
    status: WheelSpinStatus;
    createdAt: SQL;
    userId?: string | null;
    couponId?: number | null;
    boundVia?: WheelBoundVia | null;
    boundAt?: SQL | null;
    claimedAt?: SQL | null;
    round?: number;
  },
): Promise<number> {
  const [row] = await tx
    .insert(schema.wheelSpins)
    .values({
      round: o.round ?? 1,
      sliceKey: o.key,
      prize: { type: "percent", value: 10, label: { tr: o.label ?? "%10 indirim", en: "10% off" }, minOrderTotal: 0 },
      status: o.status,
      userId: o.userId ?? null,
      couponId: o.couponId ?? null,
      boundVia: o.boundVia ?? null,
      createdAt: o.createdAt as unknown as Date,
      boundAt: (o.boundAt ?? null) as unknown as Date | null,
      claimedAt: (o.claimedAt ?? null) as unknown as Date | null,
    })
    .returning({ id: schema.wheelSpins.id });
  return row.id;
}

async function addOrder(tx: Tx, o: { tag: string; couponId: number | null; status: OrderStatus; total: number; createdAt: SQL }): Promise<string> {
  const orderNumber = `DAY6TEST-WP${RUN}-${o.tag}`.toUpperCase();
  await tx.insert(schema.orders).values({
    orderNumber,
    email: `${TAG}-order@test.local`,
    paymentMethod: "bank_transfer",
    subtotal: o.total,
    grandTotal: o.total,
    status: o.status,
    couponId: o.couponId,
    couponCode: o.couponId ? "DAY6TEST" : null,
    shippingAddress: { fullName: "Test", phone: "", city: "Kayseri", district: "Kocasinan", line1: "Test" } as never,
    invoice: { type: "individual" } as never,
    createdAt: o.createdAt as unknown as Date,
  });
  return orderNumber;
}

const slice = (key: string, weight: number, label: string): GiftWheelSlice => ({
  key,
  label: { tr: label },
  type: "percent",
  value: 10,
  minOrderTotal: 0,
  weight,
  tone: "brand",
});

// ---------------------------------------------------------------------------------------------------

describe("overview statistics", () => {
  test("7/30/90 days: spins, claims, claim rate, sign-ups, orders and revenue with a wheel code", async () => {
    await inRollback(async (tx) => {
      const base = { 7: await getWheelPeriodStats(tx, 7), 30: await getWheelPeriodStats(tx, 30), 90: await getWheelPeriodStats(tx, 90) };
      const a = await addUser(tx, "a");
      const b = await addUser(tx, "b");
      const cA = await addCoupon(tx, { tag: "A", userId: a, usedCount: 1 });
      const cB = await addCoupon(tx, { tag: "B", userId: b, usedCount: 1 });
      const cManual = await addCoupon(tx, { tag: "MANUAL", userId: null, source: "manual" });

      await addSpin(tx, { key: KEY("one"), status: "spun", createdAt: ago(0) });
      await addSpin(tx, { key: KEY("one"), status: "claimed", createdAt: ago(3), userId: a, couponId: cA, boundVia: "register", boundAt: ago(0), claimedAt: ago(0) });
      await addSpin(tx, { key: KEY("two"), label: "Eski dilim", status: "claimed", createdAt: ago(10), userId: b, couponId: cB, boundVia: "signed_in", boundAt: ago(10), claimedAt: ago(10) });
      await addSpin(tx, { key: KEY("two"), label: "Eski dilim", status: "spun", createdAt: ago(40) });
      // The 7-day boundary: Istanbul midnight six days ago is in, one second earlier is out.
      await addSpin(tx, { key: KEY("three"), status: "spun", createdAt: periodStart(7) });
      await addSpin(tx, { key: KEY("three"), status: "spun", createdAt: sql.raw(`(((date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '6 days') at time zone 'Europe/Istanbul') - interval '1 second')`) });

      await addOrder(tx, { tag: "1", couponId: cA, status: "paid", total: 12000, createdAt: ago(0) });
      await addOrder(tx, { tag: "2", couponId: cA, status: "cancelled", total: 5000, createdAt: ago(0) });
      await addOrder(tx, { tag: "3", couponId: cB, status: "delivered", total: 30000, createdAt: ago(10) });
      await addOrder(tx, { tag: "4", couponId: cB, status: "pending_payment", total: 7000, createdAt: ago(1) });
      await addOrder(tx, { tag: "5", couponId: cManual, status: "paid", total: 9999, createdAt: ago(0) });

      const delta = async (days: 7 | 30 | 90) => {
        const now = await getWheelPeriodStats(tx, days);
        const b0 = base[days];
        return {
          spins: now.spins - b0.spins,
          claims: now.claims - b0.claims,
          claimedOfSpins: now.claimedOfSpins - b0.claimedOfSpins,
          signups: now.signups - b0.signups,
          orders: now.orders - b0.orders,
          revenue: now.revenue - b0.revenue,
          allTimeSpins: now.allTimeSpins - b0.allTimeSpins,
        };
      };
      assert.deepEqual(await delta(7), { spins: 3, claims: 1, claimedOfSpins: 1, signups: 1, orders: 1, revenue: 12000, allTimeSpins: 6 });
      assert.deepEqual(await delta(30), { spins: 5, claims: 2, claimedOfSpins: 2, signups: 1, orders: 2, revenue: 42000, allTimeSpins: 6 });
      assert.deepEqual(await delta(90), { spins: 6, claims: 2, claimedOfSpins: 2, signups: 1, orders: 2, revenue: 42000, allTimeSpins: 6 });

      const stats = await getWheelPeriodStats(tx, 7);
      assert.equal(stats.days, 7);
      assert.ok(Math.abs(stats.now - (await databaseNow(tx))) < 60_000, "now comes from the database clock");
    });
  });

  test("daily series: one zero-filled row per Istanbul day, oldest first, today last; sums match the period", async () => {
    await inRollback(async (tx) => {
      const before7 = await getWheelDaily(tx, 7);
      assert.equal(before7.length, 7);
      const [{ today }] = await tx.execute<{ today: string }>(sql`select to_char((now() at time zone 'Europe/Istanbul')::date, 'YYYY-MM-DD') as today`);
      assert.equal(before7[6].day, today);
      for (let i = 1; i < before7.length; i++) assert.ok(before7[i - 1].day < before7[i].day);

      const a = await addUser(tx, "d");
      const c = await addCoupon(tx, { tag: "D", userId: a, usedCount: 1 });
      await addSpin(tx, { key: KEY("d"), status: "spun", createdAt: ago(0) });
      await addSpin(tx, { key: KEY("d"), status: "claimed", createdAt: ago(3), userId: a, couponId: c, boundVia: "sign_in", boundAt: ago(0), claimedAt: ago(0) });
      await addSpin(tx, { key: KEY("d"), status: "spun", createdAt: periodStart(7) });
      await addOrder(tx, { tag: "D1", couponId: c, status: "processing", total: 15000, createdAt: ago(0) });

      const after7 = await getWheelDaily(tx, 7);
      const diff = after7.map((d, i) => ({
        spins: d.spins - before7[i].spins,
        claims: d.claims - before7[i].claims,
        orders: d.orders - before7[i].orders,
        revenue: d.revenue - before7[i].revenue,
      }));
      assert.deepEqual(diff[6], { spins: 1, claims: 1, orders: 1, revenue: 15000 }, "today");
      assert.deepEqual(diff[3], { spins: 1, claims: 0, orders: 0, revenue: 0 }, "three days ago");
      assert.deepEqual(diff[0], { spins: 1, claims: 0, orders: 0, revenue: 0 }, "the first day starts at Istanbul midnight");
      const stats = await getWheelPeriodStats(tx, 7);
      assert.equal(after7.reduce((s, d) => s + d.spins, 0), stats.spins);
      assert.equal(after7.reduce((s, d) => s + d.claims, 0), stats.claims);
      assert.equal(after7.reduce((s, d) => s + d.orders, 0), stats.orders);
      assert.equal(after7.reduce((s, d) => s + d.revenue, 0), stats.revenue);
      assert.equal((await getWheelDaily(tx, 90)).length, 90);
    });
  });

  test("per slice: counts, actual vs configured share, removed slices listed after the current ones", async () => {
    await inRollback(async (tx) => {
      const base = await getWheelPeriodStats(tx, 30);
      const a = await addUser(tx, "s1");
      const b = await addUser(tx, "s2");
      const cA = await addCoupon(tx, { tag: "S1", userId: a, usedCount: 1 });
      const cB = await addCoupon(tx, { tag: "S2", userId: b, usedCount: 1 });
      await addSpin(tx, { key: KEY("one"), status: "spun", createdAt: ago(0) });
      await addSpin(tx, { key: KEY("one"), status: "claimed", createdAt: ago(2), userId: a, couponId: cA, boundAt: ago(1), claimedAt: ago(1) });
      await addSpin(tx, { key: KEY("gone"), label: "Kaldırılan dilim", status: "claimed", createdAt: ago(5), userId: b, couponId: cB, boundAt: ago(5), claimedAt: ago(5) });
      await addSpin(tx, { key: KEY("three"), status: "spun", createdAt: ago(8) });
      await addSpin(tx, { key: KEY("three"), status: "spun", createdAt: ago(9) });
      await addOrder(tx, { tag: "S1", couponId: cA, status: "paid", total: 12000, createdAt: ago(0) });
      await addOrder(tx, { tag: "S2", couponId: cB, status: "shipped", total: 30000, createdAt: ago(4) });
      await addOrder(tx, { tag: "S3", couponId: cB, status: "refunded", total: 30000, createdAt: ago(3) });

      const config = [slice(KEY("one"), 75, "Bir"), slice(KEY("three"), 25, "Üç"), slice(KEY("empty"), 0, "Boş")];
      const rows = await getWheelSliceStats(tx, 30, config);
      assert.deepEqual(rows.slice(0, 3).map((r) => r.key), config.map((s) => s.key), "current slices first, in wheel order");
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const one = byKey.get(KEY("one"))!;
      const three = byKey.get(KEY("three"))!;
      const empty = byKey.get(KEY("empty"))!;
      const gone = byKey.get(KEY("gone"))!;
      assert.deepEqual([one.spins, one.claims, one.orders, one.revenue, one.current, one.label], [2, 1, 1, 12000, true, "Bir"]);
      assert.deepEqual([three.spins, three.claims, three.orders, three.revenue], [2, 0, 0, 0]);
      assert.deepEqual([empty.spins, empty.claims, empty.orders, empty.revenue, empty.actualShare], [0, 0, 0, 0, 0]);
      assert.deepEqual([gone.spins, gone.claims, gone.orders, gone.revenue, gone.current, gone.label, gone.configuredShare], [1, 1, 1, 30000, false, "Kaldırılan dilim", null]);
      assert.ok(rows.indexOf(gone) >= 3, "removed slices come after the current ones");
      assert.deepEqual([one.configuredShare, three.configuredShare, empty.configuredShare], [75, 25, 0]);
      const total = base.spins + 5;
      assert.equal(one.actualShare, Math.round((2 / total) * 1000) / 10);
      assert.equal(gone.actualShare, Math.round((1 / total) * 1000) / 10);
    });
  });
});

describe("winners list and CSV export", () => {
  async function seedWinners(tx: Tx) {
    const used = await addUser(tx, "used");
    const active = await addUser(tx, "active");
    const expired = await addUser(tx, "expired");
    const pending = await addUser(tx, "pending");
    const inactive = await addUser(tx, "inactive");
    const cUsed = await addCoupon(tx, { tag: "USED", userId: used, usedCount: 1 });
    const cActive = await addCoupon(tx, { tag: "ACTIVE", userId: active });
    const cExpired = await addCoupon(tx, { tag: "EXPIRED", userId: expired, endsAt: ago(1) });
    const cInactive = await addCoupon(tx, { tag: "INACTIVE", userId: inactive, isActive: false });
    // An anonymized account: the spin lost its user, the prize coupon was deactivated (it keeps an owner row).
    const cAnon = await addCoupon(tx, { tag: "ANON", userId: inactive, isActive: false });

    await addSpin(tx, { key: KEY("w"), status: "claimed", createdAt: ago(5), userId: used, couponId: cUsed, boundVia: "register", boundAt: ago(5), claimedAt: ago(5) });
    await addSpin(tx, { key: KEY("w"), status: "claimed", createdAt: ago(4), userId: active, couponId: cActive, boundVia: "sign_in", boundAt: ago(4), claimedAt: ago(0) });
    await addSpin(tx, { key: KEY("w"), status: "claimed", createdAt: ago(9), userId: expired, couponId: cExpired, boundVia: "signed_in", boundAt: ago(9), claimedAt: ago(4) });
    await addSpin(tx, { key: KEY("w"), status: "bound", createdAt: ago(1), userId: pending, boundVia: "register", boundAt: ago(1) });
    await addSpin(tx, { key: KEY("w"), status: "claimed", createdAt: ago(3), userId: inactive, couponId: cInactive, boundVia: "signed_in", boundAt: ago(3), claimedAt: ago(3) });
    await addSpin(tx, { key: KEY("w"), round: 2, status: "claimed", createdAt: ago(6), userId: null, couponId: cAnon, boundVia: "register", boundAt: ago(6), claimedAt: ago(6) });
    // A guest who never signed up: counted in the statistics, not a "winner".
    await addSpin(tx, { key: KEY("w"), status: "spun", createdAt: ago(0) });
    const orderNumber = await addOrder(tx, { tag: "W1", couponId: cUsed, status: "paid", total: 25000, createdAt: ago(5) });
    return { orderNumber };
  }

  test("statuses, tab counts, linked order and full e-mail addresses for admins", async () => {
    await inRollback(async (tx) => {
      const { orderNumber } = await seedWinners(tx);
      const list = await listWheelWinners(tx, { status: null, q: TAG }, 1, { revealEmail: true });
      assert.deepEqual(list.counts, { active: 1, used: 1, expired: 1, pending: 1, inactive: 2 });
      assert.equal(list.all, 6);
      assert.equal(list.total, 6);
      assert.equal(list.rows.length, 6, "admins find the anonymized prize by its code and the others by e-mail");
      const byEmail = new Map(list.rows.map((r) => [r.email, r]));
      assert.equal(byEmail.get(EMAIL("used"))?.status, "used");
      assert.equal(byEmail.get(EMAIL("used"))?.order?.orderNumber, orderNumber);
      assert.equal(byEmail.get(EMAIL("used"))?.order?.grandTotal, 25000);
      assert.equal(byEmail.get(EMAIL("active"))?.status, "active");
      assert.equal(byEmail.get(EMAIL("expired"))?.status, "expired");
      assert.equal(byEmail.get(EMAIL("pending"))?.status, "pending");
      assert.equal(byEmail.get(EMAIL("pending"))?.code, null);
      assert.equal(byEmail.get(EMAIL("inactive"))?.status, "inactive");
      const anon = list.rows.find((r) => r.email === null);
      assert.ok(anon);
      assert.equal(anon.status, "inactive");
      assert.equal(anon.code, CODE("ANON"));
      // Newest activity first: active (claimed today), pending (bound yesterday), inactive (3 days), expired (claimed 4 days ago)…
      assert.deepEqual(
        list.rows.slice(0, 4).map((r) => r.email),
        [EMAIL("active"), EMAIL("pending"), EMAIL("inactive"), EMAIL("expired")],
      );
      for (const r of list.rows) assert.ok(r.createdAt.endsWith("Z"));

      const usedOnly = await listWheelWinners(tx, { status: "used", q: TAG }, 1, { revealEmail: true });
      assert.equal(usedOnly.total, 1);
      assert.deepEqual(usedOnly.rows.map((r) => r.status), ["used"]);
      assert.equal(usedOnly.counts.active, 1, "tab counts ignore the selected tab");

      const byCode = await listWheelWinners(tx, { status: null, q: CODE("EXPIRED").toLowerCase() }, 1, { revealEmail: true });
      assert.deepEqual(byCode.rows.map((r) => r.code), [CODE("EXPIRED")], "codes match case-insensitively");
    });
  });

  test("editors: masked e-mail addresses and code-only search", async () => {
    await inRollback(async (tx) => {
      await seedWinners(tx);
      const list = await listWheelWinners(tx, { status: null, q: TAG }, 1, { revealEmail: false });
      assert.equal(list.counts.pending, 0, "the pending winner has no code yet and editors cannot search e-mails");
      assert.equal(list.all, 5);
      for (const r of list.rows) {
        if (r.email === null) continue;
        assert.ok(r.email.includes("•••"), r.email);
        assert.ok(!r.email.includes(TAG), "the address never reaches an editor");
      }
      const byEmail = await listWheelWinners(tx, { status: null, q: EMAIL("active") }, 1, { revealEmail: false });
      assert.equal(byEmail.all, 0);
    });
  });

  test("pagination: 50 per page, the page number is clamped", async () => {
    await inRollback(async (tx) => {
      await seedWinners(tx);
      const pending = USER("pending");
      for (let i = 0; i < 52; i++) {
        await addSpin(tx, { key: KEY("p"), round: 100 + i, status: "bound", createdAt: ago(20), userId: pending, boundVia: "sign_in", boundAt: ago(20) });
      }
      const page1 = await listWheelWinners(tx, { status: "pending", q: TAG }, 1, { revealEmail: true });
      assert.deepEqual([page1.total, page1.pageCount, page1.page, page1.rows.length, page1.pageSize], [53, 2, 1, 50, 50]);
      const page2 = await listWheelWinners(tx, { status: "pending", q: TAG }, 2, { revealEmail: true });
      assert.equal(page2.rows.length, 3);
      assert.equal(new Set([...page1.rows, ...page2.rows].map((r) => r.id)).size, 53, "no row on two pages");
      const clamped = await listWheelWinners(tx, { status: "pending", q: TAG }, 99, { revealEmail: true });
      assert.equal(clamped.page, 2);
    });
  });

  test("CSV export: BOM, Turkish header, ';' separated, full addresses, same filter as the list", async () => {
    await inRollback(async (tx) => {
      const { orderNumber } = await seedWinners(tx);
      const { csv, rows } = await exportWheelWinnersCsv(tx, { status: "used", q: TAG });
      assert.equal(rows, 1);
      assert.ok(csv.startsWith("﻿"));
      const lines = csv.slice(1).trimEnd().split("\r\n");
      assert.equal(lines.length, 2);
      assert.equal(lines[0], WINNER_EXPORT_HEADER.join(";"));
      const cells = lines[1].split(";");
      assert.equal(cells.length, WINNER_EXPORT_HEADER.length);
      assert.equal(cells[0], "Kullanıldı");
      assert.equal(cells[3], CODE("USED"));
      assert.equal(cells[4], EMAIL("used"));
      assert.equal(cells[5], "Çarktan sonra üye oldu");
      assert.equal(cells[12], orderNumber);
      assert.equal(cells[13], "250,00");
      assert.match(cells[8], /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
      const all = await exportWheelWinnersCsv(tx, { status: null, q: TAG });
      assert.equal(all.rows, 6);
    });
  });
});

describe("Yeni tur başlat", () => {
  test("round + 1 through the settings save; everything else unchanged; audited as wheel_round", async () => {
    await inRollback(async (tx) => {
      const before = await readSettingsRow("giftWheel", tx);
      const stamp = before.updatedAt ? new Date(before.updatedAt) : null;
      const result = await startNewWheelRound(tx, { updatedAt: stamp, round: before.value.round });
      assert.equal(result.round, before.value.round + 1);
      assert.equal(result.audit.action, "wheel_round");
      assert.equal(result.audit.entity, "settings");
      assert.equal(result.audit.entityId, "giftWheel");
      assert.deepEqual(result.audit.after, { round: before.value.round + 1 });
      const after = await readSettingsRow("giftWheel", tx);
      assert.equal(after.value.round, before.value.round + 1);
      assert.deepEqual({ ...after.value, round: before.value.round }, before.value, "only the round changed");
      assert.equal(after.updatedAt, result.updatedAt.toISOString());

      // A second click from the same (now stale) page: refused, nothing changes.
      await rejectsWith(startNewWheelRound(tx, { updatedAt: stamp, round: before.value.round }), "conflict");
      // Right round but an old version stamp (someone saved meanwhile): refused by the settings lock.
      await rejectsWith(startNewWheelRound(tx, { updatedAt: stamp, round: before.value.round + 1 }), "conflict");
      assert.equal((await readSettingsRow("giftWheel", tx)).value.round, before.value.round + 1);
    });
  });

  test("the last allowed round cannot be followed by another", async () => {
    await inRollback(async (tx) => {
      const current = await readSettingsRow("giftWheel", tx);
      const value = { ...current.value, round: WHEEL_LIMITS.round.max };
      const stamp = new Date(Date.UTC(2026, 0, 1));
      await tx
        .insert(schema.settings)
        .values({ key: "giftWheel", value, updatedAt: stamp })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: stamp } });
      await rejectsWith(startNewWheelRound(tx, { updatedAt: stamp, round: WHEEL_LIMITS.round.max }), "invalid");
    });
  });

  test("action input: the page's stamp (ISO or null) and a whole round number", () => {
    assert.ok(startWheelRoundInput.safeParse({ updatedAt: null, round: 1 }).success);
    assert.ok(startWheelRoundInput.safeParse({ updatedAt: "2026-11-12T10:00:00.000Z", round: 3 }).success);
    assert.equal(startWheelRoundInput.safeParse({ updatedAt: "dün", round: 1 }).success, false);
    assert.equal(startWheelRoundInput.safeParse({ updatedAt: null, round: 0 }).success, false);
    assert.equal(startWheelRoundInput.safeParse({ updatedAt: null, round: 1.5 }).success, false);
    assert.equal(startWheelRoundInput.safeParse({ updatedAt: null }).success, false);
  });
});
