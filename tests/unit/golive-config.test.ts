// Go-live code fixes, pure parts: the NEXT_PUBLIC_SITE_URL build guard (CF-5), the card page CSP (CF-3), the
// outbox driver on Vercel (CF-6), the DB tests' local-only guard (CF-8), the DB connection options (CF-15),
// and the repository files that go to Vercel and Git (CF-1 .env.example, CF-2 vercel.json, CF-7).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { IDLE_TIMEOUT_SECONDS, isSupabaseHost, sslOptionFor } from "@/db/connection-options";
import { isLocalHostname, productionSiteUrlError, publicSiteUrlProblem, SITE_URL_PROBLEM_TEXT } from "@/lib/deploy/site-url";
import { emailDriverStatus, getEmailDriver } from "@/lib/email/drivers";
import { cardPageCsp, cardPageHeaders, localPaymentMockAllowedIn, paytrFrameOriginFrom, PAYTR_DEFAULT_FRAME_ORIGIN } from "@/lib/security/card-page-csp";
import { localDatabaseProblem } from "../db/setup/local-db";

describe("CF-5: NEXT_PUBLIC_SITE_URL", () => {
  test("a live address is https:// on a public host", () => {
    assert.equal(publicSiteUrlProblem("https://www.prestij.com.tr"), null);
    assert.equal(publicSiteUrlProblem(" https://prestij.com.tr/ "), null);
    assert.equal(publicSiteUrlProblem(""), "missing");
    assert.equal(publicSiteUrlProblem(undefined), "missing");
    assert.equal(publicSiteUrlProblem("www.prestij.com.tr"), "invalid");
    assert.equal(publicSiteUrlProblem("http://www.prestij.com.tr"), "not_https");
    for (const local of ["https://localhost:3000", "https://shop.localhost", "https://127.0.0.1", "https://127.1.2.3", "https://[::1]:3000", "https://0.0.0.0"]) {
      assert.equal(publicSiteUrlProblem(local), "local", local);
    }
    assert.equal(isLocalHostname("check.localhost."), true);
    assert.equal(isLocalHostname("localhost-shop.com"), false);
    for (const problem of ["missing", "invalid", "not_https", "local"] as const) assert.ok(SITE_URL_PROBLEM_TEXT[problem]);
  });

  test("the build fails only on Vercel production with a missing, non-https or local address", () => {
    assert.equal(productionSiteUrlError({}), null, "local builds never fail");
    assert.equal(productionSiteUrlError({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }), null);
    assert.equal(productionSiteUrlError({ VERCEL_ENV: "preview" }), null, "previews may build without the live address");
    assert.equal(productionSiteUrlError({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.com.tr" }), null);
    assert.match(productionSiteUrlError({ VERCEL_ENV: "production" }) ?? "", /NEXT_PUBLIC_SITE_URL .*it is not set/);
    assert.match(productionSiteUrlError({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://www.prestij.com.tr" }) ?? "", /https:\/\//);
    assert.match(productionSiteUrlError({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://localhost:3000" }) ?? "", /local host/);
  });

  test("next.config.ts applies the guard and the card page header builder", () => {
    const config = readFileSync("next.config.ts", "utf8");
    assert.match(config, /from "\.\/src\/lib\/deploy\/site-url"/);
    assert.match(config, /const siteUrlError = productionSiteUrlError\(process\.env\);\s*if \(siteUrlError\) throw new Error\(siteUrlError\);/);
    assert.match(config, /const CARD_PAGE_HEADERS = cardPageHeaders\(process\.env\);/);
  });
});

describe("CF-3: card page CSP", () => {
  test("frames PayTR, our own return page and the bank's 3-D Secure page; framed only by itself and PayTR (PayTR-fix C7)", () => {
    assert.equal(cardPageCsp("https://www.paytr.com"), "frame-ancestors 'self' https://www.paytr.com; frame-src 'self' https://www.paytr.com https:");
    const headers = cardPageHeaders({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.com.tr" });
    assert.deepEqual(headers, [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://www.paytr.com; frame-src 'self' https://www.paytr.com https:" },
    ]);
  });

  test("PAYTR_BASE_URL: https anywhere, the local mock only where it is allowed", () => {
    assert.equal(paytrFrameOriginFrom({}), PAYTR_DEFAULT_FRAME_ORIGIN);
    assert.equal(paytrFrameOriginFrom({ PAYTR_BASE_URL: "https://sandbox.example.com/x" }), "https://sandbox.example.com");
    assert.equal(paytrFrameOriginFrom({ PAYTR_BASE_URL: "http://127.0.0.1:4411" }), "http://127.0.0.1:4411", "development");
    const live = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.prestij.com.tr", PAYTR_BASE_URL: "http://127.0.0.1:4411" };
    assert.equal(localPaymentMockAllowedIn(live), false);
    assert.equal(paytrFrameOriginFrom(live), PAYTR_DEFAULT_FRAME_ORIGIN, "a live site never frames a local mock");
    const check = { ...live, NEXT_PUBLIC_SITE_URL: "http://check.localhost:3470" };
    assert.equal(localPaymentMockAllowedIn(check), true);
    assert.equal(paytrFrameOriginFrom(check), "http://127.0.0.1:4411");
    assert.equal(paytrFrameOriginFrom({ PAYTR_BASE_URL: "not a url" }), PAYTR_DEFAULT_FRAME_ORIGIN);
  });
});

describe("CF-6: the outbox driver on Vercel", () => {
  test("reported not ready (read-only disk), so mails stay queued with a clear reason", () => {
    const status = emailDriverStatus({ EMAIL_DRIVER: "outbox", VERCEL: "1", NODE_ENV: "production" });
    assert.equal(status.driver, "outbox");
    assert.equal(status.ready, false);
    assert.equal(status.problem, "EMAIL_DRIVER=outbox Vercel'da çalışmaz (salt okunur disk). EMAIL_DRIVER=smtp kullanın.");
    assert.equal(getEmailDriver({ EMAIL_DRIVER: "outbox", VERCEL: "1" }), null);
  });

  test("unchanged elsewhere: outbox ready locally, smtp ready on Vercel", () => {
    assert.equal(emailDriverStatus({ EMAIL_DRIVER: "outbox" }).ready, true);
    assert.equal(emailDriverStatus({}).ready, true, "outbox is the default outside production");
    assert.equal(emailDriverStatus({ NODE_ENV: "production", VERCEL: "1" }).driver, "none");
    const smtp = emailDriverStatus({ EMAIL_DRIVER: "smtp", EMAIL_SMTP_URL: "smtps://u:p@smtp.example.com:465", EMAIL_FROM: "siparis@example.com", VERCEL: "1" });
    assert.equal(smtp.ready, true);
    assert.equal(smtp.problem, null);
  });
});

describe("CF-8: the DB tests run only against a local database", () => {
  test("localhost and 127.0.0.1 pass; anything else is refused without echoing credentials", () => {
    assert.equal(localDatabaseProblem("postgres://postgres:postgres@localhost:54329/prestij"), null);
    assert.equal(localDatabaseProblem("postgresql://postgres:x@127.0.0.1:54329/prestij_golive_test"), null);
    assert.equal(localDatabaseProblem("postgres://u@[::1]:5432/db"), null);
    const remote = localDatabaseProblem("postgresql://postgres.abc:SECRET@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require");
    assert.match(remote ?? "", /aws-0-eu-central-1\.pooler\.supabase\.com/);
    assert.doesNotMatch(remote ?? "", /SECRET|postgres\.abc|sslmode/);
    assert.match(localDatabaseProblem("postgres://x@db.example.supabase.co/x") ?? "", /not a local database/);
    assert.match(localDatabaseProblem(undefined) ?? "", /not set/);
    assert.match(localDatabaseProblem("::::") ?? "", /not a valid/);
  });

  test("npm run test:db checks it once up front and loads it in every test process", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["test:db"], /^tsx --env-file=\.env\.local tests\/db\/setup\/local-only\.ts && /);
    assert.match(pkg.scripts["test:db"], /--import \.\/tests\/db\/setup\/local-only\.ts "tests\/db\/\*\*\/\*\.test\.ts"$/);
  });

  test("every tests/db/*.test.ts imports the guard first, so a single file run directly is guarded too", () => {
    const files = readdirSync("tests/db").filter((f) => f.endsWith(".test.ts"));
    assert.ok(files.length >= 40, `found ${files.length} DB test files`);
    for (const f of files) {
      const firstImport = readFileSync(`tests/db/${f}`, "utf8")
        .split("\n")
        .find((line) => /^import\b/.test(line));
      assert.equal(firstImport, 'import "./setup/local-only";', `${f}: the first import must be ./setup/local-only`);
    }
  });

  test("the documented single-file command loads the guard as well", () => {
    const doc = readFileSync("docs/DAY3-CORE-API.md", "utf8");
    assert.ok(
      doc.includes("npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/<yours>.test.ts"),
      "docs/DAY3-CORE-API.md single-file command",
    );
  });
});

describe("CF-15: postgres connection options", () => {
  test("idle connections close after 20 s", () => {
    assert.equal(IDLE_TIMEOUT_SECONDS, 20);
    const source = readFileSync("src/db/index.ts", "utf8");
    assert.match(source, /idle_timeout: IDLE_TIMEOUT_SECONDS/);
    assert.match(source, /\.\.\.sslOptionFor\(url, process\.env\)/);
  });

  test("TLS required for Supabase hosts unless the URL (or PGSSLMODE) says otherwise", () => {
    assert.deepEqual(sslOptionFor("postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"), { ssl: "require" });
    assert.deepEqual(sslOptionFor("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres"), { ssl: "require" });
    assert.deepEqual(sslOptionFor("postgresql://p:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"), {});
    assert.deepEqual(sslOptionFor("postgresql://p:pw@x.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/ca.crt"), {});
    assert.deepEqual(sslOptionFor("postgresql://p:pw@x.pooler.supabase.com:5432/postgres?ssl=true"), {});
    assert.deepEqual(sslOptionFor("postgresql://p:pw@x.pooler.supabase.com:5432/postgres", { PGSSLMODE: "verify-full" }), {});
    assert.deepEqual(sslOptionFor("postgres://postgres:postgres@localhost:54329/prestij"), {});
    assert.deepEqual(sslOptionFor("postgres://u:p@supabase.com.evil.example/x"), {});
    assert.deepEqual(sslOptionFor("not a url"), {});
    assert.equal(isSupabaseHost("AWS-0-EU-CENTRAL-1.POOLER.SUPABASE.COM"), true);
    assert.equal(isSupabaseHost("notsupabase.co"), false);
  });
});

describe("repository files for Vercel and Git", () => {
  test("CF-2: vercel.json runs the functions in Frankfurt and keeps both crons daily", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions: string[]; crons: { path: string; schedule: string }[] };
    assert.deepEqual(vercel.regions, ["fra1"]);
    assert.deepEqual(vercel.crons, [
      { path: "/api/cron/frequent", schedule: "0 3 * * *" },
      { path: "/api/cron/daily", schedule: "30 3 * * *" },
    ]);
    assert.match(readFileSync("docs/DAY6-CORE-API.md", "utf8"), /\*\/5 \* \* \* \*/, "the doc says how to switch frequent on Pro");
  });

  test("CF-1 / CF-7: .env.example never turns the simulator on and lists INDEXNOW_KEY", () => {
    const example = readFileSync(".env.example", "utf8");
    assert.match(example, /^PAYMENT_SIMULATOR=$/m);
    assert.match(example, /local only/i);
    assert.match(example, /^INDEXNOW_KEY=$/m);
  });

  test("CF-7: .gitignore keeps the client's sources, local storage and env files out of Git", () => {
    const lines = readFileSync(".gitignore", "utf8").split(/\r?\n/);
    for (const rule of ["/kaynak/", "/storage/", ".env*", "!.env.example", "/.next/"]) assert.ok(lines.includes(rule), rule);
  });

  test("CF-7: no doc promises the never-written pg_cron guide; Node 26.x for Vercel", () => {
    for (const file of ["README.md", "docs/DAY4-COMMERCE.md", "docs/DAY4-CORE-API.md"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /pg_cron/, file);
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: string } };
    assert.equal(pkg.engines?.node, "26.x");
  });
});
