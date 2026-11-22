// Hediye Çarkı statistics and winners for the panel. Uncached on purpose (staff see live numbers) and
// computed in PostgreSQL with Europe/Istanbul day boundaries, never the server clock. Every function
// takes an executor (db or a transaction), so DB tests run them on throwaway rows inside a rollback.
//
// Definitions (the overview page explains them in Turkish):
//   - a period of N days = today (Istanbul) and the N-1 days before it;
//   - spins = wheel_spins created in the period; claims = prizes issued (claimed_at) in the period;
//   - claim rate = of the spins created in the period, the share whose prize was issued (≤ 100 %);
//   - sign-ups = spins bound through registration (bound_via 'register', bound_at in the period);
//   - orders / revenue = orders created in the period with a wheel coupon (coupons.source 'wheel') and a
//     revenue status (REVENUE_STATUSES: paid, processing, shipped, delivered), grand total incl. VAT.
// Personal data: e-mail addresses go to admins in full, to editors masked (maskEmail), and never into
// logs or audit rows.
import "server-only";
import { and, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import { REVENUE_STATUSES } from "@/app/panel/_lib/dashboard";
import type { WheelBoundVia, WheelPrizeSnapshot, WheelSpinStatus } from "@/db/schema/wheel";
import type { OrderStatus } from "@/db/schema/commerce";
import { toCsv } from "@/lib/panel/marketing/csv";
import { escapeLike } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import { wheelSliceShares, type GiftWheelSlice } from "@/lib/wheel/types";
import { WINNER_PAGE_SIZE, type WinnerFilter } from "./filters";
import { BOUND_VIA_LABELS, maskEmail, prizeConditions, WINNER_STATUS, WINNER_STATUSES, type WinnerStatus } from "./labels";

const w = schema.wheelSpins;
const c = schema.coupons;
const u = schema.user;
const o = schema.orders;

const MAX_DAYS = 366;
const clampDays = (days: number) => Math.max(1, Math.min(MAX_DAYS, Math.trunc(Number.isFinite(days) ? days : 30)));

/** Midnight (Istanbul) at the start of a period of `days` days that ends today. */
function periodStart(days: number): SQL {
  const back = clampDays(days) - 1;
  return sql`((date_trunc('day', now() at time zone 'Europe/Istanbul') - (${back}::int * interval '1 day')) at time zone 'Europe/Istanbul')`;
}

const REVENUE_IN = sql`(${sql.join(
  REVENUE_STATUSES.map((s) => sql`${s}`),
  sql`, `,
)})`;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------------------------------
// Overview

/** The database clock in ms since epoch (status lines are computed against it, not the server clock). */
export async function databaseNow(executor: Tx): Promise<number> {
  const [row] = await executor.execute<{ ms: string }>(sql`select (extract(epoch from now()) * 1000)::bigint::text as ms`);
  return num(row?.ms);
}

export type WheelPeriodStats = {
  days: number;
  spins: number;
  claims: number;
  /** Spins created in the period whose prize has been issued (the claim-rate numerator). */
  claimedOfSpins: number;
  signups: number;
  orders: number;
  /** Kuruş, VAT included. */
  revenue: number;
  /** Every spin ever (to tell "no spins yet" from "none in this period"). */
  allTimeSpins: number;
  /** Database time of the query (ms since epoch), for the live/scheduled status line. */
  now: number;
};

export async function getWheelPeriodStats(executor: Tx, days: number): Promise<WheelPeriodStats> {
  const t0 = periodStart(days);
  const [row] = await executor.execute<Record<string, string | number | null>>(sql`
    select
      (select count(*) from ${w} s where s.created_at >= ${t0})::int as spins,
      (select count(*) from ${w} s where s.claimed_at >= ${t0})::int as claims,
      (select count(*) from ${w} s where s.created_at >= ${t0} and s.claimed_at is not null)::int as claimed_of_spins,
      (select count(*) from ${w} s where s.bound_via = 'register' and s.bound_at >= ${t0})::int as signups,
      (select count(*) from ${o} od join ${c} cp on cp.id = od.coupon_id
        where cp.source = 'wheel' and od.created_at >= ${t0} and od.status in ${REVENUE_IN})::int as orders,
      (select coalesce(sum(od.grand_total), 0) from ${o} od join ${c} cp on cp.id = od.coupon_id
        where cp.source = 'wheel' and od.created_at >= ${t0} and od.status in ${REVENUE_IN})::bigint as revenue,
      (select count(*) from ${w})::int as all_time_spins,
      (extract(epoch from now()) * 1000)::bigint as now_ms
  `);
  return {
    days: clampDays(days),
    spins: num(row?.spins),
    claims: num(row?.claims),
    claimedOfSpins: num(row?.claimed_of_spins),
    signups: num(row?.signups),
    orders: num(row?.orders),
    revenue: num(row?.revenue),
    allTimeSpins: num(row?.all_time_spins),
    now: num(row?.now_ms),
  };
}

export type WheelDay = { day: string; spins: number; claims: number; orders: number; revenue: number };

/** One row per Istanbul calendar day of the period (oldest first), zero-filled. */
export async function getWheelDaily(executor: Tx, days: number): Promise<WheelDay[]> {
  const span = clampDays(days) - 1;
  const t0 = periodStart(days);
  const rows = await executor.execute<{ day: string; spins: string; claims: string; orders: string; revenue: string }>(sql`
    with days as (
      select generate_series(
        (now() at time zone 'Europe/Istanbul')::date - ${span}::int,
        (now() at time zone 'Europe/Istanbul')::date,
        interval '1 day'
      )::date as day
    ),
    sp as (
      select (s.created_at at time zone 'Europe/Istanbul')::date as day, count(*) as n
      from ${w} s where s.created_at >= ${t0} group by 1
    ),
    cl as (
      select (s.claimed_at at time zone 'Europe/Istanbul')::date as day, count(*) as n
      from ${w} s where s.claimed_at >= ${t0} group by 1
    ),
    od as (
      select (od.created_at at time zone 'Europe/Istanbul')::date as day, count(*) as n, sum(od.grand_total) as revenue
      from ${o} od join ${c} cp on cp.id = od.coupon_id
      where cp.source = 'wheel' and od.created_at >= ${t0} and od.status in ${REVENUE_IN}
      group by 1
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(sp.n, 0)::text as spins,
           coalesce(cl.n, 0)::text as claims,
           coalesce(od.n, 0)::text as orders,
           coalesce(od.revenue, 0)::text as revenue
    from days d
    left join sp on sp.day = d.day
    left join cl on cl.day = d.day
    left join od on od.day = d.day
    order by d.day
  `);
  return rows.map((r) => ({ day: r.day, spins: num(r.spins), claims: num(r.claims), orders: num(r.orders), revenue: num(r.revenue) }));
}

export type WheelSliceStat = {
  key: string;
  /** Current Turkish label, or the last won label for a slice that is no longer on the wheel. */
  label: string;
  tone: GiftWheelSlice["tone"] | null;
  /** Still on the wheel (current settings). */
  current: boolean;
  spins: number;
  claims: number;
  orders: number;
  revenue: number;
  /** Share of this period's spins, in percent (one decimal). */
  actualShare: number;
  /** Share the weights give it now, in percent; null when the slice is no longer on the wheel. */
  configuredShare: number | null;
};

/**
 * Per slice for the period: spins, claims, orders and revenue (event times as above), the actual share of
 * spins and the share the current weights give. Current slices first (wheel order), then removed ones.
 */
export async function getWheelSliceStats(executor: Tx, days: number, slices: readonly GiftWheelSlice[]): Promise<WheelSliceStat[]> {
  const t0 = periodStart(days);
  const rows = await executor.execute<{ key: string; spins: string; claims: string; orders: string; revenue: string; label: string | null }>(sql`
    with keys as (
      select s.slice_key as key from ${w} s where s.created_at >= ${t0} or s.claimed_at >= ${t0}
      union
      select s.slice_key from ${o} od join ${w} s on s.coupon_id = od.coupon_id
      where od.created_at >= ${t0} and od.status in ${REVENUE_IN}
    )
    select k.key,
      (select count(*) from ${w} s where s.slice_key = k.key and s.created_at >= ${t0})::text as spins,
      (select count(*) from ${w} s where s.slice_key = k.key and s.claimed_at >= ${t0})::text as claims,
      (select count(*) from ${o} od join ${w} s on s.coupon_id = od.coupon_id
        where s.slice_key = k.key and od.created_at >= ${t0} and od.status in ${REVENUE_IN})::text as orders,
      (select coalesce(sum(od.grand_total), 0) from ${o} od join ${w} s on s.coupon_id = od.coupon_id
        where s.slice_key = k.key and od.created_at >= ${t0} and od.status in ${REVENUE_IN})::text as revenue,
      (select s.prize -> 'label' ->> 'tr' from ${w} s where s.slice_key = k.key order by s.created_at desc, s.id desc limit 1) as label
    from keys k
  `);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const totalSpins = rows.reduce((sum, r) => sum + num(r.spins), 0);
  const shares = wheelSliceShares(slices);
  const share = (spins: number) => (totalSpins > 0 ? Math.round((spins / totalSpins) * 1000) / 10 : 0);

  const current: WheelSliceStat[] = slices.map((slice, i) => {
    const r = byKey.get(slice.key);
    const spins = num(r?.spins);
    return {
      key: slice.key,
      label: slice.label.tr,
      tone: slice.tone,
      current: true,
      spins,
      claims: num(r?.claims),
      orders: num(r?.orders),
      revenue: num(r?.revenue),
      actualShare: share(spins),
      configuredShare: shares[i] ?? 0,
    };
  });
  const known = new Set(slices.map((s) => s.key));
  const removed: WheelSliceStat[] = rows
    .filter((r) => !known.has(r.key))
    .map((r) => ({
      key: r.key,
      label: r.label?.trim() || r.key,
      tone: null,
      current: false,
      spins: num(r.spins),
      claims: num(r.claims),
      orders: num(r.orders),
      revenue: num(r.revenue),
      actualShare: share(num(r.spins)),
      configuredShare: null,
    }))
    .sort((a, b) => b.spins - a.spins || a.key.localeCompare(b.key));
  return [...current, ...removed];
}

// ---------------------------------------------------------------------------------------------------
// Winners (Kazananlar)

/**
 * The derived status of a winner row (labels.ts WINNER_STATUS). No bind parameters inside, so it can be
 * selected and grouped by as the same expression.
 */
const winnerStatus = sql<WinnerStatus>`(case
  when ${w.status} = 'claimed' and ${c.id} is null then 'inactive'
  when ${w.status} = 'claimed' and ${c.usedCount} >= coalesce(${c.maxUses}, 1) then 'used'
  when ${w.status} = 'claimed' and not ${c.isActive} then 'inactive'
  when ${w.status} = 'claimed' and ${c.endsAt} is not null and ${c.endsAt} <= now() then 'expired'
  when ${w.status} = 'claimed' then 'active'
  when ${w.status} = 'bound' then 'pending'
  else 'expired'
end)`;

/** Winners = spins tied to an account or to a prize coupon (anonymous, unclaimed spins only count in the stats). */
const isWinner = or(isNotNull(w.userId), isNotNull(w.couponId))!;
const activityAt = sql`coalesce(${w.claimedAt}, ${w.boundAt}, ${w.createdAt})`;

function searchCondition(q: string, canSearchEmail: boolean): SQL | undefined {
  const text = q.trim();
  if (!text) return undefined;
  const code = text.toUpperCase().replace(/\s+/g, "");
  const byCode = sql`upper(${c.code}) like ${`%${escapeLike(code)}%`}`;
  if (!canSearchEmail) return byCode;
  return or(byCode, sql`lower(${u.email}) like ${`%${escapeLike(text.toLowerCase())}%`}`);
}

function winnerWhere(filter: WinnerFilter, canSearchEmail: boolean, withStatus = true): SQL {
  const conds: SQL[] = [isWinner];
  const search = searchCondition(filter.q, canSearchEmail);
  if (search) conds.push(search);
  if (withStatus && filter.status) conds.push(sql`${winnerStatus} = ${filter.status}`);
  return and(...conds)!;
}

export type WinnerRow = {
  id: number;
  round: number;
  sliceKey: string;
  prize: WheelPrizeSnapshot;
  spinStatus: WheelSpinStatus;
  status: WinnerStatus;
  boundVia: WheelBoundVia | null;
  locale: string;
  /** Full for admins, masked for editors; null when the account was deleted or anonymized. */
  email: string | null;
  couponId: number | null;
  code: string | null;
  createdAt: string;
  boundAt: string | null;
  claimedAt: string | null;
  endsAt: string | null;
  order: { id: number; orderNumber: string; status: OrderStatus; grandTotal: number } | null;
};

export type WinnerList = {
  rows: WinnerRow[];
  page: number;
  pageSize: number;
  /** Rows of the selected tab. */
  total: number;
  pageCount: number;
  /** Rows per status for the tabs (search applied, status not). */
  counts: Record<WinnerStatus, number>;
  /** Rows of every status (search applied). */
  all: number;
};

const winnerColumns = {
  id: w.id,
  round: w.round,
  sliceKey: w.sliceKey,
  prize: w.prize,
  spinStatus: w.status,
  boundVia: w.boundVia,
  locale: w.locale,
  createdAt: w.createdAt,
  boundAt: w.boundAt,
  claimedAt: w.claimedAt,
  email: u.email,
  couponId: c.id,
  code: c.code,
  endsAt: c.endsAt,
  status: winnerStatus,
} as const;

type RawWinner = {
  id: number;
  round: number;
  sliceKey: string;
  prize: WheelPrizeSnapshot;
  spinStatus: WheelSpinStatus;
  boundVia: WheelBoundVia | null;
  locale: string;
  createdAt: Date;
  boundAt: Date | null;
  claimedAt: Date | null;
  email: string | null;
  couponId: number | null;
  code: string | null;
  endsAt: Date | null;
  status: WinnerStatus;
};

/** The latest order per coupon (any status) for the given prize coupons. */
async function latestOrders(executor: Tx, couponIds: number[]): Promise<Map<number, WinnerRow["order"]>> {
  if (couponIds.length === 0) return new Map();
  const rows = await executor
    .selectDistinctOn([o.couponId], { couponId: o.couponId, id: o.id, orderNumber: o.orderNumber, status: o.status, grandTotal: o.grandTotal })
    .from(o)
    .where(inArray(o.couponId, couponIds))
    .orderBy(o.couponId, desc(o.createdAt), desc(o.id));
  return new Map(rows.filter((r) => r.couponId !== null).map((r) => [r.couponId as number, { id: r.id, orderNumber: r.orderNumber, status: r.status, grandTotal: r.grandTotal }]));
}

function toWinner(r: RawWinner, order: WinnerRow["order"], revealEmail: boolean): WinnerRow {
  return {
    id: r.id,
    round: r.round,
    sliceKey: r.sliceKey,
    prize: r.prize,
    spinStatus: r.spinStatus,
    status: (WINNER_STATUSES as readonly string[]).includes(r.status) ? r.status : "expired",
    boundVia: r.boundVia,
    locale: r.locale,
    email: revealEmail ? r.email : maskEmail(r.email),
    couponId: r.couponId,
    code: r.code,
    createdAt: r.createdAt.toISOString(),
    boundAt: r.boundAt?.toISOString() ?? null,
    claimedAt: r.claimedAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    order,
  };
}

/**
 * One page of winners, newest activity first. `revealEmail` (admins) shows full addresses and allows
 * searching by e-mail; editors see masked addresses and search by code only.
 */
export async function listWheelWinners(
  executor: Tx,
  filter: WinnerFilter,
  page: number,
  { revealEmail }: { revealEmail: boolean },
): Promise<WinnerList> {
  const countRows = await executor
    .select({ status: winnerStatus, n: sql<number>`count(*)::int` })
    .from(w)
    .leftJoin(u, eq(u.id, w.userId))
    .leftJoin(c, eq(c.id, w.couponId))
    .where(winnerWhere(filter, revealEmail, false))
    .groupBy(winnerStatus);
  const counts = Object.fromEntries(WINNER_STATUSES.map((s) => [s, 0])) as Record<WinnerStatus, number>;
  for (const r of countRows) if ((WINNER_STATUSES as readonly string[]).includes(r.status)) counts[r.status] = Number(r.n);
  const all = WINNER_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const total = filter.status ? counts[filter.status] : all;
  const pageCount = Math.max(1, Math.ceil(total / WINNER_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page)), pageCount);

  const raw = (await executor
    .select(winnerColumns)
    .from(w)
    .leftJoin(u, eq(u.id, w.userId))
    .leftJoin(c, eq(c.id, w.couponId))
    .where(winnerWhere(filter, revealEmail))
    .orderBy(desc(activityAt), desc(w.id))
    .limit(WINNER_PAGE_SIZE)
    .offset((current - 1) * WINNER_PAGE_SIZE)) as RawWinner[];
  const orders = await latestOrders(
    executor,
    raw.map((r) => r.couponId).filter((id): id is number => id !== null),
  );
  return {
    rows: raw.map((r) => toWinner(r, r.couponId !== null ? (orders.get(r.couponId) ?? null) : null, revealEmail)),
    page: current,
    pageSize: WINNER_PAGE_SIZE,
    total,
    pageCount,
    counts,
    all,
  };
}

