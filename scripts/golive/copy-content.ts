/**
 * Go-live: copies the owner's CONTENT (catalog, pages, blog, legal texts, settings, media rows, …) from
 * the local database to a target whose schema was created by the repo migrations (docs/GO-LIVE.md B4).
 *
 *   npx tsx scripts/golive/copy-content.ts --dry-run --profile=sales|showcase [sales options]   plan + counts, writes nothing
 *   npx tsx scripts/golive/copy-content.ts --profile=sales|showcase [sales options]             copy (cwd = project root)
 *   sales options: --allow-prices, --allow-legal-brackets, --keep-samples (each refused without --profile=sales)
 *
 * Target: ONLY the environment variable TARGET_DATABASE_URL (never an argument or a file; never printed).
 * Accepted: the Supabase session pooler (*.pooler.supabase.com:5432/postgres with ?sslmode=require) or a
 * local rehearsal database named prestij_golive_*. A PRODUCTION target needs --profile (FIX F6; a plain copy
 * stays for local rehearsals). Refused unless the target has applied exactly the migrations of
 * drizzle/meta/_journal.json and every content table on it is empty.
 * Source: the local database prestij (127.0.0.1:54329), opened read-only (SOURCE_DATABASE_URL may name
 * another local database). One repeatable-read snapshot of the source, ONE target transaction: COPY TO
 * STDOUT is streamed into COPY FROM STDIN table by table (parents first, from pg_constraint), every
 * identity sequence of a copied table is reset to max(id), and the profile then switches the TARGET only:
 * --profile=showcase (payments, wheel, newsletter, samples, subscriptions off; wheel terms page unpublished;
 * newsletter band hidden); --profile=sales keeps kapıda ödeme and havale as configured and switches card
 * payments, wheel, newsletter, free samples (until ÜTS; --keep-samples keeps them) and subscriptions off (same
 * page and band changes). The sales profile REFUSES before the target is touched while a sales legal text is a
 * draft or has [placeholders] (--allow-legal-brackets: warning), seller details are missing (the panel's rule),
 * neither kapıda ödeme nor havale can take orders, havale has no usable bank account, or any variant still has a
 * Day-1 placeholder price (--allow-prices: warning), and checks the same rules again on the copied content
 * inside the transaction (FIX F5). Both profiles deactivate active announcements that link to a feature they
 * leave switched off (e.g. /numune while both sample options are off) and print them. Any error rolls
 * everything back. The flow lives in ./copy-run.ts (testable); this file is the command line.
 * Never copied: accounts, sessions, carts, orders, coupons, reviews, requests, mail log (rules.ts).
 */
import { type CopyArgs, type CopyState, SCRIPT, runCopy } from "./copy-run";
import { Refusal, errorText, fail, openSource, openTarget, repoMigrations, sourceUrl, targetFromEnv } from "./pg";
import { PROFILE_NAMES, describeTarget, isProfileName, productionProfileProblem, salesOnlyFlagProblem } from "./rules";

const state: CopyState = { phase: "copying" };

function parseArgs(argv: string[]): CopyArgs {
  const args: CopyArgs = { dryRun: false, profile: null, allowPrices: false, keepSamples: false, allowLegalBrackets: false };
  argv.forEach((a, i) => {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--allow-prices") args.allowPrices = true;
    else if (a === "--keep-samples") args.keepSamples = true;
    else if (a === "--allow-legal-brackets") args.allowLegalBrackets = true;
    else if (/^--profile=[a-z-]+$/.test(a)) {
      const name = a.slice(10);
      if (!isProfileName(name)) fail(SCRIPT, `unknown profile "${name}" (use ${PROFILE_NAMES.map((p) => `--profile=${p}`).join(" or ")}).`);
      args.profile = name;
    } else if (/^--[a-z-]+$/.test(a)) {
      fail(SCRIPT, `unknown option ${a} (use --dry-run, --profile=showcase|sales, --allow-prices, --allow-legal-brackets and/or --keep-samples).`);
    }
    // Never echo other arguments: one could be a URL with its password.
    else fail(SCRIPT, `argument ${i + 1} is not an option and was ignored unread; the target comes only from TARGET_DATABASE_URL.`);
  });
  const salesOnly = salesOnlyFlagProblem(args.profile, args);
  if (salesOnly) fail(SCRIPT, salesOnly);
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = targetFromEnv(SCRIPT);
  const needsProfile = productionProfileProblem(target.check.kind, args.profile);
  if (needsProfile) fail(SCRIPT, needsProfile);
  const source = sourceUrl(SCRIPT, target.check);
  const journal = repoMigrations();
  const flags = [args.allowPrices ? "--allow-prices" : "", args.keepSamples ? "--keep-samples" : "", args.allowLegalBrackets ? "--allow-legal-brackets" : ""].filter(Boolean);

  console.log(
    `${SCRIPT}: ${args.dryRun ? "DRY RUN" : "COPY"} from local ${source.check.host}:${source.check.port}/${source.check.database} (read-only) ` +
      `to ${describeTarget(target.check)}${args.profile ? `, profile ${args.profile}` : ", no profile"}${flags.length ? ` (${flags.join(" ")})` : ""}`,
  );

  const src = openSource(source.url);
  const dst = openTarget(target.url);
  try {
    await runCopy({
      args,
      src,
      dst,
      journal,
      databases: { source: source.check.database, target: target.check.database },
      targetLabel: describeTarget(target.check),
      state,
    });
  } finally {
    await Promise.allSettled([src.end({ timeout: 5 }), dst.end({ timeout: 5 })]);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Refusal) {
    // Thrown before the target transaction (nothing written) or inside it (rolled back: nothing committed).
    console.error(`${SCRIPT}: REFUSED: ${error.message}`);
    process.exit(1);
  }
  console.error(`${SCRIPT}: FAILED: ${errorText(error)}`);
  console.error(
    state.phase === "committed"
      ? `${SCRIPT}: the copy had committed on the target before this error; run verify-target.`
      : state.phase === "committing"
        ? `${SCRIPT}: the target COMMIT may or may not have completed: run verify-target (all content tables empty = nothing was committed; run the copy again).`
        : `${SCRIPT}: nothing was committed on the target (the copy runs in one transaction).`,
  );
  process.exit(1);
});
