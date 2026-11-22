// Go-live data path: which database URLs scripts/golive/* accept as target and source. Production is
// only the Supabase session pooler with ?sslmode=require; a local target only a prestij_golive_*
// rehearsal database; refusal reasons never repeat the password.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkSourceUrl, checkTargetUrl, describeTarget, journalTags, sameDatabase } from "../../scripts/golive/rules";

const SECRET = "S3cretPw9xQ";
const REF = "abcdefghijklmnopqrst";
const pooler = (rest = "?sslmode=require", { user = `postgres.${REF}`, password = SECRET, host = "aws-0-eu-central-1.pooler.supabase.com", port = "5432", db = "postgres" } = {}) =>
  `postgresql://${user}:${password}@${host}${port ? `:${port}` : ""}/${db}${rest}`;

function refused(url: string | undefined): string {
  const r = checkTargetUrl(url);
  assert.equal(r.ok, false, `expected a refusal for ${url}`);
  const reason = (r as { reason: string }).reason;
  assert.ok(!reason.includes(SECRET), "the reason must not contain the password");
  return reason;
}

describe("checkTargetUrl: production (Supabase session pooler)", () => {
  test("accepts the session pooler URI with exactly ?sslmode=require", () => {
    const r = checkTargetUrl(pooler());
    assert.deepEqual(r, { ok: true, kind: "production", host: "aws-0-eu-central-1.pooler.supabase.com", port: 5432, database: "postgres" });
    assert.equal(checkTargetUrl(pooler("?sslmode=require", { host: "aws-1-eu-central-1.pooler.supabase.com" })).ok, true);
    assert.equal(checkTargetUrl(`  ${pooler()}  `).ok, true, "surrounding spaces from a paste are trimmed");
    assert.equal(checkTargetUrl(pooler("?sslmode=require", { port: "" })).ok, true, "no port = 5432");
    assert.equal(checkTargetUrl(pooler().replace("postgresql://", "postgres://")).ok, true);
  });

  test("refuses a missing or different sslmode", () => {
    assert.match(refused(pooler("")), /sslmode=require/);
    assert.match(refused(pooler("?sslmode=no-verify")), /no-verify/);
    assert.match(refused(pooler("?sslmode=disable")), /sslmode=require/);
    assert.match(refused(pooler("?sslmode=verify-full")), /sslmode=require/);
    assert.match(refused(pooler("?sslmode=require&sslmode=require")), /sslmode=require/);
  });

  test("refuses extra parameters, the transaction pooler and other ports or databases", () => {
    assert.match(refused(pooler("?sslmode=require&pgbouncer=true")), /pgbouncer/);
    assert.match(refused(pooler("?sslmode=require", { port: "6543" })), /6543 is the transaction pooler/);
    assert.match(refused(pooler("?sslmode=require", { port: "5433" })), /5432/);
    assert.match(refused(pooler("?sslmode=require", { db: "prestij" })), /"postgres"/);
  });

  test("refuses a user without project ref and a missing or placeholder password", () => {
    assert.match(refused(pooler("?sslmode=require", { user: "postgres" })), /postgres\.<project ref>/);
    assert.match(refused(pooler("?sslmode=require", { password: "" })), /no database password/);
    assert.match(refused(`postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require`), /YOUR-PASSWORD/);
  });

  test("refuses the direct Supabase host and look-alike hosts", () => {
    assert.match(refused(`postgresql://postgres:${SECRET}@db.${REF}.supabase.co:5432/postgres?sslmode=require`), /IPv6-only/);
    refused(pooler("?sslmode=require", { host: "aws-0-eu-central-1.pooler.supabase.com.evil.example" }));
    refused(pooler("?sslmode=require", { host: "pooler.supabase.com" }));
    refused(pooler("?sslmode=require", { host: "db.example.com" }));
  });
});

describe("checkTargetUrl: local rehearsal and everything else", () => {
  test("accepts only prestij_golive_* databases on 127.0.0.1 or localhost", () => {
    assert.deepEqual(checkTargetUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_rehearsal1"), {
      ok: true,
      kind: "rehearsal",
      host: "127.0.0.1",
      port: 54329,
      database: "prestij_golive_rehearsal1",
    });
    assert.equal(checkTargetUrl("postgres://postgres:postgres@localhost:54329/prestij_golive_x").ok, true);
  });

  test("never accepts the owner's database, its backups or odd names", () => {
    for (const db of ["prestij", "prestij_backup_day6_start", "postgres", "prestij_golive_", "prestij_golive_UPPER", "prestij_golive_a-b"]) {
      assert.match(refused(`postgres://postgres:${SECRET}@127.0.0.1:54329/${db}`), /rehearsal database/);
    }
  });

  test("refuses missing values, other schemes and other hosts", () => {
    assert.match(refused(undefined), /not set/);
    assert.match(refused("   "), /not set/);
    assert.match(refused("not a url"), /not a valid URL/);
    assert.match(refused(`mysql://root:${SECRET}@127.0.0.1/prestij_golive_x`), /postgresql:\/\//);
    assert.match(refused(`postgres://postgres:${SECRET}@10.0.0.5:5432/prestij_golive_x`), /only \*\.pooler\.supabase\.com/);
  });

  test("describeTarget shows neither user nor password", () => {
    const text = describeTarget(checkTargetUrl(pooler()));
    assert.equal(text, "production aws-0-eu-central-1.pooler.supabase.com:5432/postgres");
    assert.ok(!text.includes(REF) && !text.includes(SECRET));
  });
});

