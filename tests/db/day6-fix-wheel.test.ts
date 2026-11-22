// Day 6 FIX against the local PostgreSQL:
//   SEC-1  the wheel's durable limits are counted on the caller's transaction (never on the shared pool
//          while a transaction holds a connection), and more concurrent spins and claims than a small
//          pool has connections all finish (the reviewer's pool deadlock);
//   COR-2  the hold end is frozen with the spin: lowering holdDays neither expires a held spin (the
//          stale-bound expiry and the daily purge) nor moves its date; older rows keep the old rule;
//   COR-1  a guest whose spin is bound at sign-up is "pending" (verify the e-mail), not "register";
//   SEC-3  the KVKK export lists the account's wheel spins and prize codes (no IP hash value);
//   COR-8  a video that is in use keeps its cover (removal refused); an unused one may lose it.
// Every write happens inside a transaction that is rolled back (users …@test.local with ids
// day6-test-fix-…, IP keys day6-test-fix-…); the id sequences those writes advance are put back and the
// touched tables are compared before and after.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-fix-wheel.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db, schema } from "@/db";
import { exportCustomerData } from "@/lib/b2b/customers";
import { isPanelError } from "@/lib/panel/errors";
import { updateMediaPoster } from "@/lib/panel/media/service";
import type { Tx } from "@/lib/panel/tx";
import { storedLimitKey } from "@/lib/rate-limit-store";
import { parseSettings } from "@/lib/settings/types";
import { consumeWheelSpinLimit, wheelClaimLimiter, wheelClaimLimitKey, wheelSpinLimitKey } from "@/lib/wheel/limits";
import { purgeWheelSpins } from "@/lib/wheel/maintenance";
import {
  bindSpinAtRegistration,
  claimSpinForAccount,
  createSpin,
  holdUntilOf,
  isSpinPendingVerification,
  resolveWheelVisitor,
  spinWheel,
  type WheelConfig,
} from "@/lib/wheel/service";

