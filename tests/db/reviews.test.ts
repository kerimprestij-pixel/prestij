// REVIEWS against the local PostgreSQL: writing reviews (signed in and through the signed e-mail link),
// one review per customer/order and product, forged / expired / reused links, moderation (approve,
// reject, delete, reply) and the products.rating_* aggregate, the review request job and its e-mail.
//
// Other agents share the database, so almost everything runs inside a transaction that is rolled back
// at the end of the test (nothing is committed, no mail can be flushed). The two tests that need real
// commits (parallel submits, executePanelAction) create rows tagged "reviews-test" and delete them;
// `after` checks that nothing tagged is left and that every product's rating and updated_at are back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/reviews.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { renderEmailPreview } from "@/lib/email";
import { executePanelAction } from "@/lib/panel/action-core";
import type { Tx } from "@/lib/panel/tx";
import { queryReviewPage, queryReviewSummary } from "@/lib/reviews/data";
import { approveReviewsSchema, rejectReviewSchema, replyReviewSchema, runApproveReviews, runRejectReview, runReplyReview } from "@/lib/reviews/definitions";
import { withReviewJsonLd } from "@/lib/reviews/display";
import { sendDueReviewRequests } from "@/lib/reviews/requests";
import { parseReviewSubmission, type ParsedReview } from "@/lib/reviews/schema";
import {
  deleteReview,
  loadReviewSettings,
  replyToReview,
  reviewFormState,
  setReviewStatus,
  submitReview,
  type ReviewSettings,
  type ReviewViewer,
} from "@/lib/reviews/service";
import { createReviewToken, readReviewToken } from "@/lib/reviews/tokens";
import type { StaffSession } from "@/lib/session";

const TAG = "reviews-test";
const DOMAIN = "test.local";
const SETTINGS: ReviewSettings = { enabled: true, allowGuestLinks: true, requestDaysAfterDelivery: 7, minLength: 10 };
const OPTS = { anonymousName: "Müşterimiz" };
const DAY = 24 * 60 * 60 * 1000;
const FAKE_ACTOR = {
  user: { id: `${TAG}-actor`, name: "Yorum Test Editörü", email: `${TAG}-actor@${DOMAIN}`, role: "editor", banned: false },
  session: { id: "x" },
  staffRole: "editor",
} as unknown as StaffSession;

const r = schema.reviews;
const o = schema.orders;
const p = schema.products;

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back (assertion errors still surface). */
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type ProductInfo = { id: number; slug: string; variantId: number; sku: string; price: number };
let LAVANTA: ProductInfo;
let OKYANUS: ProductInfo;
let SAMPLE: ProductInfo;
let productState: { id: number; ratingAverage: number; ratingCount: number; updatedAt: string }[] = [];
const sequences: { name: string; lastValue: string; isCalled: boolean }[] = [];
let orderSeq = 0;

async function productInfo(slug: string): Promise<ProductInfo> {
  const [row] = await db.execute<{ id: number; slug: string; variant_id: number; sku: string; price: number }>(
    sql`select p.id, p.slug, v.id as variant_id, v.sku, v.price from products p join product_variants v on v.product_id = p.id where p.slug = ${slug} order by v.id limit 1`,
  );
  assert.ok(row, `product ${slug} exists`);
  return { id: Number(row.id), slug: row.slug, variantId: Number(row.variant_id), sku: row.sku, price: Number(row.price) };
}

async function createUser(executor: Tx, n: string, name: string): Promise<NonNullable<ReviewViewer>> {
  const id = `${TAG}-${n}`;
  await executor.insert(schema.user).values({ id, name, email: `${TAG}-${n}@${DOMAIN}`, emailVerified: true, role: "customer" });
  return { userId: id, name };
}

async function createOrder(
  executor: Tx,
  opts: { userId?: string | null; status?: string; deliveredDaysAgo?: number | null; products: ProductInfo[]; locale?: string; fullName?: string; now?: Date },
): Promise<{ id: number; orderNumber: string }> {
  const now = opts.now ?? new Date();
  const orderNumber = `RVTEST-${process.pid}-${++orderSeq}`;
  const total = opts.products.reduce((sum, x) => sum + x.price, 0);
  const address = { fullName: opts.fullName ?? "Ayşe Yılmaz", phone: "+905321234567", city: "Kayseri", district: "Kocasinan", line1: "Test Sok. 1" };
  const [order] = await executor
    .insert(o)
    .values({
      orderNumber,
      userId: opts.userId ?? null,
      email: `${TAG}-order${orderSeq}@${DOMAIN}`,
      locale: opts.locale ?? "tr",
      status: (opts.status ?? "delivered") as "delivered",
      paymentMethod: "cash_on_delivery",
      subtotal: total,
      grandTotal: total,
      shippingAddress: address,
      invoice: { type: "individual", sameAsShipping: true } as never,
      deliveredAt: opts.deliveredDaysAgo == null ? null : new Date(now.getTime() - opts.deliveredDaysAgo * DAY),
    })
    .returning({ id: o.id, orderNumber: o.orderNumber });
  for (const product of opts.products) {
    await executor.insert(schema.orderItems).values({
      orderId: order.id,
      variantId: product.variantId,
      snapshot: { productId: product.id, productName: { tr: product.slug }, variantTitle: { tr: "500 ml", en: "500 ml", ar: "500 مل" }, sku: product.sku },
      unitPrice: product.price,
      quantity: 2,
      lineTotal: product.price * 2,
    });
  }
  return order;
}

