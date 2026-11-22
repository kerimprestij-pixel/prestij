/**
 * The flow of scripts/golive/copy-content.ts without the command line (FIX F11: importable and testable with
 * stubbed connections, tests/unit/salesready-fix.test.ts). No environment, no process.exit: refusals throw
 * Refusal (pg.ts), which the CLI prints as "copy-content: REFUSED: …".
 *
 * Order of a run (docs/GO-LIVE.md B4):
 *   1. the source is the database the URL guard checked;
 *   2. --profile=sales: every sales-readiness rule on the LOCAL content (rules.ts salesReadiness). A refusal is
 *      thrown here, before the target is touched at all (no statement is sent to it);
 *   3. the target preflight (migrations, empty content tables, columns, RLS, outside references);
 *   4. dry run: the plan and the profile preview, nothing written;
 *   5. copy: ONE repeatable-read source snapshot, ONE target transaction (COPY table by table, sequences reset,
 *      the profile applied and read back). With --profile=sales the readiness rules run AGAIN on the copied
 *      content inside that transaction (FIX F5: the content that is committed is the content that was checked);
 *      a problem rolls everything back.
 */
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type postgres from "postgres";
import { parseSettings, settingsSchemas, type SettingsKey } from "@/lib/settings/types";
import {
  Refusal,
  appliedMigrations,
  assertConnectedTo,
  countRows,
  errorText,
  existingTables,
  firstForeignMigration,
  foreignKeys,
  hasRows,
  ident,
  printTable,
  readSalesReadinessInput,
  readSamplesSettings,
  repoMigrationHashes,
  sequenceColumns,
  table,
  tableColumns,
  type Db,
  type Pool,
  type ReadinessOptions,
  type SequenceColumn,
} from "./pg";
import {
  CONTENT_TABLES,
  FEATURE_SETTINGS_KEYS,
  SALES_LEGAL_KEYS,
  announcementsToDeactivate,
  buildSettingsChanges,
  changedPaths,
  columnMismatch,
  externalParents,
  featureSettingsAfter,
  featuresOff,
  orderParentsFirst,
  priceMatchList,
  readPath,
  resolveProfile,
  salesReadiness,
  samplesSummary,
  usableBankAccounts,
  type Column,
  type FieldChange,
  type GoLiveProfile,
  type ProfileName,
  type ReadinessProblem,
  type SalesReadinessInput,
  type SettingsChange,
} from "./rules";

export const SCRIPT = "copy-content";

export type CopyArgs = {
  dryRun: boolean;
  profile: ProfileName | null;
  allowPrices: boolean;
  /** --keep-samples (sales only): settings.samples stays as configured (ÜTS confirmed). */
  keepSamples: boolean;
  /** --allow-legal-brackets (sales only): [bracketed] text the lawyer approved is a warning. */
  allowLegalBrackets: boolean;
};

/**
 * How far the target transaction got (the CLI's failure message depends on it): "committing" is set as the last
 * step inside the target transaction, so an error after it (the COMMIT itself failing, or the connection dropping
 * while it is in flight) may or may not have committed; "committed" is set as soon as the target COMMIT has
 * returned, still inside the read-only source transaction (whose own COMMIT can still fail).
 */
export type CopyState = { phase: "copying" | "committing" | "committed" };

export type CopyRun = {
  args: CopyArgs;
  /** The local source (read-only pool) and the target (one connection). */
  src: Pool;
  dst: Pool;
  /** drizzle/meta/_journal.json tags (repoMigrations()). */
  journal: string[];
  /** The databases the URL guard checked (assertConnectedTo compares them with current_database()). */
  databases: { source: string; target: string };
  /** describeTarget(check): printed, never a URL. */
  targetLabel: string;
  state: CopyState;
};

function refuse(message: string): never {
  throw new Refusal(message);
}

export const readinessOptions = (args: Pick<CopyArgs, "allowPrices" | "allowLegalBrackets">): ReadinessOptions => ({
  allowPrices: args.allowPrices,
  allowLegalBrackets: args.allowLegalBrackets,
});

export function printProblem(p: ReadinessProblem, to: "log" | "error" = "log"): void {
  const out = to === "error" ? console.error : console.log;
  out(`  - ${p.tr}`);
  out(`    ${p.en}`);
}

