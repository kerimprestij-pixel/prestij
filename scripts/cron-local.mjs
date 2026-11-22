#!/usr/bin/env node
/**
 * Calls the scheduled-job groups of a running PRESTİJ server on an interval, like Vercel Cron /
 * Supabase pg_cron would in production. For local testing only.
 *
 *   node scripts/cron-local.mjs                       # frequent every 5 min, daily every 24 h (both once at start)
 *   node scripts/cron-local.mjs --once                # both groups once, then exit (non-zero on failure)
 *   node scripts/cron-local.mjs --once --group daily  # one group once
 *   node scripts/cron-local.mjs --base http://myname.localhost:3400 --frequent-minutes 1
 *
 * Reads CRON_SECRET and the base URL (BETTER_AUTH_URL, else NEXT_PUBLIC_SITE_URL) from the environment
 * or .env.local. Sends `Authorization: Bearer <CRON_SECRET>` (never printed). Output: statuses and
 * counts per job only.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env.local");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile); // does not override variables that are already set
  } catch {
    // ignore: the environment may already be complete
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const GROUPS = ["frequent", "daily"];
const once = process.argv.includes("--once");
const onlyGroup = arg("--group");
const base = (arg("--base") || process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
const frequentMinutes = Number(arg("--frequent-minutes") ?? 5);
const secret = process.env.CRON_SECRET ?? "";

function fail(message) {
  console.error(`cron-local: ${message}`);
  process.exit(1);
}

if (onlyGroup && !GROUPS.includes(onlyGroup)) fail(`--group must be one of ${GROUPS.join(", ")}.`);
if (!base || !/^https?:\/\//.test(base)) fail("no base URL: pass --base http://localhost:<port> or set BETTER_AUTH_URL.");
if (secret.length < 16) fail("CRON_SECRET is missing or shorter than 16 characters (set it in .env.local).");
if (!Number.isFinite(frequentMinutes) || frequentMinutes < 1) fail("--frequent-minutes must be at least 1.");

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

async function call(group) {
  try {
    const res = await fetch(`${base}/api/cron/${group}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // not JSON (e.g. a 404 page): status only
    }
    const jobs = body?.jobs
      ? Object.entries(body.jobs)
          .map(([key, j]) => `${key}=${j.status}${j.result && Object.keys(j.result).length ? ` ${JSON.stringify(j.result)}` : ""}`)
          .join(", ")
      : "";
    console.log(`[${stamp()}] ${group}: HTTP ${res.status}${jobs ? ` · ${jobs}` : ""}`);
    return res.ok;
  } catch (error) {
    console.log(`[${stamp()}] ${group}: request failed (${error instanceof Error ? error.name : "error"})`);
    return false;
  }
}

const groups = onlyGroup ? [onlyGroup] : GROUPS;

if (once) {
  let ok = true;
  for (const group of groups) ok = (await call(group)) && ok;
  process.exit(ok ? 0 : 1);
}

console.log(`cron-local: ${base} · frequent every ${frequentMinutes} min, daily every 24 h (Ctrl+C to stop)`);
for (const group of groups) await call(group);
if (groups.includes("frequent")) setInterval(() => void call("frequent"), frequentMinutes * 60_000);
if (groups.includes("daily")) setInterval(() => void call("daily"), 24 * 60 * 60_000);