function review(productId: number, extra: Partial<ParsedReview> = {}): ParsedReview {
  return {
    productId,
    locale: "tr",
    rating: 5,
    title: "Harika koku",
    body: "Lavanta kokusu çok doğal, ellerimde yumuşaklık bırakıyor.",
    displayName: null,
    token: null,
    honeypot: false,
    ...extra,
  };
}

async function ratingOf(executor: Tx, productId: number) {
  const [row] = await executor.select({ average: p.ratingAverage, count: p.ratingCount, updatedAt: p.updatedAt }).from(p).where(eq(p.id, productId));
  return row;
}

async function cleanupTagged() {
  const users = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `${TAG}-%`))).map((u) => u.id);
  const orders = (await db.select({ id: o.id }).from(o).where(like(o.orderNumber, "RVTEST-%"))).map((x) => x.id);
  const reviewIds = (
    await db
      .select({ id: r.id, productId: r.productId })
      .from(r)
      .where(or(users.length ? inArray(r.userId, users) : sql`false`, orders.length ? inArray(r.orderId, orders) : sql`false`))
  ).map((x) => x.id);
  if (reviewIds.length) await db.delete(r).where(inArray(r.id, reviewIds));
  await db.delete(schema.emailMessages).where(like(schema.emailMessages.toEmail, `${TAG}-%@${DOMAIN}`));
  if (orders.length) await db.delete(o).where(inArray(o.id, orders)); // items cascade
  if (users.length) await db.delete(schema.user).where(inArray(schema.user.id, users));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, FAKE_ACTOR.user.id));
}