/** The readiness summary both checks print (legal texts, seller, payments, prices, samples, warnings). */
function printReadinessSummary(
  title: string,
  input: SalesReadinessInput,
  result: { problems: ReadinessProblem[]; warnings: ReadinessProblem[] },
  samples: { cartSampleEnabled: boolean; requestFormEnabled: boolean },
  keepSamples: boolean,
): void {
  const approved = SALES_LEGAL_KEYS.filter((key) => !result.problems.some((p) => p.code.endsWith(`:${key}`))).length;
  const bank = input.payments.bankTransfer;
  const sampleLine = samplesSummary(samples, keepSamples, "local");
  console.log(`\n${title}`);
  console.log(`  legal texts         ${approved}/${SALES_LEGAL_KEYS.length} current and approved (${SALES_LEGAL_KEYS.join(", ")})`);
  console.log(`  seller details      ${result.problems.some((p) => p.code === "seller") ? "incomplete" : "complete (the panel's 'Satıcı bilgileri eksiksiz' rule)"}`);
  console.log(
    `  payments            kapıda ödeme ${input.payments.cashOnDelivery.enabled ? "on" : "off"}, havale ${bank.enabled ? `on (${usableBankAccounts(input.payments).length} usable account(s), ${bank.paymentDays} day(s) to pay)` : "off"}, card -> off (until PayTR)`,
  );
  console.log(
    `  prices              ${input.prices.matches.length}/${input.prices.considered} priced variants on a Day-1 price${input.prices.matches.length ? `: ${priceMatchList(input.prices)}` : ""}`,
  );
  console.log(`  samples             ${sampleLine.status === "WARN" ? "WARN  " : ""}${sampleLine.en}`);
  for (const w of result.warnings) {
    console.log(`  WARN  ${w.code.startsWith("prices") ? "--allow-prices" : "--allow-legal-brackets"}:`);
    printProblem(w);
  }
}

/**
 * --profile=sales, step 2: every readiness rule on the LOCAL content (what the copy would carry over), before the
 * target is touched. Refuses with all problems listed (Turkish, then English); --allow-prices and
 * --allow-legal-brackets turn their rule into warnings.
 */
export async function salesGate(src: Db, args: Pick<CopyArgs, "allowPrices" | "allowLegalBrackets" | "keepSamples">): Promise<void> {
  const input = await readSalesReadinessInput(src, readinessOptions(args));
  const samples = await readSamplesSettings(src);
  const result = salesReadiness(input);
  printReadinessSummary("Sales readiness (profile sales; the local content as it would be copied)", input, result, samples, args.keepSamples);
  if (result.problems.length) {
    console.error(`\n${SCRIPT}: satışa hazır değil / not ready for sales (${result.problems.length}):`);
    for (const p of result.problems) printProblem(p, "error");
    refuse(`satış profili reddedildi, hiçbir şey yazılmadı / the sales profile was refused, nothing was written (${result.problems.length} problem(s) above).`);
  }
  console.log("  sales readiness     OK");
}

/**
 * --profile=sales inside the target transaction, after the profile (FIX F5): the readiness rules on what was copied.
 * A problem (the local content changed between the first check and the copy snapshot) throws, so nothing commits.
 */
export async function assertCopiedContentReady(tx: Db, args: Pick<CopyArgs, "allowPrices" | "allowLegalBrackets">): Promise<void> {
  const result = salesReadiness(await readSalesReadinessInput(tx, readinessOptions(args)));
  if (result.problems.length) {
    console.error(`\n${SCRIPT}: the copied content is not ready for sales (it changed after the first check) (${result.problems.length}):`);
    for (const p of result.problems) printProblem(p, "error");
    refuse(
      `satış profili reddedildi: kopyalanan içerik satışa hazır değil, kopya geri alındı / the copied content is not ready for sales: the copy was rolled back, nothing was committed (${result.problems.length} problem(s) above).`,
    );
  }
  console.log("  sales readiness     OK (checked again on the copied content, inside the transaction)");
}

type Plan = {
  order: string[];
  columns: Map<string, Column[]>;
  sourceCounts: Map<string, number>;
  sequences: SequenceColumn[];
  migrations: number;
};