describe("checkSourceUrl and sameDatabase", () => {
  test("the source is a local, non-rehearsal database", () => {
    assert.equal(checkSourceUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij").ok, true);
    assert.equal(checkSourceUrl(pooler()).ok, false);
    assert.equal(checkSourceUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_x").ok, false);
  });

  test("127.0.0.1 and localhost are the same server", () => {
    const a = checkSourceUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_x".replace("prestij_golive_x", "prestij"));
    const b = checkSourceUrl("postgres://postgres:postgres@localhost:54329/prestij");
    assert.equal(sameDatabase(a, b), true);
    assert.equal(sameDatabase(a, checkTargetUrl("postgres://postgres:postgres@localhost:54329/prestij_golive_x")), false);
  });
});

describe("journalTags", () => {
  test("reads the migration tags in order and rejects an empty journal", () => {
    assert.deepEqual(journalTags({ entries: [{ tag: "0000_init" }, { tag: "0001_next" }] }), ["0000_init", "0001_next"]);
    assert.throws(() => journalTags({ entries: [] }), /no entries/);
    assert.throws(() => journalTags({ entries: [{}] }), /no tag/);
  });
});

// Go-live FINAL (GD-1): postgres.js takes host/port from URL parameters and puts every other unknown key
// (database, user, options, …) into the startup packet after the path's database, so a parameter could
// redirect a "rehearsal" connection to the owner's database. Local URLs carry no parameter at all.
describe("GD-1: no URL parameter can redirect a local connection", () => {
  const REDIRECTS = ["?database=prestij", "?database=postgres", "?host=127.0.0.2", "?port=54329&database=postgres", "?user=someone", "?options=-c%20search_path%3Dx", "?sslmode=disable&database=prestij", "?application_name=x"];

  test("a rehearsal TARGET with any parameter is refused, naming the parameter", () => {
    for (const q of REDIRECTS) {
      const reason = refused(`postgres://postgres:${SECRET}@127.0.0.1:54329/prestij_golive_x${q}`);
      assert.match(reason, /must not carry URL parameters/, q);
    }
    assert.match(refused(`postgres://postgres:${SECRET}@localhost:1/prestij_golive_x?port=54329&database=postgres`), /\(port, database\)/);
  });

  test("a single sslmode=disable is harmless and stays allowed", () => {
    assert.equal(checkTargetUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_x?sslmode=disable").ok, true);
  });

  test("SOURCE_DATABASE_URL with any parameter is refused", () => {
    for (const q of REDIRECTS) {
      const r = checkSourceUrl(`postgres://postgres:postgres@127.0.0.1:54329/prestij${q}`);
      assert.equal(r.ok, false, q);
      assert.match((r as { reason: string }).reason, /SOURCE_DATABASE_URL must not carry URL parameters/, q);
    }
    assert.equal(checkSourceUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij").ok, true);
  });

  test("sameDatabase can no longer be fooled: the redirecting target is refused before the comparison", () => {
    const target = checkTargetUrl("postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_x?database=prestij");
    assert.equal(target.ok, false);
  });
});

// GD-5: Supabase's Connect dialog shows ":[YOUR-PASSWORD]@"; replacing only the text inside the brackets leaves
// them in the password, which then fails with "password authentication failed".
describe("GD-5: a password left inside the [ ] placeholder brackets", () => {
  test("is refused with a hint, without echoing it", () => {
    const reason = refused(pooler("?sslmode=require", { password: `[${SECRET}]` }));
    assert.match(reason, /remove the square brackets/);
    assert.match(refused(pooler("?sslmode=require", { password: encodeURIComponent(`[${SECRET}]`) })), /square brackets/, "also when URL-encoded");
  });

  test("a password that merely contains a bracket is still accepted", () => {
    assert.equal(checkTargetUrl(pooler("?sslmode=require", { password: `${SECRET}%5D` })).ok, true);
  });
});