before(async () => {
  LAVANTA = await productInfo("lavanta");
  OKYANUS = await productInfo("okyanus");
  SAMPLE = await productInfo("lavanta-numune");
  await cleanupTagged();
  productState = (
    await db.execute<{ id: number; rating_average: number; rating_count: number; updated_at: string }>(
      sql`select id, rating_average, rating_count, updated_at::text from products order by id`,
    )
  ).map((row) => ({ id: Number(row.id), ratingAverage: Number(row.rating_average), ratingCount: Number(row.rating_count), updatedAt: row.updated_at }));
  for (const table of ["reviews", "orders", "order_items", "audit_log", "email_messages"]) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    sequences.push({ name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
});

after(async () => {
  try {
    await cleanupTagged();
    // Ratings may have been recomputed by committed tests: put every product back exactly.
    for (const row of productState) {
      await db.execute(
        sql`update products set rating_average = ${row.ratingAverage}, rating_count = ${row.ratingCount}, updated_at = ${row.updatedAt}::timestamptz
            where id = ${row.id} and (rating_average <> ${row.ratingAverage} or rating_count <> ${row.ratingCount} or updated_at <> ${row.updatedAt}::timestamptz)`,
      );
    }
    for (const s of sequences) {
      const table = s.name.replace(/^public\./, "").replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      // Put the sequence back unless another agent inserted rows meanwhile.
      if (max === null || Number(max) <= Number(s.lastValue)) await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
    const leftovers = await db.execute<{ n: number }>(
      sql`select (select count(*) from "user" where id like ${`${TAG}-%`}) + (select count(*) from orders where order_number like 'RVTEST-%') + (select count(*) from audit_log where user_id = ${FAKE_ACTOR.user.id}) as n`,
    );
    assert.equal(Number(leftovers[0].n), 0, "nothing tagged is left");
    const now = await db.execute<{ id: number; rating_average: number; rating_count: number; updated_at: string }>(
      sql`select id, rating_average, rating_count, updated_at::text from products order by id`,
    );
    for (const row of productState) {
      const cur = now.find((x) => Number(x.id) === row.id);
      if (!cur) continue;
      assert.deepEqual(
        { average: Number(cur.rating_average), count: Number(cur.rating_count), updatedAt: cur.updated_at },
        { average: row.ratingAverage, count: row.ratingCount, updatedAt: row.updatedAt },
        `product ${row.id} restored`,
      );
    }
  } finally {
    await db.$client.end();
  }
});

describe("validation", () => {
  test("rating, minimum length, cleaning and the honeypot", () => {
    const bad = parseReviewSubmission({ productId: 2, rating: 0, body: "kısa" }, 10);
    assert.equal(bad.ok, false);
    assert.deepEqual(!bad.ok && bad.fieldErrors, { rating: "required", body: "too_short" });

    const empty = parseReviewSubmission({ productId: 2, rating: 4, body: "   " }, 10);
    assert.deepEqual(!empty.ok && empty.fieldErrors, { body: "required" });

    const ratingOnly = parseReviewSubmission({ productId: 2, rating: 4, body: "" }, 0);
    assert.ok(ratingOnly.ok && ratingOnly.data.body === null, "minLength 0 allows a rating without text");

    const ok = parseReviewSubmission(
      { productId: "2", locale: "ar", rating: "5", title: " <b>Çok</b>   güzel ", body: "Satır 1\r\n\r\n\r\n\r\nSatır‮ 2 <script>x</script>", displayName: "", website: "" },
      10,
    );
    assert.ok(ok.ok);
    assert.equal(ok.data.title, "Çok güzel");
    assert.equal(ok.data.body, "Satır 1\n\nSatır 2 x");
    assert.equal(ok.data.locale, "ar");
    assert.equal(ok.data.displayName, null);
    assert.equal(ok.data.honeypot, false);

    const bot = parseReviewSubmission({ productId: 2, rating: 5, body: "Gerçekten güzel bir ürün.", website: "http://spam" }, 10);
    assert.ok(bot.ok && bot.data.honeypot);

    const long = parseReviewSubmission({ productId: 2, rating: 5, body: "a".repeat(2001), title: "b".repeat(121) }, 10);
    assert.deepEqual(!long.ok && long.fieldErrors, { title: "too_long", body: "too_long" });
  });
});

describe("signed-in customers", () => {
  test("one review per product: pending can be edited, approved is final; verified from a delivered order", async () => {
    await inRollback(async (tx) => {
      const ayse = await createUser(tx, "u1", "Ayşe Yılmaz");
      const order = await createOrder(tx, { userId: ayse.userId, deliveredDaysAgo: 3, products: [LAVANTA] });

      assert.deepEqual(await reviewFormState(tx, { productId: LAVANTA.id }, null, SETTINGS), { status: "signed_out" });
      const before = await reviewFormState(tx, { productId: LAVANTA.id }, ayse, SETTINGS);
      assert.deepEqual(before, { status: "ready", via: "account", defaultName: "A. Y.", verified: true, existing: null });

      const first = await submitReview(tx, review(LAVANTA.id), ayse, SETTINGS, OPTS);
      assert.ok(first.ok && !first.updated && first.verified);
      const [row] = await tx.select().from(r).where(eq(r.id, first.reviewId));
      assert.equal(row.status, "pending");
      assert.equal(row.userId, ayse.userId);
      assert.equal(row.orderId, order.id);
      assert.equal(row.authorName, "A. Y.");
      assert.equal(row.isVerifiedPurchase, true);

      const editing = await reviewFormState(tx, { productId: LAVANTA.id }, ayse, SETTINGS);
      assert.equal(editing.status, "ready");
      assert.deepEqual(editing.status === "ready" && editing.existing, { rating: 5, title: "Harika koku", body: row.body, displayName: "A. Y." });

      const edit = await submitReview(tx, review(LAVANTA.id, { rating: 4, displayName: "Ayşe Y." }), ayse, SETTINGS, OPTS);
      assert.ok(edit.ok && edit.updated && edit.reviewId === first.reviewId);
      assert.equal((await tx.select().from(r).where(eq(r.productId, LAVANTA.id))).filter((x) => x.userId === ayse.userId).length, 1);

      await setReviewStatus(tx, { ids: [first.reviewId], status: "approved" });
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id), ayse, SETTINGS, OPTS), { ok: false, error: "already_reviewed" });
      assert.deepEqual(await reviewFormState(tx, { productId: LAVANTA.id }, ayse, SETTINGS), { status: "reviewed", reviewStatus: "approved" });

      // Another product without a purchase: allowed, but not verified.
      const other = await submitReview(tx, review(OKYANUS.id), ayse, SETTINGS, OPTS);
      assert.ok(other.ok && !other.verified);
      const [otherRow] = await tx.select().from(r).where(eq(r.id, other.reviewId));
      assert.equal(otherRow.orderId, null);
      assert.equal(otherRow.isVerifiedPurchase, false);
    });
  });

  test("samples, inactive products and switched-off reviews are refused", async () => {
    await inRollback(async (tx) => {
      const user = await createUser(tx, "u2", "Mehmet Kaya");
      assert.deepEqual(await submitReview(tx, review(SAMPLE.id), user, SETTINGS, OPTS), { ok: false, error: "not_eligible" });
      assert.deepEqual(await reviewFormState(tx, { productId: SAMPLE.id }, user, SETTINGS), { status: "disabled" });
      const off = { ...SETTINGS, enabled: false };
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id), user, off, OPTS), { ok: false, error: "disabled" });
      assert.deepEqual(await reviewFormState(tx, { productId: LAVANTA.id }, user, off), { status: "disabled" });
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id), null, SETTINGS, OPTS), { ok: false, error: "signed_out" });
    });
  });

  test("two parallel submits of one customer store exactly one review", async () => {
    const user = await createUser(db, "par", "Zeynep Ak");
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => db.transaction((tx) => submitReview(tx, review(OKYANUS.id, { rating: (i % 5) + 1 }), user, SETTINGS, OPTS))),
      );
      const rows = await db.select().from(r).where(eq(r.userId, user.userId));
      assert.equal(rows.length, 1, "unique (product_id, user_id) holds");
      assert.ok(results.some((x) => x.ok && !x.updated), "one insert");
      for (const x of results) assert.ok(x.ok || x.error === "already_reviewed", JSON.stringify(x));
    } finally {
      await db.delete(r).where(eq(r.userId, user.userId));
      await db.delete(schema.user).where(eq(schema.user.id, user.userId));
    }
  });
});