/** Every refusal rule of the target, checked before anything is written (also the whole --dry-run). */
async function preflight(src: Db, dst: Db, journal: string[], databases: { source: string; target: string }): Promise<Plan> {
  await assertConnectedTo(src, databases.source, "source");
  await assertConnectedTo(dst, databases.target, "target");
  const [ro] = await src`show default_transaction_read_only`;
  if (ro?.default_transaction_read_only !== "on") refuse("the source connection is not read-only.");
  const [srcEnc] = await src`show server_encoding`;
  const [dstEnc] = await dst`show server_encoding`;
  if (srcEnc?.server_encoding !== dstEnc?.server_encoding) {
    refuse(`encodings differ (local ${srcEnc?.server_encoding}, target ${dstEnc?.server_encoding}).`);
  }

  const applied = await appliedMigrations(dst);
  if (!applied) return refuse("the target has no drizzle.__drizzle_migrations table: run the migrations first (docs/GO-LIVE.md B3).");
  if (applied.length !== journal.length) {
    refuse(`the target has ${applied.length} applied migrations, the repo ships ${journal.length} (drizzle/meta/_journal.json): run drizzle-kit migrate against it first.`);
  }
  const foreign = firstForeignMigration(applied, repoMigrationHashes());
  if (foreign >= 0) {
    refuse(`target migration ${foreign + 1} (${journal[foreign]}) was applied from a different file than this checkout's drizzle/${journal[foreign]}.sql: run B3 from this project folder.`);
  }
  const local = await appliedMigrations(src);
  const localNote =
    !local ? "none (!)" : local.length === journal.length ? `${local.length}/${journal.length}  OK` : `${local.length}/${journal.length} (local DB not on the latest migration; the column check decides)`;
  const hashMismatch = local ? local.findIndex((m, i) => applied[i] && applied[i].hash !== m.hash) : -1;

  const [srcTables, dstTables] = await Promise.all([existingTables(src, CONTENT_TABLES), existingTables(dst, CONTENT_TABLES)]);
  const missing = CONTENT_TABLES.filter((t) => !srcTables.has(t) || !dstTables.has(t));
  if (missing.length) refuse(`content table(s) missing locally or on the target: ${missing.join(", ")}.`);

  const [srcColumns, dstColumns] = await Promise.all([tableColumns(src, CONTENT_TABLES), tableColumns(dst, CONTENT_TABLES)]);
  const columnProblems = CONTENT_TABLES.map((t) => [t, columnMismatch(srcColumns.get(t), dstColumns.get(t))] as const).filter(([, p]) => p);
  if (columnProblems.length) refuse(`schemas differ: ${columnProblems.map(([t, p]) => `${t}: ${p}`).join("; ")}.`);

  const notEmpty: string[] = [];
  for (const t of CONTENT_TABLES) if (await hasRows(dst, t)) notEmpty.push(t);
  if (notEmpty.length) {
    refuse(`the target is not empty (${notEmpty.join(", ")}). A copy has probably committed already: run verify-target. To start over, see docs/GO-LIVE.md "Start the copy over".`);
  }

  const rls = await dst`
    select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced, row_security_active(c.oid) as active
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(${[...CONTENT_TABLES]}::text[])`;
  const forced = rls.filter((r) => r.forced).map((r) => String(r.table));
  if (forced.length) refuse(`FORCE ROW LEVEL SECURITY is set on ${forced.join(", ")}: the app (table owner) would read no rows there.`);
  const active = rls.filter((r) => r.active).map((r) => String(r.table));
  if (active.length) {
    refuse(`row level security applies to this login on ${active.join(", ")} (COPY FROM is not possible then): connect as the table owner (postgres.<ref>).`);
  }
  const rlsOn = rls.filter((r) => r.enabled).length;

  const edges = await foreignKeys(dst);
  const order = orderParentsFirst(CONTENT_TABLES, edges);
  for (const edge of externalParents(CONTENT_TABLES, edges)) {
    const cols = edge.columns ?? [];
    if (!cols.length) continue;
    const [row] = await src.unsafe(`select count(*)::int as n from ${table(edge.child)} where ${cols.map((c) => `${ident(c)} is not null`).join(" or ")}`);
    if (Number(row?.n) > 0) {
      refuse(`${row?.n} row(s) of ${edge.child} reference ${edge.parent} (${edge.constraint}), which is not copied.`);
    }
  }

  const sourceCounts = new Map<string, number>();
  for (const t of order) sourceCounts.set(t, await countRows(src, t));
  const sequences = await sequenceColumns(dst, CONTENT_TABLES);
  // Panel uploads made on this PC live in storage/uploads (gitignored): they never reach Vercel. Not a refusal
  // (a missing image is fixed by re-uploading it in the live panel), but verify-target reports it as FAIL.
  const uploads = await src`select id from media where url like '/uploads/%' order by id`;

  console.log("\nPreflight");
  console.log(`  target migrations   ${applied.length}/${journal.length}, hashes = repo files (last: ${journal[journal.length - 1]})  OK`);
  console.log(`  local migrations    ${localNote}${hashMismatch >= 0 ? `  WARN: migration ${hashMismatch + 1} has another hash locally` : ""}`);
  console.log(`  content tables      ${CONTENT_TABLES.length} on both sides, columns compatible  OK`);
  console.log(`  target content      all ${CONTENT_TABLES.length} tables empty  OK`);
  console.log(`  row level security  enabled on ${rlsOn}/${CONTENT_TABLES.length} content tables; not applied to this login  OK`);
  console.log(`  outside references  none with data  OK`);
  if (uploads.length) {
    console.log(`  media uploads       WARN: media id(s) ${uploads.map((r) => r.id).join(", ")} point to /uploads/ (a file on this PC only): re-upload them in the live panel after B6 (docs/GO-LIVE.md)`);
  }

  return { order, columns: srcColumns, sourceCounts, sequences, migrations: applied.length };
}

