/**
 * Go-live: read-only checks of the target database after the migrations and the content copy
 * (docs/GO-LIVE.md B4/B5). Meant for deploy day, before the first login: later runs report sessions,
 * carts and orders as failures, which is then expected.
 *
 *   npx tsx scripts/golive/verify-target.ts [--profile=showcase|sales] [--allow-prices] [--allow-legal-brackets] [--keep-samples] [--locked-down] [--no-source]
 *   (cwd = project root; --allow-prices, --allow-legal-brackets and --keep-samples only with --profile=sales, as in the copy)
 *
 * Target: TARGET_DATABASE_URL only (same rules as copy-content.ts; never printed). Every query runs in
 * a READ ONLY transaction. The local source (prestij on 127.0.0.1:54329, read-only) is used for the
 * count comparison when it is reachable (--no-source skips it).
 * Checks: applied migrations = drizzle/meta/_journal.json; content row counts = local; no accounts
 * except admins, no sessions/carts/orders/requests/test rows; row level security on every public table
 * (hard rule once a repo migration enables it); the profile's flags (hard rules with --profile=showcase or
 * --profile=sales) and no active announcement linking to a feature that is off (hard rule with a profile);
 * with --profile=sales also the sales readiness (approved legal texts without [placeholders]: --allow-legal-brackets =
 * warning; seller details by the panel's rule; kapıda ödeme and/or havale with a usable bank account; no variant on a
 * Day-1 placeholder price: --allow-prices = warning) and free samples off (--keep-samples: kept, a warning);
 * table/sequence privileges and schema default privileges of Supabase's API roles (anon, authenticated,
 * service_role: warnings, hard rules with --locked-down, the run after the lock-down SQL of docs/GO-LIVE.md);
 * no localhost/test URLs in settings or content, no media under /uploads (files of this PC only);
 * identity sequences ahead of max(id).
 * Exit code 0 = every hard check passed.
 */
import { parseSettings, settingsSchemas, type SettingsKey } from "@/lib/settings/types";
import {
  API_ROLES,
  apiRoleDefaultPrivileges,
  apiRoleGrants,
  appliedMigrations,
  assertConnectedTo,
  countRows,
  errorText,
  existingTables,
  fail,
  firstForeignMigration,
  ident,
  nextSequenceValue,
  openSource,
  openTarget,
  publicTables,
  readSalesReadinessInput,
  readSamplesSettings,
  repoEnablesRls,
  repoMigrationHashes,
  repoMigrations,
  sequenceColumns,
  sourceUrl,
  table,
  targetFromEnv,
  type Db,
} from "./pg";
import {
  ALLOWED_TARGET_USER_ROLES,
  CONTENT_TABLES,
  FEATURE_SETTINGS_KEYS,
  LOCAL_URL_SQL_PATTERN,
  NEVER_COPY_TABLES,
  PROFILE_NAMES,
  PROFILES,
  TEST_MARKER_SQL_PATTERN,
  announcementsToDeactivate,
  describeTarget,
  featureSettingsAfter,
  featuresOff,
  isProfileName,
  legalReadiness,
  paymentProblems,
  priceMatchList,
  priceProblems,
  readPath,
  resolveProfile,
  salesOnlyFlagProblem,
  samplesSummary,
  sellerProblems,
  usableBankAccounts,
  SALES_LEGAL_KEYS,
  SALES_LEGAL_TITLES,
  type ProfileName,
} from "./rules";

const SCRIPT = "verify-target";

type Status = "OK" | "FAIL" | "WARN" | "INFO";
const results: { status: Status; label: string; detail: string }[] = [];