describe("review links (guests)", () => {
  test("a valid link stores a verified review once; reuse is refused", async () => {
    await inRollback(async (tx) => {
      const order = await createOrder(tx, { deliveredDaysAgo: 8, products: [LAVANTA, OKYANUS], fullName: "Elif Nur Demir" });
      const token = createReviewToken(order.id, LAVANTA.id);
      assert.deepEqual(readReviewToken(token), { ok: true, orderId: order.id, productId: LAVANTA.id });

      const state = await reviewFormState(tx, { productId: LAVANTA.id, token }, null, SETTINGS);
      assert.deepEqual(state, { status: "ready", via: "link", defaultName: "E. D.", verified: true, existing: null });

      const saved = await submitReview(tx, review(LAVANTA.id, { token }), null, SETTINGS, OPTS);
      assert.ok(saved.ok && saved.verified);
      const [row] = await tx.select().from(r).where(eq(r.id, saved.reviewId));
      assert.equal(row.orderId, order.id);
      assert.equal(row.userId, null);
      assert.equal(row.isVerifiedPurchase, true);
      assert.equal(row.authorName, "E. D.");
      assert.equal(row.status, "pending");

      assert.deepEqual(await submitReview(tx, review(LAVANTA.id, { token }), null, SETTINGS, OPTS), { ok: false, error: "already_reviewed" });
      assert.deepEqual(await reviewFormState(tx, { productId: LAVANTA.id, token }, null, SETTINGS), { status: "link_error", reason: "used" });

      // The same order's other product has its own link.
      const second = await submitReview(tx, review(OKYANUS.id, { token: createReviewToken(order.id, OKYANUS.id) }), null, SETTINGS, OPTS);
      assert.ok(second.ok);
    });
  });

  test("forged, wrong-product, expired and undelivered links are refused", async () => {
    await inRollback(async (tx) => {
      const order = await createOrder(tx, { deliveredDaysAgo: 8, products: [LAVANTA] });
      const token = createReviewToken(order.id, LAVANTA.id);

      // Forged: payload changed (another order), signature kept.
      const [v, , sig] = token.split(".");
      const forgedBody = Buffer.from(JSON.stringify({ p: { orderId: order.id + 1, productId: LAVANTA.id }, e: null })).toString("base64url");
      const forged = `${v}.${forgedBody}.${sig}`;
      assert.deepEqual(readReviewToken(forged), { ok: false, reason: "invalid" });
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id, { token: forged }), null, SETTINGS, OPTS), { ok: false, error: "link_invalid" });
      assert.deepEqual(await reviewFormState(tx, { productId: LAVANTA.id, token: forged }, null, SETTINGS), { status: "link_error", reason: "invalid" });
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id, { token: "not-a-token" }), null, SETTINGS, OPTS), { ok: false, error: "link_invalid" });

      // A link for one product does not open another product's form.
      assert.deepEqual(await submitReview(tx, review(OKYANUS.id, { token }), null, SETTINGS, OPTS), { ok: false, error: "link_invalid" });

      // A link for an order that contains the product but is not delivered (yet, or any more).
      const shipped = await createOrder(tx, { status: "shipped", deliveredDaysAgo: null, products: [LAVANTA] });
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id, { token: createReviewToken(shipped.id, LAVANTA.id) }), null, SETTINGS, OPTS), {
        ok: false,
        error: "not_eligible",
      });

      // Guest links switched off: the link is ignored (a guest must sign in).
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id, { token }), null, { ...SETTINGS, allowGuestLinks: false }, OPTS), {
        ok: false,
        error: "signed_out",
      });

      // Expired: a one-second link, checked after it ran out.
      const shortLived = createReviewToken(order.id, LAVANTA.id, 1);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      assert.deepEqual(readReviewToken(shortLived), { ok: false, reason: "expired" });
      assert.deepEqual(await submitReview(tx, review(LAVANTA.id, { token: shortLived }), null, SETTINGS, OPTS), { ok: false, error: "link_expired" });
      assert.deepEqual(await reviewFormState(tx, { productId: LAVANTA.id, token: shortLived }, null, SETTINGS), { status: "link_error", reason: "expired" });

      assert.equal((await tx.select().from(r).where(eq(r.orderId, order.id))).length, 0, "nothing stored");
    });
  });

  test("the order's owner, signed in, gets one review whether by link or by account", async () => {
    await inRollback(async (tx) => {
      const owner = await createUser(tx, "u3", "Can Öz");
      const order = await createOrder(tx, { userId: owner.userId, deliveredDaysAgo: 8, products: [LAVANTA] });
      const token = createReviewToken(order.id, LAVANTA.id);
      const byLink = await submitReview(tx, review(LAVANTA.id, { token }), null, SETTINGS, OPTS);
      assert.ok(byLink.ok);
      // The same customer, now signed in, edits that pending review instead of writing a second one.
      const state = await reviewFormState(tx, { productId: LAVANTA.id }, owner, SETTINGS);
      assert.ok(state.status === "ready" && state.existing);
      const edit = await submitReview(tx, review(LAVANTA.id, { rating: 3 }), owner, SETTINGS, OPTS);
      assert.ok(edit.ok && edit.updated && edit.reviewId === byLink.reviewId);
      const rows = await tx.select().from(r).where(eq(r.productId, LAVANTA.id));
      const mine = rows.filter((x) => x.orderId === order.id || x.userId === owner.userId);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].userId, owner.userId);
      assert.equal(mine[0].rating, 3);
    });
  });
});