function formatValue(v: unknown): string {
  return v === undefined ? "(none)" : JSON.stringify(v);
}

function formatChanges(changes: FieldChange[]): string {
  return changes.map((c) => `${c.path} ${formatValue(c.from)} -> ${formatValue(c.to)}`).join(", ");
}

function printSettingsChanges(changes: SettingsChange[]): void {
  for (const c of changes) {
    const how = c.existed ? (c.repaired ? "existing row, repaired per field as the storefront does" : "existing row") : "no row yet: inserted with the schema defaults";
    console.log(`  settings.${c.key.padEnd(14)} ${formatChanges(c.fields) || "(already as wanted)"}  [${how}; validated with settingsSchemas.${c.key}]`);
    if (c.normalized.length) console.log(`  ${"".padEnd(23)} also written in parsed form: ${formatChanges(c.normalized)}`);
  }
}

function printKeptSamples(profile: GoLiveProfile): void {
  if (profile.keepsSamples) console.log("  settings.samples       WARN  --keep-samples: not touched (cart samples and the /numune form stay as configured; ÜTS confirmed)");
}

async function readStoredSettings(db: Db, keys: readonly string[]): Promise<Partial<Record<SettingsKey, unknown>>> {
  const rows = await db`select key, value from settings where key = any(${[...keys]}::text[])`;
  return Object.fromEntries(rows.map((r) => [String(r.key), r.value as unknown]));
}

/** Active announcements of `db` that link to a feature the profile leaves off (to deactivate). */
async function announcementsOff(db: Db, changes: SettingsChange[]) {
  const stored = await readStoredSettings(db, FEATURE_SETTINGS_KEYS);
  const off = featuresOff(featureSettingsAfter(changes, stored));
  const rows = await db`select id, href, is_active, text->>'tr' as tr from announcements where is_active order by position, id`;
  return announcementsToDeactivate(
    rows.map((r) => ({ id: Number(r.id), href: r.href == null ? null : String(r.href), isActive: Boolean(r.is_active), text: r.tr == null ? null : String(r.tr) })),
    off,
  );
}

function printAnnouncements(list: Awaited<ReturnType<typeof announcementsOff>>, done: boolean): void {
  if (!list.length) {
    console.log("  announcements       none links to a feature the profile leaves off");
    return;
  }
  for (const a of list) {
    console.log(
      `  announcement ${String(a.id).padEnd(6)} ${done ? "deactivated" : "-> inactive"}: links to ${a.href} (${a.feature} off) “${String(a.text ?? "").slice(0, 60)}”`,
    );
  }
}

/** Read-only preview of the profile on the source rows (what the target would get). */
async function previewProfile(src: Db, profile: GoLiveProfile): Promise<void> {
  console.log(`\nProfile ${profile.name} (would be applied to the TARGET only, inside the copy transaction)`);
  const changes = buildSettingsChanges(profile.settings, await readStoredSettings(src, Object.keys(profile.settings)));
  printSettingsChanges(changes);
  printKeptSamples(profile);
  const pages = await src`select id, slug, is_published from pages where slug = any(${[...profile.unpublishPageSlugs]}::text[]) order by id`;
  for (const slug of profile.unpublishPageSlugs) {
    const p = pages.find((r) => r.slug === slug);
    console.log(`  pages               ${slug}: ${p ? `id ${p.id}, ${p.is_published ? "published -> unpublished" : "already unpublished"}` : "not found (nothing to do)"}`);
  }
  const sections = await src`select id, page_id, type from page_sections where type = any(${[...profile.hideSectionTypes]}::text[]) and is_visible order by id`;
  console.log(`  page_sections       ${sections.length ? sections.map((s) => `id ${s.id} (${s.type}, page ${s.page_id})`).join(", ") + " -> hidden" : "no visible newsletter band"}`);
  printAnnouncements(await announcementsOff(src, changes), false);
}

