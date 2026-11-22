// Local development database: a real PostgreSQL 17 (same major version as Supabase)
// that runs without Docker.
//
//   npm run db        start the database (safe to run again; it exits once the server is up)
//   npm run db:stop   stop it
//
// The PostgreSQL programs come from the "embedded-postgres" dev dependency. Windows cannot run
// them from very long folder paths, so they are copied once to a short folder:
//   Windows: %LOCALAPPDATA%\prestij-pg      other systems: ~/.prestij-pg
// The database files live there too (in "data"). Delete that folder to start from scratch;
// `npm run db:setup` rebuilds tables and sample data.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const DB_NAME = "prestij";
const isWin = process.platform === "win32";
const exe = (name) => (isWin ? `${name}.exe` : name);

const base = isWin
  ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "prestij-pg")
  : path.join(os.homedir(), ".prestij-pg");
const binRoot = path.join(base, "pg17");
const bin = path.join(binRoot, "bin");
const dataDir = path.join(base, "data");
const logFile = path.join(base, "postgres.log");

function run(cmd, args, { allowFail = false, detached = false } = {}) {
  // pg_ctl start leaves postgres running; it must not inherit our pipes or we would wait forever.
  const r = spawnSync(path.join(bin, exe(cmd)), args, detached ? { stdio: "ignore" } : { encoding: "utf8" });
  if (r.status !== 0 && !allowFail) {
    console.error(r.stdout, r.stderr);
    throw new Error(`${cmd} failed (exit ${r.status})`);
  }
  return r;
}

function ensureBinaries() {
  if (existsSync(path.join(bin, exe("postgres")))) return;
  const pkg = `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const src = path.join(path.dirname(require.resolve("embedded-postgres")), "..", "..", pkg, "native");
  if (!existsSync(src)) throw new Error(`PostgreSQL programs not found at ${src}. Run npm install.`);
  console.log(`[db] Copying PostgreSQL programs to ${binRoot} (first run only)...`);
  mkdirSync(base, { recursive: true });
  cpSync(src, binRoot, { recursive: true });
}

function ensureCluster() {
  if (existsSync(path.join(dataDir, "PG_VERSION"))) return;
  console.log("[db] Creating database files (first run only)...");
  run("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"]);
}

function isRunning() {
  return run("pg_ctl", ["-D", dataDir, "status"], { allowFail: true }).status === 0;
}

async function ensureDatabase() {
  const sql = postgres({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres", max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select 1 from pg_database where datname = ${DB_NAME}`;
    if (rows.length === 0) {
      await sql.unsafe(`create database "${DB_NAME}"`);
      console.log(`[db] Created database "${DB_NAME}"`);
    }
  } finally {
    await sql.end();
  }
}

const command = process.argv[2] ?? "start";

if (command === "stop") {
  if (existsSync(dataDir) && isRunning()) {
    run("pg_ctl", ["-D", dataDir, "stop", "-m", "fast"]);
    console.log("[db] Stopped.");
  } else {
    console.log("[db] Not running.");
  }
} else {
  ensureBinaries();
  ensureCluster();
  if (!isRunning()) {
    run("pg_ctl", ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -h 127.0.0.1`, "-w", "start"], { detached: true });
    if (!isRunning()) throw new Error(`PostgreSQL did not start. See ${logFile}`);
  }
  await ensureDatabase();
  console.log(`[db] Ready: postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`);
}