function report(status: Status, label: string, detail: string): void {
  results.push({ status, label, detail });
  console.log(`  ${status.padEnd(4)}  ${label.padEnd(26)} ${detail}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

type Args = { profile: ProfileName | null; source: boolean; lockedDown: boolean; allowPrices: boolean; keepSamples: boolean; allowLegalBrackets: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { profile: null, source: true, lockedDown: false, allowPrices: false, keepSamples: false, allowLegalBrackets: false };
  argv.forEach((a, i) => {
    if (/^--profile=[a-z-]+$/.test(a)) {
      const name = a.slice(10);
      if (!isProfileName(name)) fail(SCRIPT, `unknown profile "${name}" (use ${PROFILE_NAMES.map((p) => `--profile=${p}`).join(" or ")}).`);
      args.profile = name;
    } else if (a === "--no-source") args.source = false;
    else if (a === "--locked-down") args.lockedDown = true;
    else if (a === "--allow-prices") args.allowPrices = true;
    else if (a === "--keep-samples") args.keepSamples = true;
    else if (a === "--allow-legal-brackets") args.allowLegalBrackets = true;
    else if (/^--[a-z=-]+$/.test(a)) {
      fail(SCRIPT, `unknown option ${a} (use --profile=showcase|sales, --allow-prices, --allow-legal-brackets, --keep-samples, --locked-down and/or --no-source).`);
    } else fail(SCRIPT, `argument ${i + 1} is not an option and was ignored unread; the target comes only from TARGET_DATABASE_URL.`);
  });
  const salesOnly = salesOnlyFlagProblem(args.profile, args);
  if (salesOnly) fail(SCRIPT, salesOnly);
  return args;
}

/** Local counts, or null when the local database is not reachable (reported, not fatal). */
async function localCounts(args: Args, targetCheck: ReturnType<typeof targetFromEnv>["check"]) {
  if (!args.source) return null;
  const source = sourceUrl(SCRIPT, targetCheck);
  const src = openSource(source.url);
  try {
    return await src.begin("isolation level repeatable read read only", async (tx) => {
      await assertConnectedTo(tx, source.check.database, "source");
      const counts = new Map<string, number>();
      for (const t of CONTENT_TABLES) counts.set(t, await countRows(tx, t));
      const migrations = (await appliedMigrations(tx)) ?? [];
      const settingsKeys = (await tx`select key from settings order by key`).map((r) => String(r.key));
      return { counts, migrations, settingsKeys };
    });
  } catch (error) {
    console.log(`  (local database not reachable: ${errorText(error)}; counts are shown without comparison)`);
    return null;
  } finally {
    await src.end({ timeout: 5 });
  }
}

async function checkSchema(db: Db, local: Awaited<ReturnType<typeof localCounts>>): Promise<void> {
  section("Schema");
  const journal = repoMigrations();
  const applied = await appliedMigrations(db);
  if (!applied) {
    report("FAIL", "migrations", "drizzle.__drizzle_migrations does not exist (run the migrations, docs/GO-LIVE.md B3)");
    return;
  }
  report(applied.length === journal.length ? "OK" : "FAIL", "migrations", `${applied.length} applied, repo journal has ${journal.length} (last ${journal[journal.length - 1]})`);
  const foreign = firstForeignMigration(applied, repoMigrationHashes());
  report(foreign < 0 ? "OK" : "FAIL", "migration files", foreign < 0 ? "every applied hash matches drizzle/*.sql of this checkout" : `migration ${foreign + 1} (${journal[foreign] ?? "not in the journal"}) differs from this checkout`);
  if (local) {
    const same = local.migrations.length === applied.length && local.migrations.every((m, i) => m.hash === applied[i]?.hash);
    report(same ? "OK" : "WARN", "migration hashes", same ? "identical to the local database" : `local has ${local.migrations.length} migrations / different hashes`);
  }
}

/**
 * settings: every local key must be on the target; extra keys are fine when they are real settings keys
 * (the showcase profile inserts a row for a key that only had defaults locally, e.g. subscriptions).
 */
async function checkSettingsKeys(db: Db, n: number, localKeys: string[]): Promise<void> {
  const keys = new Set((await db`select key from settings`).map((r) => String(r.key)));
  const missing = localKeys.filter((k) => !keys.has(k));
  const local = new Set(localKeys);
  const added = [...keys].filter((k) => !local.has(k)).sort();
  const unknown = added.filter((k) => !(k in settingsSchemas));
  const detail = `${n} rows (local ${localKeys.length}${added.length ? `; added on the target: ${added.join(", ")}` : ""}${missing.length ? `; MISSING: ${missing.join(", ")}` : ""})`;
  report(missing.length ? "FAIL" : unknown.length ? "WARN" : "OK", "settings", detail);
}

async function checkContent(db: Db, local: Awaited<ReturnType<typeof localCounts>>): Promise<void> {
  section("Content (copied tables, target vs local)");
  const present = await existingTables(db, CONTENT_TABLES);
  let total = 0;
  for (const t of CONTENT_TABLES) {
    if (!present.has(t)) {
      report("FAIL", t, "table missing");
      continue;
    }
    const n = await countRows(db, t);
    total += n;
    const expected = local?.counts.get(t);
    if (expected === undefined) report("INFO", t, `${n} rows`);
    else if (t === "settings" && local) await checkSettingsKeys(db, n, local.settingsKeys);
    else report(n === expected ? "OK" : "FAIL", t, `${n} rows (local ${expected})`);
  }
  if (total === 0) report("FAIL", "content", "every content table is empty (the copy has not run)");
}

async function checkPrivate(db: Db): Promise<void> {
  section("Private data (never copied: must be empty, except the panel admin)");
  const present = await existingTables(db, NEVER_COPY_TABLES);
  for (const t of NEVER_COPY_TABLES) {
    if (!present.has(t)) {
      report("FAIL", t, "table missing");
      continue;
    }
    const n = await countRows(db, t);
    if (t === "user") {
      const roles = await db`select role, email_verified, count(*)::int as n from "user" group by role, email_verified order by role`;
      const allowed = new Set<string>(ALLOWED_TARGET_USER_ROLES);
      const bad = roles.filter((r) => !allowed.has(String(r.role)) || !r.email_verified);
      const summary = roles.map((r) => `${r.n} ${r.role}${r.email_verified ? "" : " (unverified)"}`).join(", ") || "none";
      report(bad.length ? "FAIL" : "OK", t, `${n} account(s): ${summary}${n === 0 ? " (run create-admin, B5)" : ""}`);
    } else if (t === "account") {
      const [row] = await db`
        select count(*)::int as n from account a join "user" u on u.id = a.user_id
        where u.role = any(${[...ALLOWED_TARGET_USER_ROLES]}::text[]) and a.provider_id = 'credential'`;
      report(Number(row?.n) === n ? "OK" : "FAIL", t, `${n} row(s), ${row?.n} admin credential(s)`);
    } else {
      report(n === 0 ? "OK" : "FAIL", t, `${n} rows`);
    }
  }

  const marked: string[] = [];
  for (const t of [...CONTENT_TABLES, "user"]) {
    const [row] = await db.unsafe(`select count(*)::int as n from ${table(t)} t where t::text ~* $1`, [TEST_MARKER_SQL_PATTERN]);
    if (Number(row?.n) > 0) marked.push(`${t} ${row?.n}`);
  }
  report(marked.length ? "FAIL" : "OK", "test rows", marked.length ? `rows with @test.local / day6-test- / DAY6TEST / golive-test: ${marked.join(", ")}` : "none");
}

async function checkSecurity(db: Db, args: Args): Promise<void> {
  section("Row level security and API roles");
  const tables = await publicTables(db);
  const rows = await db`
    select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')`;
  const off = rows.filter((r) => !r.enabled).map((r) => String(r.table));
  const forced = rows.filter((r) => r.forced).map((r) => String(r.table));
  const rlsMigration = repoEnablesRls();
  if (off.length === 0) report("OK", "RLS enabled", `on all ${tables.length} public tables`);
  else if (rlsMigration) report("FAIL", "RLS enabled", `missing on ${off.length}/${tables.length} tables although ${rlsMigration} enables it: ${off.join(", ")}`);
  else report("WARN", "RLS enabled", `off on ${off.length}/${tables.length} tables; no repo migration enables RLS yet (the Supabase lock-down SQL of docs/GO-LIVE.md does)`);
  report(forced.length ? "FAIL" : "OK", "RLS not forced", forced.length ? `FORCE set on ${forced.join(", ")} (the app would read no rows)` : "no table forces RLS on its owner");
  const [policies] = await db`select count(*)::int as n from pg_policies where schemaname = 'public'`;
  report("INFO", "RLS policies", `${policies?.n} (none expected: the app connects as the table owner)`);

  const apiRoles = await db`select rolname from pg_roles where rolname = any(${[...API_ROLES]}::text[]) order by rolname`;
  if (apiRoles.length === 0) {
    report("INFO", "API role grants", "no anon/authenticated/service_role roles (not a Supabase database)");
    if (args.lockedDown) report("INFO", "API default privileges", "nothing to check (not a Supabase database)");
    return;
  }
  // Before the lock-down SQL these are expected (Supabase grants them by default): warnings. With --locked-down
  // (the run after it) they must be gone: a lock-down that rolled back (e.g. run together with VACUUM) fails here.
  const leftover = args.lockedDown ? "FAIL" : "WARN";
  const grants = await apiRoleGrants(db);
  report(
    grants.length ? leftover : "OK",
    "API role grants",
    grants.length
      ? `${grants.map((g) => `${g.grantee} ${g.n}`).join(", ")} privileges on public tables/sequences (run the lock-down SQL of docs/GO-LIVE.md B4)`
      : "none on public tables and sequences",
  );
  const defaults = await apiRoleDefaultPrivileges(db);
  report(
    defaults.length ? leftover : "OK",
    "API default privileges",
    defaults.length
      ? `schema public still grants new ${defaults.map((d) => `${d.kind} to ${d.grantee}`).join(", ")} (run the ALTER DEFAULT PRIVILEGES lines of docs/GO-LIVE.md B4)`
      : "none for new tables, sequences or functions in schema public",
  );
}

async function checkProfile(db: Db, args: Args): Promise<void> {
  // Without --profile the showcase flags are shown for information (as before the sales profile existed).
  const profile = args.profile ? resolveProfile(args.profile, { keepSamples: args.keepSamples }) : PROFILES.showcase;
  section(`Launch flags${args.profile ? ` (profile ${args.profile}: hard checks)` : " (informational; --profile=showcase or --profile=sales makes them hard checks)"}`);
  const keys = [...new Set([...profile.expectedFlags.map((f) => f.key), ...FEATURE_SETTINGS_KEYS])];
  const rows = await db`select key, value from settings where key = any(${keys}::text[])`;
  const stored = new Map(rows.map((r) => [String(r.key) as SettingsKey, r.value as unknown]));
  for (const flag of profile.expectedFlags) {
    const value = readPath(parseSettings(flag.key, stored.get(flag.key)), flag.path);
    const ok = value === flag.expected;
    report(ok ? "OK" : args.profile ? "FAIL" : "INFO", `${flag.key}.${flag.path}`, `${String(value)}${stored.has(flag.key) ? "" : " (no row: default)"}`);
  }
  const pages = await db`select slug, is_published from pages where slug = any(${[...profile.unpublishPageSlugs]}::text[])`;
  for (const slug of profile.unpublishPageSlugs) {
    const p = pages.find((r) => r.slug === slug);
    const ok = !p || !p.is_published;
    report(ok ? "OK" : args.profile ? "FAIL" : "INFO", `page ${slug}`, p ? (p.is_published ? "published" : "unpublished") : "not found");
  }
  const [bands] = await db`select count(*)::int as n from page_sections where type = any(${[...profile.hideSectionTypes]}::text[]) and is_visible`;
  report(Number(bands?.n) === 0 ? "OK" : args.profile ? "FAIL" : "INFO", "newsletter bands visible", String(bands?.n));

  // Both profiles: no active announcement may link to a feature that is off on the target.
  const off = featuresOff(featureSettingsAfter([], Object.fromEntries(stored)));
  const ann = await db`select id, href, is_active from announcements where is_active order by position, id`;
  const stale = announcementsToDeactivate(
    ann.map((r) => ({ id: Number(r.id), href: r.href == null ? null : String(r.href), isActive: Boolean(r.is_active) })),
    off,
  );
  report(
    stale.length ? (args.profile ? "FAIL" : "INFO") : "OK",
    "announcement links",
    stale.length
      ? `active announcement(s) linking to a feature that is off: ${stale.map((a) => `${a.id} -> ${a.href} (${a.feature})`).join(", ")} (deactivate them in /panel/duyurular)`
      : `no active announcement links to a feature that is off${off.size ? ` (off: ${[...off].join(", ")})` : ""}`,
  );
}

/** --profile=sales: the readiness rules of the copy (rules.ts), now on what the target holds. */
async function checkSales(db: Db, args: Args): Promise<void> {
  const overrides = [
    args.allowPrices ? "--allow-prices: prices are a warning" : "",
    args.allowLegalBrackets ? "--allow-legal-brackets: [brackets] are a warning" : "",
    args.keepSamples ? "--keep-samples: samples may stay on" : "",
  ].filter(Boolean);
  section(`Sales readiness (profile sales: hard checks${overrides.length ? `; ${overrides.join("; ")}` : ""})`);
  const input = await readSalesReadinessInput(db, { allowPrices: args.allowPrices, allowLegalBrackets: args.allowLegalBrackets });
  const legal = legalReadiness(input.legal, args.allowLegalBrackets);
  for (const key of SALES_LEGAL_KEYS) {
    const doc = input.legal.find((d) => d.key === key);
    const own = legal.problems.filter((p) => p.code.endsWith(`:${key}`));
    const warned = legal.warnings.filter((p) => p.code.endsWith(`:${key}`));
    report(
      own.length ? "FAIL" : warned.length ? "WARN" : "OK",
      `legal ${key}`,
      own.length || warned.length
        ? [...own, ...warned].map((p) => p.en).join(" · ")
        : `${SALES_LEGAL_TITLES[key]}: version "${doc?.version}" approved, no [placeholders]`,
    );
  }
  const seller = sellerProblems(input.general);
  report(
    seller.length ? "FAIL" : "OK",
    "seller details",
    seller.length ? seller.map((p) => p.en).join(" · ") : "every field of the panel's 'Satıcı bilgileri eksiksiz' rule is filled (incl. KEP, chamber and its rules link)",
  );
  const payments = paymentProblems(input.payments);
  const bank = input.payments.bankTransfer;
  report(
    payments.length ? "FAIL" : "OK",
    "payment methods",
    payments.length
      ? payments.map((p) => p.en).join(" · ")
      : `kapıda ödeme ${input.payments.cashOnDelivery.enabled ? "on" : "off"}, havale ${bank.enabled ? `on (${usableBankAccounts(input.payments).length} usable account(s), ${bank.paymentDays} day(s) to pay)` : "off"}`,
  );
  const prices = priceProblems(input.prices, args.allowPrices);
  report(
    prices.problems.length ? "FAIL" : prices.warnings.length ? "WARN" : "OK",
    "prices",
    [...prices.problems, ...prices.warnings].map((p) => p.en).join(" · ") ||
      `none of the ${input.prices.considered} priced variants is on a Day-1 price${input.prices.matches.length ? ` (${priceMatchList(input.prices)})` : ""}`,
  );
  // FIX F1: free samples only after ÜTS. The flags themselves are hard checks in "Launch flags" (unless --keep-samples).
  const samples = samplesSummary(await readSamplesSettings(db), args.keepSamples, "target");
  report(samples.status, "samples", samples.en);
}

async function checkUrls(db: Db): Promise<void> {
  section("Local URLs and media");
  const settings = await db`select key from settings where value::text ~* ${LOCAL_URL_SQL_PATTERN} order by key`;
  report(settings.length ? "FAIL" : "OK", "settings", settings.length ? `localhost/test values in: ${settings.map((r) => r.key).join(", ")}` : "no localhost or .local values");
  const found: string[] = [];
  for (const t of CONTENT_TABLES) {
    if (t === "settings") continue;
    const [row] = await db.unsafe(`select count(*)::int as n from ${table(t)} t where t::text ~* $1`, [LOCAL_URL_SQL_PATTERN]);
    if (Number(row?.n) > 0) found.push(`${t} ${row?.n}`);
  }
  report(found.length ? "FAIL" : "OK", "content", found.length ? `rows with localhost/.local: ${found.join(", ")}` : "no localhost or .local values");
  // Panel uploads made on this PC (local storage driver) live in storage/uploads, which is gitignored: on the
  // live site those images are missing. Fixed by re-uploading in the live panel after B6 (docs/GO-LIVE.md).
  const uploads = await db`select id from media where url like '/uploads/%' order by id`;
  report(
    uploads.length ? "FAIL" : "OK",
    "media uploads",
    uploads.length
      ? `media id(s) ${uploads.map((r) => r.id).join(", ")} point to /uploads/ (a file on the lead's PC only): re-upload in the live /panel/medya after B6, select it again where it was used, then delete the old row`
      : "no media under /uploads/",
  );
  const [media] = await db`select count(*)::int as n, count(*) filter (where url not like '/media/%' and url not like '/uploads/%')::int as other from media`;
  report(
    Number(media?.other) === 0 ? "OK" : "WARN",
    "media URLs",
    `${media?.n} rows, ${media?.other} neither under /media/ nor /uploads/ (files under /media ship with the code; anything else must exist in Supabase Storage)`,
  );
}

async function checkSequences(db: Db): Promise<void> {
  section("Identity sequences (next id must be above max(id))");
  const behind: string[] = [];
  const seqs = await sequenceColumns(db, CONTENT_TABLES);
  for (const s of seqs) {
    const [row] = await db.unsafe(`select coalesce(max(${ident(s.column)}), 0)::bigint::text as max from ${table(s.table)}`);
    const next = await nextSequenceValue(db, s.sequence);
    if (next <= Number(row?.max ?? 0)) behind.push(`${s.table} (next ${next}, max ${row?.max})`);
  }
  report(behind.length ? "FAIL" : "OK", "content tables", behind.length ? `behind: ${behind.join(", ")}` : `${seqs.length} sequences ahead of their data`);
  const [order] = await db`select to_regclass('public.order_number_seq') is not null as ok`;
  if (order?.ok) report("INFO", "order_number_seq", `next ${await nextSequenceValue(db, "public.order_number_seq")} (first order number suffix)`);
}

async function checkNotes(db: Db): Promise<void> {
  section("For the owner (information only)");
  // Same rule as the checkout (isDraftLegalVersion): a label starting with "taslak", any case.
  const drafts = await db`select key from legal_documents where is_current and lower(btrim(version)) like 'taslak%' order by key`;
  report(
    "INFO",
    "draft legal texts",
    drafts.length
      ? `${drafts.length}: ${drafts.map((r) => r.key).join(", ")} (the checkout stays closed while pre_information or distance_sales is a draft)`
      : "none",
  );
  const ann = await db`select id, text->>'tr' as tr from announcements where is_active order by position, id`;
  for (const a of ann) report("INFO", `announcement ${a.id}`, String(a.tr ?? "").slice(0, 90));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = targetFromEnv(SCRIPT);
  console.log(`${SCRIPT}: read-only checks of ${describeTarget(target.check)}${args.lockedDown ? " (after the lock-down)" : ""}`);
  const local = await localCounts(args, target.check);
  const dst = openTarget(target.url);
  try {
    await dst.begin("read only", async (db) => {
      await assertConnectedTo(db, target.check.database, "target");
      await checkSchema(db, local);
      await checkContent(db, local);
      await checkPrivate(db);
      await checkSecurity(db, args);
      await checkProfile(db, args);
      if (args.profile === "sales") await checkSales(db, args);
      await checkUrls(db);
      await checkSequences(db);
      await checkNotes(db);
    });
  } finally {
    await dst.end({ timeout: 5 });
  }
  const failed = results.filter((r) => r.status === "FAIL");
  const warned = results.filter((r) => r.status === "WARN");
  console.log(
    failed.length
      ? `\nVERIFY FAILED: ${failed.length} check(s): ${failed.map((r) => r.label).join(", ")}`
      : `\nVERIFY OK${warned.length ? ` (${warned.length} warning(s): ${warned.map((r) => r.label).join(", ")})` : ""}: ${describeTarget(target.check)}`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(`${SCRIPT}: FAILED: ${errorText(error)}`);
  process.exit(1);
});