/**
 * Reads the written settings back inside the transaction: each must be a JSON object that passes the
 * app's schema unchanged and gives the storefront exactly the profile's flags. Otherwise it throws and
 * nothing commits.
 */
async function assertProfileStored(tx: Db, changes: SettingsChange[], profile: GoLiveProfile): Promise<void> {
  const keys = [...new Set([...changes.map((c) => c.key), ...profile.expectedFlags.map((f) => f.key)])];
  const rows = await tx`select key, jsonb_typeof(value) as kind, value from settings where key = any(${keys}::text[])`;
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  for (const c of changes) {
    const row = byKey.get(c.key);
    if (!row || row.kind !== "object") throw new Error(`settings "${c.key}" was not stored as a JSON object (${row?.kind ?? "missing"}).`);
    const parsed = settingsSchemas[c.key].safeParse(row.value);
    if (!parsed.success || changedPaths(parsed.data, c.value).length > 0) throw new Error(`settings "${c.key}" reads back differently from what was written.`);
  }
  for (const flag of profile.expectedFlags) {
    const value = readPath(parseSettings(flag.key, byKey.get(flag.key)?.value), flag.path);
    if (value !== flag.expected) throw new Error(`after the profile the storefront would read ${flag.key}.${flag.path} = ${String(value)}.`);
  }
}