// ---------------------------------------------------------------------------------------------------
// CSV export (admin only; the route handler checks the role and writes the audit row)

export const WINNER_EXPORT_LIMIT = 100_000;

export const WINNER_EXPORT_HEADER = [
  "Durum",
  "Ödül",
  "Koşullar",
  "Kod",
  "E-posta",
  "Hesap",
  "Tur",
  "Dil",
  "Çevirme",
  "Hesaba bağlanma",
  "Hediye alma",
  "Son kullanım",
  "Sipariş no",
  "Sipariş tutarı",
] as const;

const exportDate = new Intl.DateTimeFormat("tr-TR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});
/** "09.11.2026 14:30" (Istanbul time; Excel reads it as a date with Turkish settings). */
const cellDate = (iso: string | null) => (iso ? exportDate.format(new Date(iso)).replace(",", "") : "");
const LOCALE_TEXT: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };
const csvAmount = (kurus: number) => (kurus / 100).toFixed(2).replace(".", ",");

/** Every winner matching the filter (full e-mail addresses), newest activity first, as one CSV file. */
export async function exportWheelWinnersCsv(executor: Tx, filter: WinnerFilter): Promise<{ csv: string; rows: number }> {
  const raw = (await executor
    .select(winnerColumns)
    .from(w)
    .leftJoin(u, eq(u.id, w.userId))
    .leftJoin(c, eq(c.id, w.couponId))
    .where(winnerWhere(filter, true))
    .orderBy(desc(activityAt), desc(w.id))
    .limit(WINNER_EXPORT_LIMIT)) as RawWinner[];
  const orders = new Map<number, WinnerRow["order"]>();
  const ids = raw.map((r) => r.couponId).filter((id): id is number => id !== null);
  for (let i = 0; i < ids.length; i += 1000) {
    for (const [k, v] of await latestOrders(executor, ids.slice(i, i + 1000))) orders.set(k, v);
  }
  const body = raw.map((r) => {
    const row = toWinner(r, r.couponId !== null ? (orders.get(r.couponId) ?? null) : null, true);
    return [
      WINNER_STATUS[row.status].label,
      row.prize.label?.tr ?? row.sliceKey,
      prizeConditions(row.prize),
      row.code ?? "",
      row.email ?? "",
      row.boundVia ? BOUND_VIA_LABELS[row.boundVia] : "",
      row.round,
      LOCALE_TEXT[row.locale] ?? row.locale,
      cellDate(row.createdAt),
      cellDate(row.boundAt),
      cellDate(row.claimedAt),
      cellDate(row.endsAt),
      row.order?.orderNumber ?? "",
      row.order ? csvAmount(row.order.grandTotal) : "",
    ];
  });
  return { csv: toCsv(WINNER_EXPORT_HEADER, body), rows: raw.length };
}
