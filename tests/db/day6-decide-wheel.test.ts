// Day 6 follow-up decisions against the local PostgreSQL:
//   D13  the wheel's per-IP spin limit is 3 per 24 h; IPv6 addresses count by their /64 prefix (one
//        counter for every address inside it), IPv4-mapped IPv6 counts as the IPv4 address, another /64
//        has its own counter; the claim limit key follows the same rule;
//   D15  the /hesap loader (queryAccountHeldSpin) finds the account's held, bound spin by the account
//        alone (no cookie), during the campaign and after its end within the hold, and only while the
//        wheel is on and the account may still take part; claimSpinForAccount (claimWheel) claims that
//        very spin without a cookie (another device), and afterwards the card's prize query shows the code.
// Every write happens inside a transaction that is rolled back (users …@test.local with ids
// day6-test-decide-…, IPs in the documentation ranges 2001:db8::/32 and 192.0.2.0/24 with a per-run part);
// the id sequences those writes advance are put back and the touched tables compared before and after.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-decide-wheel.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { queryAccountWheelPrize } from "@/lib/data/wheel";
import { queryAccountHeldSpin } from "@/lib/data/wheel-held";
import type { Tx } from "@/lib/panel/tx";
import { storedLimitKey } from "@/lib/rate-limit-store";
import { parseSettings } from "@/lib/settings/types";
import { consumeWheelSpinLimit, wheelClaimLimiter, wheelClaimLimitKey, wheelSpinLimitKey } from "@/lib/wheel/limits";
import { bindSpin, claimSpinForAccount, createSpin, findAccountHeldSpin, spinWheel, type WheelConfig } from "@/lib/wheel/service";
import { WHEEL_RATE_LIMITS } from "@/lib/wheel/types";

