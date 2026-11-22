// Sales-ready IMPL-B against the local PostgreSQL (SR-2, the havale payment deadline):
//   - the overdue query of the panel (countOverdueBankTransfers / listOverdueBankTransfers / the list's flag):
//     only unpaid awaiting_transfer havale orders whose last payment day (Istanbul) has ended at `now`;
//   - the "Havale/EFT bilgileriniz" e-mail data takes its deadline from settings.payments.bankTransfer.paymentDays;
//   - FIX F4: an order keeps the day count it was placed with (orders.breakdown.bankTransferDays): the overdue query
//     and the e-mail read it per order, the setting is only the fallback for orders without one.
//
// Shared database: everything runs inside transactions that are rolled back (orders PR-97…, e-mails
// salesready-impl-b-…@test.local, the payments settings row changed only inside the rollback). Order dates
// are in 2031, so no real order of the owner can match the ids checked here; counts are compared as deltas
// within the transaction. Every public sequence is put back afterwards (identity values are not rolled back).
//   npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/salesready-impl-b.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AddressData, OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import { loadOrderEmailData } from "@/lib/notifications/order-emails";
import { bankTransferDeadline, bankTransferOverdueCutoff } from "@/lib/orders/bank-transfer-deadline";
import { countOverdueBankTransfers, listOverdueBankTransfers, overdueBankTransferFlag } from "@/lib/orders/bank-transfer-overdue";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings } from "@/lib/settings/types";
import { restoreSequences, snapshotSequences, type SequenceSnapshot } from "./setup/sequences";

const TAG = `salesready-impl-b-${randomUUID().slice(0, 8)}`;
const o = schema.orders;
const address: AddressData = { fullName: "Test Alıcı", phone: "+905321112233", city: "Kayseri", district: "Talas", line1: "Gül Sok. No: 4", postalCode: "38280" };

let seqs: SequenceSnapshot;
let n = 0;

const BREAKDOWN = {
  couponDiscount: 0,
  couponType: null,
  bankTransferDiscount: 0,
  bankTransferPercent: 0,
  shippingFlat: 9990,
  shippingHeavy: 0,
  heavyKg: 0,
  freeShipping: false,
  freeShippingReason: null,
  totalWeightGrams: 1000,
  itemCount: 2,
};

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

async function order(tx: Tx, opts: { method: PaymentMethod; status: OrderStatus; createdAt: string; paidAt?: string | null; bankTransferDays?: unknown }) {
  n += 1;
  const [row] = await tx
    .insert(o)
    .values({
      orderNumber: `PR-97${String(90000 + n)}`,
      email: `${TAG}-${n}@test.local`,
      phone: "+905321112233",
      status: opts.status,
      paymentMethod: opts.method,
      subtotal: 29980,
      shippingTotal: 9990,
      vatTotal: 6663,
      grandTotal: 39970,
      shippingAddress: address,
      invoice: { type: "individual", sameAsShipping: true } as never,
      createdAt: new Date(opts.createdAt),
      updatedAt: new Date(opts.createdAt),
      paidAt: opts.paidAt ? new Date(opts.paidAt) : null,
      // FIX F4: the day count stored at placement (omitted = an order from before the field existed).
      ...(opts.bankTransferDays !== undefined ? { breakdown: { ...BREAKDOWN, bankTransferDays: opts.bankTransferDays } as never } : {}),
    })
    .returning({ id: o.id, createdAt: o.createdAt });
  return row;
}

before(async () => {
  seqs = await snapshotSequences();
});

after(async () => {
  await restoreSequences(seqs);
  // Nothing was committed; this only proves it.
  const left = await db.select({ id: o.id }).from(o).where(inArray(o.email, Array.from({ length: n }, (_, i) => `${TAG}-${i + 1}@test.local`)));
  assert.equal(left.length, 0);
});