describe("moderation and the rating aggregate", () => {
  test("approve, reject and delete keep products.rating_* right without touching updated_at", async () => {
    await inRollback(async (tx) => {
      const start = await ratingOf(tx, LAVANTA.id);
      const ids: number[] = [];
      for (const [i, rating] of [5, 4, 2].entries()) {
        const user = await createUser(tx, `agg${i}`, `Kişi ${i} Test`);
        const res = await submitReview(tx, review(LAVANTA.id, { rating }), user, SETTINGS, OPTS);
        assert.ok(res.ok);
        ids.push(res.reviewId);
      }
      const base = await queryReviewSummary(LAVANTA.id, tx);

      const approved = await setReviewStatus(tx, { ids, status: "approved" });
      assert.equal(approved.changed, 3);
      assert.deepEqual(approved.tags.sort(), ["products", `product:${LAVANTA.slug}`, `reviews:${LAVANTA.id}`].sort());
      assert.equal(approved.audit.length, 3);
      const summary = await queryReviewSummary(LAVANTA.id, tx);
      assert.equal(summary.count, base.count + 3);
      let agg = await ratingOf(tx, LAVANTA.id);
      assert.equal(agg.count, summary.count);
      assert.equal(agg.average, summary.average);
      assert.equal(agg.updatedAt.toISOString(), start.updatedAt.toISOString(), "updated_at untouched");
      if (base.count === 0) {
        assert.equal(agg.average, 367); // (5 + 4 + 2) / 3 = 3.67
        assert.deepEqual(summary.distribution, [0, 1, 0, 1, 1]);
      }

      // Approving again changes nothing (no tags, no audit).
      assert.deepEqual(await setReviewStatus(tx, { ids, status: "approved" }), { changed: 0, tags: [], audit: [] });

      await setReviewStatus(tx, { ids: [ids[2]], status: "rejected" });
      agg = await ratingOf(tx, LAVANTA.id);
      if (base.count === 0) assert.deepEqual([agg.average, agg.count], [450, 2]);
      const [rejected] = await tx.select().from(r).where(eq(r.id, ids[2]));
      assert.equal(rejected.approvedAt, null);

      const removed = await deleteReview(tx, { id: ids[0] });
      assert.ok(removed.tags.includes("products"));
      agg = await ratingOf(tx, LAVANTA.id);
      if (base.count === 0) assert.deepEqual([agg.average, agg.count], [400, 1]);

      // Deleting a review that was never public does not invalidate anything.
      assert.deepEqual((await deleteReview(tx, { id: ids[2] })).tags, []);
      await assert.rejects(deleteReview(tx, { id: ids[2] }), /bulunamadı/);

      const page = await queryReviewPage(LAVANTA.id, 0, tx);
      assert.ok(page.reviews.every((x) => typeof x.createdAt === "string" && !("userId" in x) && !("orderId" in x)), "public reviews carry no user/order data");
      assert.equal(agg.updatedAt.toISOString(), start.updatedAt.toISOString());
    });
  });

  test("reply: public under approved reviews, locked by updated_at, empty removes it", async () => {
    await inRollback(async (tx) => {
      const user = await createUser(tx, "rep", "Deniz Yurt");
      const res = await submitReview(tx, review(OKYANUS.id), user, SETTINGS, OPTS);
      assert.ok(res.ok);
      const [row] = await tx.select().from(r).where(eq(r.id, res.reviewId));

      const pendingReply = await replyToReview(tx, { id: row.id, reply: "Teşekkür ederiz!", updatedAt: row.updatedAt });
      assert.deepEqual(pendingReply.tags, [], "a reply on a pending review is not public yet");
      await assert.rejects(replyToReview(tx, { id: row.id, reply: "Eski sürüm", updatedAt: row.updatedAt }), /başka biri/);

      await setReviewStatus(tx, { ids: [row.id], status: "approved" });
      const [fresh] = await tx.select().from(r).where(eq(r.id, row.id));
      const out = await runReplyReview(replyReviewSchema.parse({ id: row.id, reply: "  Güzel yorumunuz için\n\n\n\nteşekkürler.  ", updatedAt: fresh.updatedAt.toISOString() }), {
        tx,
        actor: FAKE_ACTOR,
      });
      assert.equal(out.data?.reply, "Güzel yorumunuz için\n\nteşekkürler.");
      assert.deepEqual(out.tags?.sort(), [`product:${OKYANUS.slug}`, `reviews:${OKYANUS.id}`].sort());
      const page = await queryReviewPage(OKYANUS.id, 0, tx);
      assert.equal(page.reviews.find((x) => x.id === row.id)?.reply, "Güzel yorumunuz için\n\nteşekkürler.");

      const removed = await replyToReview(tx, { id: row.id, reply: "", updatedAt: new Date(out.data!.updatedAt) });
      assert.equal(removed.reply, null);
    });
  });

  test("executePanelAction: bulk approve commits, writes one audit row per review and returns the tags", async () => {
    const users = [await createUser(db, "pa1", "Pelin Aras"), await createUser(db, "pa2", "Kerem Su")];
    const ids: number[] = [];
    try {
      for (const user of users) {
        const res = await db.transaction((tx) => submitReview(tx, review(OKYANUS.id, { rating: 4 }), user, SETTINGS, OPTS));
        assert.ok(res.ok);
        ids.push(res.reviewId);
      }
      const versions = await db.select({ id: schema.reviews.id, updatedAt: schema.reviews.updatedAt }).from(schema.reviews).where(inArray(schema.reviews.id, ids));
      const { result, tags } = await executePanelAction({ schema: approveReviewsSchema, run: runApproveReviews }, FAKE_ACTOR, {
        reviews: versions.map((v) => ({ id: v.id, updatedAt: v.updatedAt.toISOString() })),
      });
      assert.ok(result.ok, JSON.stringify(result));
      assert.deepEqual(result.ok && result.data, { changed: 2 });
      assert.ok(tags.includes(`reviews:${OKYANUS.id}`) && tags.includes(`product:${OKYANUS.slug}`) && tags.includes("products"));
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, FAKE_ACTOR.user.id));
      assert.equal(audit.filter((a) => a.entity === "review" && a.action === "status").length, 2);
      const agg = await ratingOf(db, OKYANUS.id);
      const summary = await queryReviewSummary(OKYANUS.id);
      assert.deepEqual([agg.average, agg.count], [summary.average, summary.count]);

      const invalid = await executePanelAction({ schema: approveReviewsSchema, run: runApproveReviews }, FAKE_ACTOR, { reviews: [] });
      assert.equal(invalid.result.ok, false);
    } finally {
      await db.transaction(async (tx) => {
        for (const id of ids) await deleteReview(tx, { id }).catch(() => undefined);
      });
      await db.delete(schema.user).where(inArray(schema.user.id, users.map((u) => u.userId)));
      await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, FAKE_ACTOR.user.id));
    }
  });
});

