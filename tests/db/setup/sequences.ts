// Sequence snapshot / restore for DB test files that insert rows (tests/db/golive-*.test.ts). Every sequence
// in the public schema is put back to its value from before the file ran, but never below an id that a row
// still uses (another writer may have inserted meanwhile). order_number_seq is compared with the numeric
// part of orders.order_number.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type SequenceSnapshot = { name: string; table: string | null; column: string | null; lastValue: bigint; isCalled: boolean }[];

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function snapshotSequences(): Promise<SequenceSnapshot> {
  const rows = await db.execute<{ name: string; table: string | null; column: string | null }>(sql`
    select s.relname as name, t.relname as "table", a.attname as "column"
    from pg_class s
    join pg_namespace n on n.oid = s.relnamespace and n.nspname = 'public'
    left join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')
    left join pg_class t on t.oid = d.refobjid
    left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where s.relkind = 'S'
    order by s.relname`);
  const out: SequenceSnapshot = [];
  for (const r of rows) {
    const [v] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from public.${ident(r.name)}`));
    out.push({ name: r.name, table: r.table, column: r.column, lastValue: BigInt(v.last_value), isCalled: v.is_called });
  }
  return out;
}

export async function restoreSequences(snapshot: SequenceSnapshot): Promise<void> {
  for (const s of snapshot) {
    let used = BigInt(0);
    if (s.table && s.column) {
      const [r] = await db.execute<{ m: string | null }>(sql.raw(`select max(${ident(s.column)})::text as m from public.${ident(s.table)}`));
      used = BigInt(r.m ?? "0");
    } else if (s.name === "order_number_seq") {
      const [r] = await db.execute<{ m: string | null }>(sql`select max(substring(order_number from 6)::bigint)::text as m from orders`);
      used = BigInt(r.m ?? "0");
    }
    const seq = `public.${ident(s.name)}`;
    if (used > s.lastValue) await db.execute(sql`select setval(${seq}::regclass, ${used.toString()}::bigint, true)`);
    else await db.execute(sql`select setval(${seq}::regclass, ${s.lastValue.toString()}::bigint, ${s.isCalled})`);
  }
}