describe("SR-2 overdue havale orders", () => {
  test("only unpaid awaiting_transfer havale orders past the end of their last Istanbul day", async () => {
    await inRollback(async (tx) => {
      // 3 payment days. now = 14 Mar 2031 00:00 Istanbul (13 Mar 21:00Z): A's last day (13 Mar) has just ended.
      const now = new Date("2031-03-13T21:00:00.000Z");
      const before = await countOverdueBankTransfers(tx, { paymentDays: 3, now });
      const a = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: "2031-03-10T19:30:00Z" }); // 10 Mar 22:30 Istanbul
      const b = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: "2031-03-10T21:30:00Z" }); // 11 Mar 00:30 Istanbul
      const paid = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: "2031-03-01T08:00:00Z", paidAt: "2031-03-02T08:00:00Z" });
      const cancelled = await order(tx, { method: "bank_transfer", status: "cancelled", createdAt: "2031-03-01T08:00:00Z" });
      const card = await order(tx, { method: "card", status: "pending_payment", createdAt: "2031-03-01T08:00:00Z" });
      const cod = await order(tx, { method: "cash_on_delivery", status: "processing", createdAt: "2031-03-01T08:00:00Z" });
      const ours = new Set([a.id, b.id, paid.id, cancelled.id, card.id, cod.id]);

      const overdueAt = async (at: Date, days = 3) =>
        (await listOverdueBankTransfers(tx, { paymentDays: days, now: at, limit: 500 })).filter((r) => ours.has(r.id)).map((r) => r.id);

      assert.deepEqual(await overdueAt(new Date("2031-03-13T20:59:59.999Z")), [], "13 Mar 23:59:59.999 Istanbul: still A's last day");
      assert.deepEqual(await overdueAt(now), [a.id], "A's last day ended; B (ordered on 11 Mar in Istanbul) has one more day");
      assert.equal((await countOverdueBankTransfers(tx, { paymentDays: 3, now })) - before, 1);
      assert.deepEqual(await overdueAt(new Date("2031-03-14T21:00:00.000Z")), [a.id, b.id], "oldest first");
      assert.deepEqual(await overdueAt(new Date("2031-03-14T21:00:00.000Z"), 5), [], "a longer payment period");
      assert.deepEqual(await overdueAt(new Date("2031-12-31T00:00:00Z"), 14), [a.id, b.id], "paid, cancelled, card and kapıda ödeme never count");

      const listed = (await listOverdueBankTransfers(tx, { paymentDays: 3, now, limit: 500 })).find((r) => r.id === a.id)!;
      assert.equal(listed.deadline.toISOString(), "2031-03-13T20:59:59.999Z");
      assert.equal(listed.deadline.getTime(), bankTransferDeadline(a.createdAt, 3).getTime());

      // The list's badge column is the same rule as the filter.
      const flags = await tx.select({ id: o.id, overdue: overdueBankTransferFlag({ now, paymentDays: 3 }) }).from(o).where(inArray(o.id, [...ours]));
      const flagged = flags.filter((f) => f.overdue).map((f) => f.id);
      assert.deepEqual(flagged, [a.id]);
      assert.equal(a.createdAt.getTime() < bankTransferOverdueCutoff(now, 3).getTime(), true, "the same cutoff as the pure rule");
    });
  });

  test("FIX F4: each order is judged by the day count it was placed with; the setting only for orders without one", async () => {
    await inRollback(async (tx) => {
      // All placed 10 Mar 22:30 Istanbul. Current setting: 3 days.
      const at = "2031-03-10T19:30:00Z";
      const old = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: at }); // no stored count: 3 (setting)
      const five = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: at, bankTransferDays: 5 });
      const two = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: at, bankTransferDays: 2 });
      const broken = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: at, bankTransferDays: "x" }); // not a number: the setting
      const ours = new Set([old.id, five.id, two.id, broken.id]);
      const overdueAt = async (iso: string) =>
        (await listOverdueBankTransfers(tx, { paymentDays: 3, now: new Date(iso), limit: 500 })).filter((r) => ours.has(r.id)).map((r) => r.id).sort((x, y) => x - y);
      const sorted = (...ids: number[]) => ids.sort((x, y) => x - y);

      assert.deepEqual(await overdueAt("2031-03-12T21:00:00.000Z"), [two.id], "13 Mar 00:00 Istanbul: only the 2-day order (its last day was 12 Mar)");
      assert.deepEqual(await overdueAt("2031-03-13T21:00:00.000Z"), sorted(old.id, two.id, broken.id), "14 Mar: the 3-day ones too (setting fallback)");
      assert.deepEqual(await overdueAt("2031-03-15T20:59:59.999Z"), sorted(old.id, two.id, broken.id), "15 Mar 23:59 Istanbul: the 5-day order still has time");
      assert.deepEqual(await overdueAt("2031-03-15T21:00:00.000Z"), sorted(old.id, five.id, two.id, broken.id));
      // A later setting change moves only the fallback orders.
      const withSetting7 = (await listOverdueBankTransfers(tx, { paymentDays: 7, now: new Date("2031-03-13T21:00:00.000Z"), limit: 500 })).filter((r) => ours.has(r.id)).map((r) => r.id);
      assert.deepEqual(withSetting7, [two.id], "setting 7: the stored 2-day order is still overdue, the fallback ones are not");

      const listed = (await listOverdueBankTransfers(tx, { paymentDays: 3, now: new Date("2031-03-20T00:00:00Z"), limit: 500 })).filter((r) => ours.has(r.id));
      const deadlineOf = (id: number) => listed.find((r) => r.id === id)!.deadline.toISOString();
      assert.equal(deadlineOf(five.id), "2031-03-15T20:59:59.999Z");
      assert.equal(deadlineOf(two.id), "2031-03-12T20:59:59.999Z");
      assert.equal(deadlineOf(old.id), "2031-03-13T20:59:59.999Z");
      assert.equal(
        (await countOverdueBankTransfers(tx, { paymentDays: 3, now: new Date("2031-03-12T21:00:00.000Z") })) -
          (await countOverdueBankTransfers(tx, { paymentDays: 3, now: new Date("2031-03-12T20:59:59.999Z") })),
        1,
        "the count follows the same per-order rule",
      );
    });
  });
});