describe("moderation names the version on screen", () => {
  test("a review its author edited after the moderator loaded it cannot be approved or rejected from the stale view", async () => {
    const author = await createUser(db, "stale", "Deniz Ak");
    let reviewId = 0;
    try {
      const first = await db.transaction((tx) => submitReview(tx, review(OKYANUS.id, { rating: 5 }), author, SETTINGS, OPTS));
      assert.ok(first.ok);
      reviewId = first.reviewId;
      const [seen] = await db.select({ updatedAt: schema.reviews.updatedAt }).from(schema.reviews).where(eq(schema.reviews.id, reviewId));
      await new Promise((r) => setTimeout(r, 5));
      const edit = await db.transaction((tx) => submitReview(tx, review(OKYANUS.id, { rating: 1, title: "Düzenlendi", body: "Panel açıldıktan sonra değiştirilen metin." }), author, SETTINGS, OPTS));
      assert.ok(edit.ok && edit.updated);

      const stale = { id: reviewId, updatedAt: seen.updatedAt.toISOString() };
      const approve = await executePanelAction({ schema: approveReviewsSchema, run: runApproveReviews }, FAKE_ACTOR, { reviews: [stale] });
      assert.equal(approve.result.ok, false);
      assert.equal(!approve.result.ok && approve.result.code, "conflict");
      const reject = await executePanelAction({ schema: rejectReviewSchema, run: runRejectReview }, FAKE_ACTOR, stale);
      assert.equal(!reject.result.ok && reject.result.code, "conflict");
      const missing = await executePanelAction({ schema: approveReviewsSchema, run: runApproveReviews }, FAKE_ACTOR, { reviews: [{ id: reviewId }] });
      assert.equal(missing.result.ok, false, "a decision without a version is refused");
      const [row] = await db.select({ status: schema.reviews.status, updatedAt: schema.reviews.updatedAt }).from(schema.reviews).where(eq(schema.reviews.id, reviewId));
      assert.equal(row.status, "pending", "nothing was published");

      const fresh = await executePanelAction({ schema: approveReviewsSchema, run: runApproveReviews }, FAKE_ACTOR, { reviews: [{ id: reviewId, updatedAt: row.updatedAt.toISOString() }] });
      assert.ok(fresh.result.ok, JSON.stringify(fresh.result));
    } finally {
      if (reviewId) await db.transaction((tx) => deleteReview(tx, { id: reviewId })).catch(() => undefined);
      await db.delete(schema.user).where(eq(schema.user.id, author.userId));
      await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, FAKE_ACTOR.user.id));
    }
  });
});

