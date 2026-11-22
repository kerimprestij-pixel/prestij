// Go-live data path, database part: connections and catalog queries shared by
// scripts/golive/{copy-content,verify-target}.ts. Plain postgres.js, no Next APIs, no .env.local:
// the target URL comes only from the TARGET_DATABASE_URL environment variable and is never printed.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { PRICE_CHECK_ROWS_SQL, placeholderPriceCheck, type PriceCheckRow } from "@/lib/pricing/placeholder-prices";
import { parseSettings, type Settings } from "@/lib/settings/types";
import {
  SALES_LEGAL_KEYS,
  checkSourceUrl,
  checkTargetUrl,
  journalTags,
  sameDatabase,
  type Column,
  type ForeignKeyEdge,
  type SalesReadinessInput,
  type UrlCheck,
} from "./rules";

export type Db = postgres.ISql;
export type Pool = postgres.Sql;

/** The owner's local database (scripts/db-server.mjs), opened read-only. */
export const DEFAULT_SOURCE_URL = "postgres://postgres:postgres@127.0.0.1:54329/prestij";

/** Everything printed by the scripts goes through here, so a failure never shows a URL. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: unknown }).code;
  return code ? `${error.message} [${String(code)}]` : error.message;
}

export function fail(script: string, message: string): never {
  console.error(`${script}: REFUSED: ${message}`);
  process.exit(1);
}

/**
 * A refusal thrown by code that must stay testable (scripts/golive/copy-run.ts): the CLI prints it as
 * "<script>: REFUSED: <message>" and exits 1. Never carries a URL.
 */
export class Refusal extends Error {
  override name = "Refusal";
}

/** The target URL from the environment, checked (production pooler or local rehearsal database). */
export function targetFromEnv(script: string): { url: string; check: Extract<UrlCheck, { ok: true }> } {
  const url = process.env.TARGET_DATABASE_URL ?? "";
  const check = checkTargetUrl(url);
  if (!check.ok) fail(script, check.reason);
  return { url: url.trim(), check };
}

/** The source URL (SOURCE_DATABASE_URL may point at another local database; default: prestij on 54329). */
export function sourceUrl(script: string, target: UrlCheck): { url: string; check: Extract<UrlCheck, { ok: true }> } {
  const url = process.env.SOURCE_DATABASE_URL?.trim() || DEFAULT_SOURCE_URL;
  const check = checkSourceUrl(url, { rehearsalTarget: target.ok && target.kind === "rehearsal" });
  if (!check.ok) fail(script, check.reason);
  if (sameDatabase(check, target)) fail(script, "source and target are the same database.");
  return { url, check };
}

/** Read-only pool on the local source: the server itself refuses writes in every transaction. */
export function openSource(url: string): Pool {
  return postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 10,
    connection: { application_name: "prestij-golive-source", default_transaction_read_only: true },
  });
}

/** One connection to the target (session pooler or rehearsal database); no prepared statements. */
export function openTarget(url: string): Pool {
  return postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 30, connection: { application_name: "prestij-golive" } });
}

/**
 * Belt and braces for the URL guard: the database the server says this connection is on must be the one
 * the guard checked (the URL rules already refuse the query parameters postgres.js would let redirect it).
 * Called before anything is written or reported.
 */
export async function assertConnectedTo(db: Db, expected: string, label: string): Promise<void> {
  const [row] = await db`select current_database() as name`;
  const actual = String(row?.name ?? "");
  if (actual !== expected) throw new Error(`${label}: connected to database "${actual}", but the checked URL names "${expected}". Nothing was done.`);
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** A double-quoted identifier for the fixed table/column names of this schema (anything else throws). */
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`unexpected identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

export function table(name: string): string {
  return `public.${ident(name)}`;
}

/** Number of entries in drizzle/meta/_journal.json, read at run time (cwd = project root). */
export function repoMigrations(root = process.cwd()): string[] {
  return journalTags(JSON.parse(readFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "utf8")));
}

/**
 * sha256 of each migration file in journal order, computed exactly like drizzle's migrator
 * (drizzle-orm/migrator.js): the value it stores in drizzle.__drizzle_migrations.hash.
 */
export function repoMigrationHashes(root = process.cwd()): string[] {
  return repoMigrations(root).map((tag) =>
    createHash("sha256").update(readFileSync(path.join(root, "drizzle", `${tag}.sql`)).toString()).digest("hex"),
  );
}

/** Index of the first applied migration whose hash differs from the repo file, or -1. */
export function firstForeignMigration(applied: { hash: string }[], repoHashes: string[]): number {
  return applied.findIndex((m, i) => m.hash !== repoHashes[i]);
}

/** True when a repo migration enables row level security (the verifier then requires it everywhere). */
export function repoEnablesRls(root = process.cwd()): string | null {
  const dir = path.join(root, "drizzle");
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .find((f) => /enable\s+row\s+level\s+security/i.test(readFileSync(path.join(dir, f), "utf8")));
  return file ?? null;
}

/** Rows of drizzle.__drizzle_migrations (null when the table does not exist: never migrated). */
export async function appliedMigrations(db: Db): Promise<{ id: number; hash: string }[] | null> {
  const [exists] = await db`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
  if (!exists?.ok) return null;
  const rows = await db`select id::int as id, hash from drizzle.__drizzle_migrations order by id`;
  return rows.map((r) => ({ id: Number(r.id), hash: String(r.hash) }));
}