describe("SR-2 havale e-mail deadline", () => {
  test("the deadline in the 'Havale/EFT bilgileriniz' data follows settings.payments.bankTransfer.paymentDays", async () => {
    await inRollback(async (tx) => {
      const [row] = await tx.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "payments"));
      const current = parseSettings("payments", row?.value);
      const value = { ...current, bankTransfer: { ...current.bankTransfer, enabled: true, paymentDays: 5 } };
      await tx
        .insert(schema.settings)
        .values({ key: "payments", value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } });

      const placed = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: "2031-03-10T21:30:00Z" }); // 11 Mar 00:30 Istanbul
      const loaded = await loadOrderEmailData(tx, placed.id);
      assert.ok(loaded?.data.bankTransfer);
      assert.equal(loaded.data.bankTransfer.deadline, "2031-03-16T20:59:59.999Z", "11 Mar + 5 days = 16 Mar, end of the day in Istanbul");

      const card = await order(tx, { method: "card", status: "pending_payment", createdAt: "2031-03-10T21:30:00Z" });
      assert.equal((await loadOrderEmailData(tx, card.id))?.data.bankTransfer, null);

      // FIX F4: an order placed with 2 days keeps 2 although the setting now says 5.
      const stored = await order(tx, { method: "bank_transfer", status: "awaiting_transfer", createdAt: "2031-03-10T21:30:00Z", bankTransferDays: 2 });
      assert.equal((await loadOrderEmailData(tx, stored.id))?.data.bankTransfer?.deadline, "2031-03-13T20:59:59.999Z", "11 Mar + 2 days, the order's own count");
    });
  });
});