const RUN = randomBytes(3).toString("hex");
const RUN_HEXTET = String(parseInt(RUN.slice(0, 4), 16).toString(16)); // one IPv6 group unique to this run
const RUN_OCTET = 1 + (parseInt(RUN.slice(4, 6), 16) % 250);
const ID = (tag: string) => `day6-test-decide-${tag}-${RUN}`;
const EMAIL = (tag: string) => `${ID(tag)}@test.local`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TEN = () => 35; // lands on slice 1 of the default slices ("indirim-10")

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
const SEQUENCES = ["coupons_id_seq", "wheel_spins_id_seq", "email_messages_id_seq", "orders_id_seq"] as const;
const SNAPSHOT_TABLES = ["coupons", "wheel_spins", "settings", "rate_limit_counters", "email_messages", "orders", "user"] as const;
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
    const [own] = await db.execute<{ users: string }>(sql`select count(*)::text as users from "user" where id like ${"day6-test-decide-%"}`);
    assert.equal(own.users, "0", "no test users left");
  } finally {
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

/** A spin of a signed-in account: bound at once (bound_via "signed_in"), exactly like the spin route stores it. */
async function signedInSpin(tx: Tx, config: WheelConfig, userId: string, now: Date) {
  const r = await createSpin(tx, { config, account: { id: userId }, locale: "tr", ipHash: null, pagePath: "/", now, randomInt: TEN });
  assert.ok(r.ok);
  return r.spin;
}

const counterTotal = async (tx: Tx, plainKey: string): Promise<number> => {
  const rows = await tx.select({ count: schema.rateLimitCounters.count }).from(schema.rateLimitCounters).where(eq(schema.rateLimitCounters.key, storedLimitKey(plainKey)));
  return rows.reduce((sum, r) => sum + r.count, 0);
};

/** Addresses of this run: an IPv6 /64 (2001:db8:<run>:<n>::/64) and an IPv4 address in 192.0.2.0/24. */
const v6 = (net: number, host: string) => `2001:db8:${RUN_HEXTET}:${net.toString(16)}:${host}`;
const v4 = `192.0.2.${RUN_OCTET}`;

// ---------------------------------------------------------------------------------------------------

describe("D13: the wheel's per-IP limits", () => {
  test("3 spins per 24 h; a fourth from the same address is refused", async () => {
    assert.equal(WHEEL_RATE_LIMITS.spinsPerIp.limit, 3);
    assert.equal(WHEEL_RATE_LIMITS.spinsPerIp.windowMs, DAY);
    assert.equal(WHEEL_RATE_LIMITS.claimsPerIp.limit, 3, "the claim limit stays 3");
    await inRollback(async (tx) => {
      for (let i = 0; i < 3; i++) assert.equal((await consumeWheelSpinLimit(tx, v4)).allowed, true, `spin ${i + 1}`);
      const fourth = await consumeWheelSpinLimit(tx, v4);
      assert.equal(fourth.allowed, false);
      assert.ok(fourth.retryAfterMinutes > 0);
    });
  });

  test("every address of one IPv6 /64 shares one counter; another /64 has its own", async () => {
    await inRollback(async (tx) => {
      const sameNet = [v6(1, ":a"), v6(1, "ffff:ffff:ffff:fffe"), `[${v6(1, ":3")}]:443`];
      for (const ip of sameNet) assert.equal((await consumeWheelSpinLimit(tx, ip)).allowed, true, ip);
      assert.equal((await consumeWheelSpinLimit(tx, v6(1, "1234:5678:9abc:def0"))).allowed, false, "a fourth address in the same /64");
      assert.equal(wheelSpinLimitKey(v6(1, ":a")), `wheel:ip:2001:db8:${RUN_HEXTET}:1::/64`);
      assert.equal(await counterTotal(tx, wheelSpinLimitKey(v6(1, ":99"))), 3, "stored under the /64 key");
      assert.equal((await consumeWheelSpinLimit(tx, v6(2, ":a"))).allowed, true, "the next /64 is a different connection");
    });
  });

  test("an IPv4-mapped IPv6 address counts as the IPv4 address (spins and claims)", async () => {
    await inRollback(async (tx) => {
      assert.equal((await consumeWheelSpinLimit(tx, v4)).allowed, true);
      assert.equal((await consumeWheelSpinLimit(tx, `::ffff:${v4}`)).allowed, true);
      assert.equal((await consumeWheelSpinLimit(tx, `::FFFF:${v4}`)).allowed, true);
      assert.equal((await consumeWheelSpinLimit(tx, v4)).allowed, false, "three spins counted on one key");
      assert.equal(wheelClaimLimitKey(`::ffff:${v4}`), `wheel-claim:ip:${v4}`);
      for (let i = 0; i < 3; i++) assert.equal(await wheelClaimLimiter(i % 2 ? v4 : `::ffff:${v4}`)(tx), true);
      assert.equal(await wheelClaimLimiter(v4)(tx), false, "claims share the key too");
    });
  });

  test("spinWheel refuses the fourth guest of one /64 with spin_limit", async () => {
    await inRollback(async (tx) => {
      const config = wheelConfig();
      const now = new Date();
      const kinds: string[] = [];
      for (const host of [":1", ":2", ":3", ":4"]) {
        const decision = await spinWheel(tx, { config, userId: null, cookieSpinId: null, ip: v6(7, host), locale: "tr", pagePath: "/", now, randomInt: TEN });
        kinds.push(decision.kind === "refused" ? decision.error : decision.kind);
      }
      assert.deepEqual(kinds, ["spin", "spin", "spin", "spin_limit"]);
    });
  });
});

describe("D15: the held spin on /hesap and the account-based claim", () => {
  test("the loader finds the account's bound spin without a cookie, with its frozen hold end and the conditions' inputs", async () => {
    await inRollback(async (tx) => {
      const config = wheelConfig({ validityHours: 96, texts: { claimCta: { tr: "Kodumu ver" } } });
      await setWheelRow(tx, config);
      const now = new Date();
      const user = await makeUser(tx, "held");
      const spin = await signedInSpin(tx, config, user.id, new Date(now.getTime() - HOUR));
      const held = await queryAccountHeldSpin(tx, user.id, now);
      assert.ok(held, "found by the account alone");
      assert.equal(held.spinId, spin.id);
      assert.equal(held.holdUntil, spin.prize.holdUntil, "the frozen hold end");
      assert.equal(held.prize.type, "percent");
      assert.equal(held.prize.value, 10);
      assert.equal(held.validityHours, 96);
      assert.deepEqual(held.claimCta, { tr: "Kodumu ver" });
      assert.equal(await queryAccountHeldSpin(tx, ID("nobody"), now), null, "nothing for another account");
    });
  });

  test("shown after the campaign end within the hold; not after the hold, not when the wheel is off", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      const live = wheelConfig();
      await setWheelRow(tx, live);
      const user = await makeUser(tx, "ended");
      const spin = await signedInSpin(tx, live, user.id, new Date(now.getTime() - 2 * DAY));
      const ended = wheelConfig({ startsAt: new Date(now.getTime() - 10 * DAY).toISOString(), endsAt: new Date(now.getTime() - DAY).toISOString() });
      await setWheelRow(tx, ended);
      assert.equal((await queryAccountHeldSpin(tx, user.id, now))?.spinId, spin.id, "the campaign ended a day ago, the hold runs 5 more days");
      assert.equal(await queryAccountHeldSpin(tx, user.id, new Date(now.getTime() + 6 * DAY)), null, "after the frozen hold end");
      await setWheelRow(tx, wheelConfig({ enabled: false }));
      assert.equal(await queryAccountHeldSpin(tx, user.id, now), null, "switching the wheel off stops everything (D8)");
    });
  });

  test("the account must still be eligible by the claim rules (ordered since, staff, banned)", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      const config = wheelConfig({ audience: "new_customers" });
      await setWheelRow(tx, config);
      const ordered = await makeUser(tx, "ordered");
      await signedInSpin(tx, config, ordered.id, now);
      assert.ok(await queryAccountHeldSpin(tx, ordered.id, now), "eligible before the order");
      await tx.insert(schema.orders).values({
        orderNumber: `DAY6TEST-DECIDE-${RUN}`.toUpperCase(),
        email: ordered.email,
        userId: ordered.id,
        status: "paid",
        paymentMethod: "bank_transfer",
        subtotal: 10000,
        grandTotal: 10000,
        shippingAddress: { fullName: "Deniz Test", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test 1" },
        invoice: { type: "individual" },
      });
      assert.equal(await queryAccountHeldSpin(tx, ordered.id, now), null, "audience new_customers and a counted order since");
      assert.equal((await claimSpinForAccount(tx, { userId: ordered.id, cookieSpinId: null, via: "signed_in", config, now })).ok, false, "the claim agrees");

      const staff = await makeUser(tx, "staff");
      await signedInSpin(tx, config, staff.id, now);
      await tx.update(schema.user).set({ role: "editor" }).where(eq(schema.user.id, staff.id));
      assert.equal(await queryAccountHeldSpin(tx, staff.id, now), null, "staff");

      const banned = await makeUser(tx, "banned");
      await signedInSpin(tx, config, banned.id, now);
      await tx.update(schema.user).set({ banned: true }).where(eq(schema.user.id, banned.id));
      assert.equal(await queryAccountHeldSpin(tx, banned.id, now), null, "banned");
    });
  });

  test("an unbound guest spin is not the account's; a claimed spin is no longer held", async () => {
    await inRollback(async (tx) => {
      const config = wheelConfig();
      await setWheelRow(tx, config);
      const now = new Date();
      const user = await makeUser(tx, "guest");
      const guest = await createSpin(tx, { config, account: null, locale: "tr", ipHash: null, pagePath: "/", now, randomInt: TEN });
      assert.ok(guest.ok);
      assert.equal(await findAccountHeldSpin(tx, { config, userId: user.id, now }), null, "a cookie spin of this browser is not bound to the account");
      assert.equal(await bindSpin(tx, { spinId: guest.spin.id, userId: user.id, via: "sign_in", config, now }), "bound");
      assert.equal((await findAccountHeldSpin(tx, { config, userId: user.id, now }))?.id, guest.spin.id, "bound at an unverified sign-in: the account's now");
    });
  });

  test("claimWheel's service claims the held spin by the account on a device without the wheel cookie; the card then shows the code", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      const live = wheelConfig();
      await setWheelRow(tx, live);
      const user = await makeUser(tx, "claim");
      const spin = await signedInSpin(tx, live, user.id, new Date(now.getTime() - DAY));
      // The campaign has ended since; the visitor opens /hesap on another device (no cookie).
      const ended = wheelConfig({ endsAt: new Date(now.getTime() - HOUR).toISOString() });
      await setWheelRow(tx, ended);
      assert.equal((await queryAccountHeldSpin(tx, user.id, now))?.spinId, spin.id);
      const claim = await claimSpinForAccount(tx, { userId: user.id, cookieSpinId: null, via: "signed_in", config: ended, now, consumeClaimLimit: wheelClaimLimiter(v6(9, ":1")) });
      assert.ok(claim.ok, "claimed without a cookie");
      assert.equal(claim.issued.spinId, spin.id, "the spin the card showed");
      assert.equal(claim.issued.created, true);
      assert.equal(claim.issued.endsAt.getTime(), now.getTime() + 72 * HOUR, "valid validityHours from the claim");
      const [row] = await tx.select({ status: schema.wheelSpins.status, couponId: schema.wheelSpins.couponId, boundVia: schema.wheelSpins.boundVia }).from(schema.wheelSpins).where(eq(schema.wheelSpins.id, spin.id));
      assert.equal(row.status, "claimed");
      assert.equal(row.couponId, claim.issued.couponId);
      assert.equal(row.boundVia, "signed_in", "bound_via kept");
      assert.equal(await queryAccountHeldSpin(tx, user.id, now), null, "the held card goes");
      const prize = await queryAccountWheelPrize(tx, user.id, now);
      assert.equal(prize?.status, "active");
      assert.equal(prize?.code, claim.issued.code, "the prize card shows the new code");
      const again = await claimSpinForAccount(tx, { userId: user.id, cookieSpinId: null, via: "signed_in", config: ended, now });
      assert.deepEqual(again, { ok: false, error: "already_claimed" }, "nothing left to claim this round");
    });
  });
});