describe("review request job", () => {
  test("due delivered orders get one e-mail with a signed link per unreviewed product, once", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      const due = await createOrder(tx, { deliveredDaysAgo: 8, products: [LAVANTA, OKYANUS, SAMPLE], locale: "en", fullName: "Selin Kar", now });
      const early = await createOrder(tx, { deliveredDaysAgo: 2, products: [LAVANTA], now });
      const old = await createOrder(tx, { deliveredDaysAgo: 60, products: [LAVANTA], now });
      const notDelivered = await createOrder(tx, { status: "shipped", deliveredDaysAgo: null, products: [LAVANTA], now });
      const owner = await createUser(tx, "job", "Ali Veli");
      const reviewed = await createOrder(tx, { userId: owner.userId, deliveredDaysAgo: 9, products: [LAVANTA], now });
      await submitReview(tx, review(LAVANTA.id), owner, SETTINGS, OPTS);
      const orderIds = [due.id, early.id, old.id, notDelivered.id, reviewed.id];

      const run = await sendDueReviewRequests(tx, { now, orderIds });
      assert.deepEqual(run, { queued: 1, skipped: 1, disabled: 0 });

      const stamped = await tx.select({ id: o.id, at: o.reviewRequestedAt }).from(o).where(inArray(o.id, orderIds));
      const at = new Map(stamped.map((x) => [x.id, x.at]));
      assert.ok(at.get(due.id) && at.get(reviewed.id), "due orders are stamped (also the one with nothing left to review)");
      assert.equal(at.get(early.id), null);
      assert.equal(at.get(old.id), null);
      assert.equal(at.get(notDelivered.id), null);

      const mails = await tx.select().from(schema.emailMessages).where(like(schema.emailMessages.toEmail, `${TAG}-%@${DOMAIN}`));
      assert.equal(mails.length, 1);
      const mail = mails[0];
      assert.equal(mail.template, "review_request");
      assert.equal(mail.locale, "en");
      assert.equal(mail.dedupeKey, `order:${due.id}:review_request:customer`);
      assert.equal(mail.relatedType, "order");
      assert.equal(mail.relatedId, String(due.id));
      assert.match(mail.subject, new RegExp(due.orderNumber));
      assert.match(mail.text, /Hello Selin/);
      const links = [...mail.text.matchAll(/\/en\/products\/([a-z-]+)\?degerlendir=([A-Za-z0-9._%-]+)#degerlendirmeler/g)];
      assert.deepEqual(links.map((m) => m[1]).sort(), [LAVANTA.slug, OKYANUS.slug].sort(), "one link per product, no sample");
      for (const [, slug, token] of links) {
        const parsed = readReviewToken(decodeURIComponent(token));
        assert.ok(parsed.ok && parsed.orderId === due.id && parsed.productId === (slug === LAVANTA.slug ? LAVANTA.id : OKYANUS.id));
      }

      // A second run (or a concurrent one after the first commit) sends nothing.
      assert.deepEqual(await sendDueReviewRequests(tx, { now, orderIds }), { queued: 0, skipped: 0, disabled: 0 });

      // Switched off in the panel: nothing happens.
      await tx
        .insert(schema.settings)
        .values({ key: "reviews", value: { ...SETTINGS, enabled: false } })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: { ...SETTINGS, enabled: false } } });
      assert.equal((await loadReviewSettings(tx)).enabled, false);
      assert.deepEqual(await sendDueReviewRequests(tx, { now, orderIds: [early.id] }), { queued: 0, skipped: 0, disabled: 1 });
    });
  });

  test("guest links off: account orders get product links, guest orders are skipped", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      await tx
        .insert(schema.settings)
        .values({ key: "reviews", value: { ...SETTINGS, allowGuestLinks: false } })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: { ...SETTINGS, allowGuestLinks: false } } });
      const member = await createUser(tx, "mem", "Ece Tan");
      const guest = await createOrder(tx, { deliveredDaysAgo: 8, products: [LAVANTA], now });
      const account = await createOrder(tx, { userId: member.userId, deliveredDaysAgo: 8, products: [OKYANUS], now });
      assert.deepEqual(await sendDueReviewRequests(tx, { now, orderIds: [guest.id, account.id] }), { queued: 1, skipped: 1, disabled: 0 });
      const [mail] = await tx.select().from(schema.emailMessages).where(like(schema.emailMessages.toEmail, `${TAG}-%@${DOMAIN}`));
      assert.doesNotMatch(mail.text, /degerlendir=/);
      assert.match(mail.text, new RegExp(`/tr/urunler/${OKYANUS.slug}#degerlendirmeler`));
    });
  });

  test("the e-mail renders in tr, en and ar (rtl)", async () => {
    for (const locale of ["tr", "en", "ar"] as const) {
      const preview = await renderEmailPreview("review_request", locale);
      assert.ok(preview, locale);
      assert.match(preview.subject, /PR-261001/);
      if (locale === "ar") assert.match(preview.html, /dir="rtl"/);
      assert.match(preview.html, /degerlendir=ornek/);
    }
  });
});