const RUN = randomBytes(3).toString("hex");
const ID = (tag: string) => `day6-test-fix-${tag}-${RUN}`;
const EMAIL = (tag: string) => `${ID(tag)}@test.local`;
const IP = (tag: string) => `day6-test-fix-${tag}-${RUN}`;
const DAY = 86_400_000;
const TEN = () => 35; // lands on slice 1 of the default slices ("indirim-10")

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>, executor: { transaction: typeof db.transaction } = db): Promise<void> {
  try {
    await executor.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
const SEQUENCES = ["coupons_id_seq", "wheel_spins_id_seq", "email_messages_id_seq", "media_id_seq", "product_media_id_seq"] as const;
const SNAPSHOT_TABLES = ["coupons", "wheel_spins", "settings", "rate_limit_counters", "media", "product_media", "email_messages"] as const;
const seqBefore = new Map<string, Seq>();
const tablesBefore = new Map<string, string>();
const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const tableHash = async (table: string): Promise<string> => {
  const [row] = await db.execute<{ h: string }>(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`));
  return row.h;
};

// A deliberately tiny pool (2 connections): the reviewer's deadlock needed pool-size concurrent spins.
const smallClient = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {}, prepare: !process.env.DATABASE_URL!.includes(":6543") });
const small = drizzle({ client: smallClient, schema, casing: "snake_case" });

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
});

after(async () => {
  try {
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
      }
      assert.deepEqual(await readSeq(name), seq, `${name} restored`);
    }
    for (const t of SNAPSHOT_TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
    const [own] = await db.execute<{ users: string }>(sql`select count(*)::text as users from "user" where id like ${"day6-test-fix-%"}`);
    assert.equal(own.users, "0", "no test users left");
  } finally {
    await smallClient.end();
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------
// Helpers

function wheelConfig(over: Partial<ReturnType<typeof parseSettings<"giftWheel">>> = {}): WheelConfig {
  const wheel = { ...parseSettings("giftWheel", { enabled: true }), enabled: true, round: 1, holdDays: 7, validityHours: 72, audience: "everyone" as const, startsAt: null, endsAt: null, ...over };
  return { wheel, heavySurcharge: false };
}

async function setWheelRow(tx: Tx, config: WheelConfig): Promise<void> {
  const value = config.wheel;
  await tx.insert(schema.settings).values({ key: "giftWheel", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

async function makeUser(tx: Tx, tag: string, over: Partial<typeof schema.user.$inferInsert> = {}): Promise<{ id: string; email: string }> {
  const id = ID(tag);
  const email = EMAIL(tag);
  await tx.insert(schema.user).values({ id, name: `Deniz ${tag}`, email, emailVerified: true, locale: "tr", ...over });
  return { id, email };
}

async function guestSpin(tx: Tx, config: WheelConfig, now: Date) {
  const r = await createSpin(tx, { config, account: null, locale: "tr", ipHash: null, pagePath: "/", now, randomInt: TEN });
  assert.ok(r.ok);
  return r.spin;
}

const counterRows = (executor: Tx, plainKey: string) =>
  executor.select({ count: schema.rateLimitCounters.count }).from(schema.rateLimitCounters).where(eq(schema.rateLimitCounters.key, storedLimitKey(plainKey)));

/** Rejects when `promise` takes longer than `ms` (a deadlocked pool never settles). */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: still waiting after ${ms} ms (pool deadlock?)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------------------------------

describe("SEC-1: limits on the transaction's own connection", () => {
  test("the claim limiter counts on the executor it is given (uncommitted, invisible to the shared pool)", async () => {
    const key = wheelClaimLimitKey(IP("claim"));
    await inRollback(async (tx) => {
      assert.equal(await wheelClaimLimiter(IP("claim"))(tx), true);
      assert.equal((await counterRows(tx, key)).length, 1, "counted inside the transaction");
      assert.equal((await counterRows(db as unknown as Tx, key)).length, 0, "not committed through another connection");
    }, small);
    assert.equal((await counterRows(db as unknown as Tx, key)).length, 0, "a rolled-back claim burns nothing");
  });

  test("the spin limit likewise", async () => {
    const key = wheelSpinLimitKey(IP("spin"));
    await inRollback(async (tx) => {
      assert.equal((await consumeWheelSpinLimit(tx, IP("spin"))).allowed, true);
      assert.equal((await counterRows(tx, key)).length, 1);
      assert.equal((await counterRows(db as unknown as Tx, key)).length, 0);
    }, small);
    assert.equal((await counterRows(db as unknown as Tx, key)).length, 0);
  });

  test("three concurrent guest spins on a two-connection pool all finish", async () => {
    const config = wheelConfig();
    const now = new Date();
    const results: string[] = [];
    const one = (n: number) =>
      inRollback(async (tx) => {
        const decision = await spinWheel(tx, { config, userId: null, cookieSpinId: null, ip: IP(`burst-${n}`), locale: "tr", pagePath: "/", now, randomInt: TEN });
        results.push(decision.kind);
      }, small);
    await within(Promise.all([one(1), one(2), one(3)]), 20_000, "3 spins on 2 connections");
    assert.deepEqual(results.sort(), ["spin", "spin", "spin"]);
  });

  test("three concurrent sign-in claims (bind + issue) on a two-connection pool all finish", async () => {
    const config = wheelConfig();
    const now = new Date();
    const outcomes: boolean[] = [];
    const one = (n: number) =>
      inRollback(async (tx) => {
        const user = await makeUser(tx, `claim-${n}`);
        const spin = await guestSpin(tx, config, now);
        const claim = await claimSpinForAccount(tx, { userId: user.id, cookieSpinId: spin.id, via: "sign_in", config, now, consumeClaimLimit: wheelClaimLimiter(IP(`claim-${n}`)) });
        outcomes.push(claim.ok);
      }, small);
    await within(Promise.all([one(1), one(2), one(3)]), 20_000, "3 claims on 2 connections");
    assert.deepEqual(outcomes, [true, true, true]);
  });
});

describe("COR-2: the hold end is frozen with the spin", () => {
  test("a new spin stores its hold end; the result screen's date comes from it", async () => {
    await inRollback(async (tx) => {
      const now = new Date("2026-11-09T03:15:00Z");
      const spin = await guestSpin(tx, wheelConfig({ holdDays: 7 }), now);
      assert.equal(spin.prize.holdUntil, "2026-11-16T03:15:00.000Z");
      assert.equal(holdUntilOf(spin, { holdDays: 2 }).toISOString(), "2026-11-16T03:15:00.000Z", "a lower holdDays later never moves it");
    });
  });

  test("lowering holdDays keeps a bound spin claimable at verification-time checks and through the purge", async () => {
    await inRollback(async (tx) => {
      const spunAt = new Date(Date.now() - 3 * DAY);
      const seven = wheelConfig({ holdDays: 7 });
      const frozen = await guestSpin(tx, seven, spunAt);
      // An older row without the frozen end (spun before the fix): it follows the current holdDays.
      const legacy = await guestSpin(tx, seven, spunAt);
      const { holdUntil: _drop, ...oldPrize } = legacy.prize;
      void _drop;
      await tx.update(schema.wheelSpins).set({ prize: oldPrize }).where(eq(schema.wheelSpins.id, legacy.id));

      const two = wheelConfig({ holdDays: 2 });
      await setWheelRow(tx, two);
      const visitor = await resolveWheelVisitor(tx, { config: two, userId: null, cookieSpinId: frozen.id, now: new Date(), commerce: undefined });
      assert.equal(visitor.held?.id, frozen.id, "still held although holdDays is now 2");

      const purge = await purgeWheelSpins(tx, { spinIds: [frozen.id, legacy.id] });
      assert.equal(purge.expired, 1, "only the legacy row expires");
      const [f] = await tx.select({ status: schema.wheelSpins.status }).from(schema.wheelSpins).where(eq(schema.wheelSpins.id, frozen.id));
      const [l] = await tx.select({ status: schema.wheelSpins.status }).from(schema.wheelSpins).where(eq(schema.wheelSpins.id, legacy.id));
      assert.equal(f.status, "spun");
      assert.equal(l.status, "expired");
    });
  });
});

describe("COR-1: a bound guest spin is pending verification", () => {
  test("after sign-up the visitor holds a bound spin: pending, not register", async () => {
    await inRollback(async (tx) => {
      const config = wheelConfig();
      await setWheelRow(tx, config);
      const now = new Date();
      const spin = await guestSpin(tx, config, now);
      assert.equal(isSpinPendingVerification(spin, false), false, "a fresh guest spin asks for sign-up");
      const user = await makeUser(tx, "pending", { emailVerified: false });
      assert.equal(await bindSpinAtRegistration(tx, { existedBefore: false, spinId: spin.id, userId: user.id, now }), "bound");
      const visitor = await resolveWheelVisitor(tx, { config, userId: null, cookieSpinId: spin.id, now });
      assert.equal(visitor.held?.status, "bound");
      assert.equal(isSpinPendingVerification(visitor.held!, Boolean(visitor.account)), true);
      assert.equal(isSpinPendingVerification(visitor.held!, true), false, "a signed-in account claims instead");
    });
  });
});

describe("SEC-3: the KVKK export lists the gift wheel", () => {
  test("spins (prize, status, dates, whether an IP hash is stored) and prize codes; never the hash itself", async () => {
    await inRollback(async (tx) => {
      const config = wheelConfig();
      const now = new Date();
      const user = await makeUser(tx, "export");
      const created = await createSpin(tx, { config, account: null, locale: "en", ipHash: "f".repeat(40), pagePath: "/urunler/lavanta", now, randomInt: TEN });
      assert.ok(created.ok);
      const claim = await claimSpinForAccount(tx, { userId: user.id, cookieSpinId: created.spin.id, via: "sign_in", config, now });
      assert.ok(claim.ok);
      const exported = (await exportCustomerData(tx, user.id)) as { giftWheel: { spins: Record<string, unknown>[]; prizes: Record<string, unknown>[] } };
      assert.equal(exported.giftWheel.spins.length, 1);
      const spin = exported.giftWheel.spins[0];
      assert.equal(spin.status, "claimed");
      assert.equal(spin.boundVia, "sign_in");
      assert.equal(spin.locale, "en");
      assert.equal(spin.pagePath, "/urunler/lavanta");
      assert.equal(spin.ipHashStored, true);
      assert.deepEqual(spin.prize, { label: created.spin.prize.label, type: "percent", value: 10, minOrderTotal: 0 });
      assert.equal(exported.giftWheel.prizes.length, 1);
      assert.equal(exported.giftWheel.prizes[0].code, claim.ok ? claim.issued.code : "");
      assert.equal(exported.giftWheel.prizes[0].used, false);
      assert.equal(exported.giftWheel.prizes[0].isActive, true);
      assert.ok(!JSON.stringify(exported).includes("f".repeat(40)), "the IP hash value is never exported");
    });
  });
});

describe("COR-8 / SEO-2: a video in use keeps its cover", () => {
  async function media(tx: Tx, tag: string, video: boolean, posterId: number | null = null): Promise<{ id: number; updatedAt: Date }> {
    const key = `day6-test-fix/${tag}-${RUN}.${video ? "mp4" : "webp"}`;
    const [row] = await tx
      .insert(schema.media)
      .values({
        storageKey: key,
        url: `/uploads/${key}`,
        mime: video ? "video/mp4" : "image/webp",
        kind: video ? "video" : "image",
        width: 1280,
        height: 720,
        bytes: 1000,
        variants: video ? null : [{ width: 1280, height: 720, format: "webp", key, bytes: 1000 }],
        folder: "day6-test-fix",
        durationMs: video ? 10_000 : null,
        posterId,
      })
      .returning({ id: schema.media.id, updatedAt: schema.media.updatedAt });
    return row;
  }

  test("removing the cover of a product video is refused; an unused video may lose it", async () => {
    await inRollback(async (tx) => {
      const cover = await media(tx, "cover", false);
      const used = await media(tx, "used", true, cover.id);
      const unused = await media(tx, "unused", true, cover.id);
      const [product] = await tx.select({ id: schema.products.id }).from(schema.products).limit(1);
      assert.ok(product, "a product to attach the video to");
      await tx.insert(schema.productMedia).values({ productId: product.id, mediaId: used.id, role: "gallery", position: 999 });

      await assert.rejects(
        updateMediaPoster(tx, { id: used.id, posterId: null, updatedAt: used.updatedAt }),
        (e: unknown) => isPanelError(e) && e.code === "in_use" && /kullanımda/.test(e.message) && /değiştirin/.test(e.message),
      );
      const replaced = await updateMediaPoster(tx, { id: used.id, posterId: cover.id, updatedAt: used.updatedAt });
      assert.equal(replaced.media.posterId, cover.id, "replacing stays possible");

      const removed = await updateMediaPoster(tx, { id: unused.id, posterId: null, updatedAt: unused.updatedAt });
      assert.equal(removed.media.posterId, null);
    });
  });
});