/** The profile inside the target transaction (settings validated before writing; prints a summary). */
async function applyProfile(tx: Db, profile: GoLiveProfile): Promise<void> {
  console.log(`\nProfile ${profile.name} (TARGET only; the local database is not changed)`);
  const keys = Object.keys(profile.settings);
  const rows = await tx`select key, value from settings where key = any(${keys}::text[]) for update`;
  const changes = buildSettingsChanges(profile.settings, Object.fromEntries(rows.map((r) => [String(r.key), r.value as unknown])));
  for (const c of changes) {
    // tx.json(): postgres.js serializes it once. (A pre-stringified string sent to a jsonb parameter
    // would be stored as a JSON *string*, which the storefront parses as "all defaults": payments on.)
    await tx`
      insert into settings (key, value, updated_at) values (${c.key}, ${tx.json(c.value as postgres.JSONValue)}, now())
      on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
  }
  await assertProfileStored(tx, changes, profile);
  printSettingsChanges(changes);
  printKeptSamples(profile);

  const pages = await tx`
    update pages set is_published = false, updated_at = now()
    where slug = any(${[...profile.unpublishPageSlugs]}::text[]) and is_published
    returning id, slug`;
  for (const slug of profile.unpublishPageSlugs) {
    const p = pages.find((r) => r.slug === slug);
    console.log(`  pages               ${slug}: ${p ? `id ${p.id} unpublished (404 on /sayfa, left out of the sitemap)` : "not published or not found (nothing to do)"}`);
  }
  const sections = await tx`
    update page_sections set is_visible = false, updated_at = now()
    where type = any(${[...profile.hideSectionTypes]}::text[]) and is_visible
    returning id, page_id, type`;
  console.log(`  page_sections       ${sections.length ? sections.map((s) => `id ${s.id} (${s.type}, page ${s.page_id})`).join(", ") + " hidden" : "no visible newsletter band"}`);

  // The settings are written above, so the feature rule reads what the storefront will read.
  const stale = await announcementsOff(tx, []);
  if (stale.length) {
    const ids = stale.map((a) => a.id);
    const updated = await tx`update announcements set is_active = false, updated_at = now() where id = any(${ids}::int[]) and is_active returning id`;
    if (updated.length !== ids.length) throw new Error(`announcements: ${ids.length} to deactivate, ${updated.length} updated.`);
  }
  printAnnouncements(stale, true);
}

/** Session settings that make COPY's text format unambiguous on both sides (transaction-local). */
async function pinFormats(db: Db): Promise<void> {
  await db`set local timezone = 'UTC'`;
  await db`set local datestyle = 'ISO, MDY'`;
  await db`set local intervalstyle = 'postgres'`;
  await db`set local extra_float_digits = 3`;
  await db`set local bytea_output = 'hex'`;
}

type CopyResult = { table: string; source: number; copied: number; target: number; next: string };

async function copyAll(srcPool: Pool, dstPool: Pool, plan: Plan, profile: GoLiveProfile | null, args: CopyArgs, state: CopyState): Promise<CopyResult[]> {
  const results: CopyResult[] = [];
  await srcPool.begin("isolation level repeatable read read only", async (src) => {
    await pinFormats(src);
    await dstPool.begin(async (tx) => {
      await pinFormats(tx);
      for (const name of plan.order) {
        const cols = (plan.columns.get(name) ?? []).map((c) => ident(c.name)).join(", ");
        const source = await countRows(src, name);
        const reader = await src.unsafe(`copy ${table(name)} (${cols}) to stdout`).readable();
        const writer = await tx.unsafe(`copy ${table(name)} (${cols}) from stdin`).writable();
        await pipeline(reader, writer);
        const copied = Number((writer as Writable & { count?: number }).count ?? Number.NaN);
        const target = await countRows(tx, name);
        if (copied !== source || target !== source) throw new Error(`${name}: local ${source} rows, copied ${copied}, target ${target}`);
        results.push({ table: name, source, copied, target, next: "-" });
      }

      for (const s of plan.sequences) {
        const [row] = await tx.unsafe(
          `select setval($1::regclass, coalesce((select max(${ident(s.column)}) from ${table(s.table)}), 0) + 1, false)::text as next`,
          [s.sequence],
        );
        const r = results.find((x) => x.table === s.table);
        if (r) r.next = `${s.column} ${row?.next}`;
      }

      if (profile) await applyProfile(tx, profile);
      if (profile?.name === "sales") await assertCopiedContentReady(tx, args);
      state.phase = "committing"; // last statement inside the target transaction: its COMMIT follows
    });
    state.phase = "committed"; // the target COMMIT has returned (the source's read-only COMMIT is still to come)
  });
  return results;
}

/** One run of copy-content (dry run or copy). Throws Refusal for every refusal; never exits the process. */
export async function runCopy(run: CopyRun): Promise<void> {
  const { args, src, dst, journal, databases, targetLabel, state } = run;
  const profile = args.profile ? resolveProfile(args.profile, { keepSamples: args.keepSamples }) : null;

  await assertConnectedTo(src, databases.source, "source");
  // Sales readiness first: a shop that is not ready is refused before a single statement reaches the target.
  if (profile?.name === "sales") await salesGate(src, args);

  const plan = await preflight(src, dst, journal, databases);
  console.log("\nCopy order (parents first, from the target's foreign keys)");
  printTable(
    ["#", "table", "local rows", "columns"],
    plan.order.map((t, i) => [i + 1, t, plan.sourceCounts.get(t) ?? 0, plan.columns.get(t)?.length ?? 0]),
  );
  const total = [...plan.sourceCounts.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${total} rows in ${plan.order.length} tables; identity sequences to reset: ${plan.sequences.map((s) => s.table).join(", ")}`);

  if (args.dryRun) {
    if (profile) await previewProfile(src, profile);
    console.log(`\nDRY RUN OK: nothing was written to ${targetLabel}.`);
    return;
  }

  const results = await copyAll(src, dst, plan, profile, args, state);
  console.log("\nCopied (one transaction, committed)");
  printTable(
    ["table", "local", "copied", "target", "next id"],
    results.map((r) => [r.table, r.source, r.copied, r.target, r.next]),
  );
  for (const t of plan.order) {
    try {
      await dst.unsafe(`analyze ${table(t)}`);
    } catch (error) {
      console.log(`  (analyze ${t} skipped: ${errorText(error)})`);
    }
  }
  const rows = results.reduce((a, r) => a + r.target, 0);
  const extra = [args.allowPrices ? "--allow-prices" : "", args.keepSamples ? "--keep-samples" : "", args.allowLegalBrackets ? "--allow-legal-brackets" : ""].filter(Boolean).join(" ");
  console.log(
    `\nOK: ${rows} rows in ${results.length} tables copied to ${targetLabel}` +
      `${args.profile ? `, profile ${args.profile} applied` : ""}. Next: npx.cmd tsx scripts/golive/verify-target.ts${args.profile ? ` --profile=${args.profile}` : ""}${extra ? ` ${extra}` : ""}`,
  );
}