describe("JSON-LD", () => {
  test("aggregate and reviews only when approved reviews exist", () => {
    const base = { "@type": "Product", name: "Lavanta", aggregateRating: { stale: true } };
    assert.deepEqual(withReviewJsonLd(base, null), { "@type": "Product", name: "Lavanta" });
    const data = {
      productId: 2,
      summary: { count: 2, average: 450, distribution: [0, 0, 0, 1, 1] as [number, number, number, number, number] },
      reviews: [
        { id: 1, rating: 5, title: "Harika", body: "Çok güzel.", authorName: "A. Y.", locale: "tr", verified: true, createdAt: "2026-11-09T22:30:00.000Z", reply: null },
        { id: 2, rating: 4, title: null, body: null, authorName: "B. K.", locale: "en", verified: false, createdAt: "2026-11-01T10:00:00.000Z", reply: "Thanks" },
      ],
      hasMore: false,
    };
    const parsed = JSON.parse(JSON.stringify(withReviewJsonLd(base, data)));
    assert.deepEqual(parsed.aggregateRating, { "@type": "AggregateRating", ratingValue: "4.5", reviewCount: 2, ratingCount: 2, bestRating: 5, worstRating: 1 });
    assert.equal(parsed.review.length, 2);
    assert.deepEqual(parsed.review[0], {
      "@type": "Review",
      author: { "@type": "Person", name: "A. Y." },
      datePublished: "2026-11-10",
      inLanguage: "tr",
      name: "Harika",
      reviewBody: "Çok güzel.",
      reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
    });
    assert.equal("reviewBody" in parsed.review[1], false);
    assert.deepEqual(withReviewJsonLd(base, { ...data, summary: { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] }, reviews: [] }), {
      "@type": "Product",
      name: "Lavanta",
    });
  });
});