export async function existingTables(db: Db, tables: readonly string[]): Promise<Set<string>> {
  const rows = await db`select tablename from pg_tables where schemaname = 'public' and tablename = any(${tables as string[]}::text[])`;
  return new Set(rows.map((r) => String(r.tablename)));
}

export async function publicTables(db: Db): Promise<string[]> {
  const rows = await db`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  return rows.map((r) => String(r.tablename));
}

/** Insertable columns per table in physical order (generated columns are left out: COPY cannot write them). */
export async function tableColumns(db: Db, tables: readonly string[]): Promise<Map<string, Column[]>> {
  const rows = await db`
    select c.relname as table, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as not_null, (a.atthasdef or a.attidentity <> '') as has_default
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(${tables as string[]}::text[])
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    order by c.relname, a.attnum`;
  const out = new Map<string, Column[]>();
  for (const r of rows) {
    const list = out.get(String(r.table)) ?? [];
    list.push({ name: String(r.name), type: String(r.type), notNull: Boolean(r.not_null), hasDefault: Boolean(r.has_default) });
    out.set(String(r.table), list);
  }
  return out;
}

/** Foreign keys between public tables (child → parent), from pg_constraint. */
export async function foreignKeys(db: Db): Promise<ForeignKeyEdge[]> {
  const rows = await db`
    select c.conname as constraint, ch.relname as child, pa.relname as parent,
           (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as columns
    from pg_constraint c
    join pg_class ch on ch.oid = c.conrelid
    join pg_namespace chn on chn.oid = ch.relnamespace
    join pg_class pa on pa.oid = c.confrelid
    join pg_namespace pan on pan.oid = pa.relnamespace
    where c.contype = 'f' and chn.nspname = 'public' and pan.nspname = 'public'
    order by ch.relname, c.conname`;
  return rows.map((r) => ({
    constraint: String(r.constraint),
    child: String(r.child),
    parent: String(r.parent),
    columns: (r.columns as string[] | null) ?? [],
  }));
}

export type SequenceColumn = { table: string; column: string; sequence: string };

/** Identity and serial columns of the given tables with their owned sequence. */
export async function sequenceColumns(db: Db, tables: readonly string[]): Promise<SequenceColumn[]> {
  const rows = await db`
    select c.relname as table, a.attname as column,
           pg_get_serial_sequence(format('public.%I', c.relname), a.attname) as sequence
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(${tables as string[]}::text[])
      and a.attnum > 0 and not a.attisdropped
      and pg_get_serial_sequence(format('public.%I', c.relname), a.attname) is not null
    order by c.relname, a.attnum`;
  return rows.map((r) => ({ table: String(r.table), column: String(r.column), sequence: String(r.sequence) }));
}

/** Supabase's Data API roles (the app never uses them; the lock-down SQL of docs/GO-LIVE.md removes their grants). */
export const API_ROLES = ["anon", "authenticated", "service_role"] as const;

/**
 * Privileges the API roles hold on tables, views and sequences of schema public (from the objects' ACLs, so
 * it does not depend on information_schema's "enabled role" filter), counted per role.
 */
export async function apiRoleGrants(db: Db): Promise<{ grantee: string; n: number }[]> {
  const rows = await db`
    select r.rolname as grantee, count(*)::int as n
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid = a.grantee
    where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and r.rolname = any(${[...API_ROLES]}::text[])
    group by r.rolname order by r.rolname`;
  return rows.map((r) => ({ grantee: String(r.grantee), n: Number(r.n) }));
}

const DEFAULT_ACL_KIND: Record<string, string> = { r: "tables", S: "sequences", f: "functions" };

/**
 * Default privileges that would grant NEW tables, sequences or functions in schema public to an API role,
 * for objects created by the connected role (the table owner: what ALTER DEFAULT PRIVILEGES FOR ROLE postgres
 * IN SCHEMA public … in the lock-down SQL removes).
 */
export async function apiRoleDefaultPrivileges(db: Db): Promise<{ grantee: string; kind: string }[]> {
  const rows = await db`
    select distinct r.rolname as grantee, d.defaclobjtype::text as kind
    from pg_default_acl d
    join pg_namespace ns on ns.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    join pg_roles r on r.oid = a.grantee
    where ns.nspname = 'public' and d.defaclrole = (select oid from pg_roles where rolname = current_user)
      and d.defaclobjtype in ('r', 'S', 'f') and r.rolname = any(${[...API_ROLES]}::text[])
    order by 1, 2`;
  return rows.map((r) => ({ grantee: String(r.grantee), kind: DEFAULT_ACL_KIND[String(r.kind)] ?? String(r.kind) }));
}

export async function countRows(db: Db, name: string): Promise<number> {
  const [row] = await db.unsafe(`select count(*)::int as n from ${table(name)}`);
  return Number(row?.n ?? 0);
}

export async function hasRows(db: Db, name: string): Promise<boolean> {
  const [row] = await db.unsafe(`select exists (select 1 from ${table(name)}) as found`);
  return Boolean(row?.found);
}

/** The value nextval() will hand out next for `sequence` (a regclass text from pg_get_serial_sequence). */
export async function nextSequenceValue(db: Db, sequence: string): Promise<number> {
  const [row] = await db.unsafe(`select last_value::bigint as last, is_called from ${sequence}`);
  const last = Number(row?.last ?? 0);
  return row?.is_called ? last + 1 : last;
}

/** The sales-only overrides (--allow-prices, --allow-legal-brackets) the readiness rules take. */
export type ReadinessOptions = { allowPrices: boolean; allowLegalBrackets?: boolean };

/**
 * What the sales-readiness rules read (rules.ts salesReadiness): the current version of each sales legal text,
 * the general and payments settings parsed the way the storefront parses them, and every variant for the
 * placeholder-price rule. Read-only; copy-content runs it on the local source (and again on the target inside the
 * copy transaction), verify-target on the target.
 */
export async function readSalesReadinessInput(db: Db, options: ReadinessOptions): Promise<SalesReadinessInput> {
  const legal = await db`select key, version, body from legal_documents where is_current and key = any(${[...SALES_LEGAL_KEYS]}::text[]) order by key`;
  const settings = await db`select key, value from settings where key in ('general', 'payments')`;
  const byKey = new Map(settings.map((r) => [String(r.key), r.value as unknown]));
  const variants = await db.unsafe(PRICE_CHECK_ROWS_SQL);
  return {
    legal: legal.map((r) => ({ key: String(r.key), version: String(r.version), body: r.body as unknown })),
    general: parseSettings("general", byKey.get("general")),
    payments: parseSettings("payments", byKey.get("payments")),
    prices: placeholderPriceCheck(
      variants.map(
        (r): PriceCheckRow => ({
          sku: String(r.sku),
          price: Number(r.price),
          stock: Number(r.stock),
          variantActive: Boolean(r.variantActive),
          productStatus: String(r.productStatus),
          productType: String(r.productType),
        }),
      ),
    ),
    allowPrices: options.allowPrices,
    allowLegalBrackets: options.allowLegalBrackets ?? false,
  };
}

/** settings.samples as the storefront parses it (the sales profile switches it off unless --keep-samples). */
export async function readSamplesSettings(db: Db): Promise<Settings<"samples">> {
  const [row] = await db`select value from settings where key = ${"samples"}`;
  return parseSettings("samples", row?.value);
}

/** Fixed-width table printing for the console reports. */
export function printTable(headers: string[], rows: (string | number)[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells: (string | number)[]) =>
    cells.map((c, i) => (typeof c === "number" ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}
