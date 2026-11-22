// Reviews: writing (signed-in customers and signed review links), moderation (approve, reject, delete,
// reply) and the product rating aggregate. No Next APIs: the storefront actions (./actions.ts) and the
// panel actions (src/app/panel/(dashboard)/yorumlar/actions.ts) pass a transaction, the session user
// and the settings, so DB tests call everything directly.
//
// Rules:
// - one review per customer and product (unique (product_id, user_id)), one per order and product
//   (unique (product_id, order_id)): a review link works once, a double submit inserts once;
// - customers may edit their review while it is pending; approved or rejected reviews are final;
// - a review link (purpose "review") needs a delivered order that contains the product, and marks the
//   review as a verified purchase; signed-in reviews are verified when the customer has a delivered
//   order with the product;
// - products.rating_average / rating_count are recomputed under a product row lock on every approve,
//   reject and delete, without touching products.updated_at (the product editor's version stamp).
import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import { TAGS } from "@/lib/cache-tags";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { PanelError, fieldError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { parseSettings, type Settings } from "@/lib/settings/types";
import type { ParsedReview } from "./schema";
import { cleanMultiline, initialsOf, textLength } from "./text";
import { readReviewToken } from "./tokens";
import { REVIEW_LIMITS, type OwnReviewDraft, type ReviewFormState, type ReviewStatus, type ReviewSubmitError } from "./types";

const r = schema.reviews;
const p = schema.products;
const o = schema.orders;

export type ReviewSettings = Settings<"reviews">;

/** The signed-in visitor (null = signed out). */
export type ReviewViewer = { userId: string; name: string | null } | null;

/** settings.reviews, read fresh (uncached) through the given executor. */
export async function loadReviewSettings(executor: Tx): Promise<ReviewSettings> {
  const [row] = await executor
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, "reviews"))
    .limit(1);
  return parseSettings("reviews", row?.value);
}

// ---------------------------------------------------------------------------------------------
// Rating aggregate

export type RatingAggregate = { average: number; count: number; changed: boolean };

/**
 * Recomputes products.rating_average (× 100) and rating_count from the approved reviews. Call it after
 * locking the product row (lockProducts) so concurrent moderation serializes. updated_at stays as is.
 */
export async function recomputeProductRating(tx: Tx, productId: number): Promise<RatingAggregate> {
  const [agg] = await tx.execute<{ n: number; avg: number }>(
    sql`select count(*)::int as n, coalesce(round(avg(rating) * 100), 0)::int as avg from reviews where product_id = ${productId} and status = 'approved'`,
  );
  const count = Number(agg?.n ?? 0);
  const average = Number(agg?.avg ?? 0);
  const updated = await tx.execute<{ id: number }>(
    sql`update products set rating_average = ${average}, rating_count = ${count}
        where id = ${productId} and (rating_average <> ${average} or rating_count <> ${count}) returning id`,
  );
  return { average, count, changed: updated.length > 0 };
}

type LockedProduct = { id: number; slug: string };

/** Locks the products (FOR NO KEY UPDATE, id order) whose aggregate is about to change. */
async function lockProducts(tx: Tx, productIds: number[]): Promise<Map<number, LockedProduct>> {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: p.id, slug: p.slug })
    .from(p)
    .where(inArray(p.id, ids))
    .orderBy(asc(p.id))
    .for("no key update");
  return new Map(rows.map((row) => [row.id, row]));
}

// ---------------------------------------------------------------------------------------------
// Eligibility helpers

type ReviewableProduct = { id: number; slug: string };

/** An active, non-sample product, or null. */
async function reviewableProduct(tx: Tx, productId: number): Promise<ReviewableProduct | null> {
  const [row] = await tx
    .select({ id: p.id, slug: p.slug, status: p.status, type: p.type })
    .from(p)
    .where(eq(p.id, productId))
    .limit(1);
  if (!row || row.status !== "active" || row.type === "sample") return null;
  return { id: row.id, slug: row.slug };
}

type LinkOrder = { id: number; userId: string | null; fullName: string };

/** The order of a review link when it is delivered and contains the product (not as a sample). */
async function deliveredOrderWithProduct(tx: Tx, orderId: number, productId: number): Promise<LinkOrder | null> {
  const [row] = await tx
    .select({ id: o.id, userId: o.userId, status: o.status, shippingAddress: o.shippingAddress })
    .from(o)
    .where(
      and(
        eq(o.id, orderId),
        sql`exists (select 1 from order_items oi where oi.order_id = ${o.id} and not oi.is_sample and (oi.snapshot->>'productId')::int = ${productId})`,
      ),
    )
    .limit(1);
  if (!row || row.status !== "delivered") return null;
  return { id: row.id, userId: row.userId, fullName: row.shippingAddress?.fullName ?? "" };
}

/** The customer's latest delivered order with the product that has no review for it yet. */
async function purchasedOrderFor(tx: Tx, userId: string, productId: number): Promise<number | null> {
  const [row] = await tx
    .select({ id: o.id })
    .from(o)
    .where(
      and(
        eq(o.userId, userId),
        eq(o.status, "delivered"),
        sql`exists (select 1 from order_items oi where oi.order_id = ${o.id} and not oi.is_sample and (oi.snapshot->>'productId')::int = ${productId})`,
        sql`not exists (select 1 from reviews rv where rv.product_id = ${productId} and rv.order_id = ${o.id})`,
      ),
    )
    .orderBy(desc(o.deliveredAt), desc(o.id))
    .limit(1);
  return row?.id ?? null;
}

type OwnReview = {
  id: number;
  userId: string | null;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  isVerifiedPurchase: boolean;
};

/**
 * The customer's review of the product: written while signed in, or through the link of one of their
 * own orders. `lock` takes FOR UPDATE (before an edit).
 */
async function findOwnReview(tx: Tx, userId: string, productId: number, lock = false): Promise<OwnReview | null> {
  const query = tx
    .select({
      id: r.id,
      userId: r.userId,
      status: r.status,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: r.authorName,
      isVerifiedPurchase: r.isVerifiedPurchase,
    })
    .from(r)
    .where(
      and(
        eq(r.productId, productId),
        or(eq(r.userId, userId), sql`${r.orderId} in (select id from orders where user_id = ${userId})`),
      ),
    )
    .orderBy(sql`(${r.userId} is not null) desc`, desc(r.id))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

const draftOf = (own: OwnReview): OwnReviewDraft => ({
  rating: own.rating,
  title: own.title ?? "",
  body: own.body ?? "",
  displayName: own.authorName,
});

// ---------------------------------------------------------------------------------------------
// The form island

export type ReviewFormRequest = { productId: number; token?: string | null };

/** What the review form shows for this visitor (see ReviewFormState). */
export async function reviewFormState(
  tx: Tx,
  request: ReviewFormRequest,
  viewer: ReviewViewer,
  settings: ReviewSettings,
): Promise<ReviewFormState> {
  if (!settings.enabled) return { status: "disabled" };
  const product = await reviewableProduct(tx, request.productId);
  if (!product) return { status: "disabled" };

  if (request.token && settings.allowGuestLinks) {
    const link = await linkFormState(tx, request.token, product.id, viewer);
    // A signed-in visitor with an unusable link can still review from their account.
    if (link.status !== "link_error" || !viewer) return link;
  }
  if (!viewer) return { status: "signed_out" };
  return accountFormState(tx, product.id, viewer);
}

async function linkFormState(tx: Tx, token: string, productId: number, viewer: ReviewViewer): Promise<ReviewFormState> {
  const link = readReviewToken(token);
  if (!link.ok) return { status: "link_error", reason: link.reason === "expired" ? "expired" : "invalid" };
  if (link.productId !== productId) return { status: "link_error", reason: "invalid" };
  const order = await deliveredOrderWithProduct(tx, link.orderId, productId);
  if (!order) return { status: "link_error", reason: "not_eligible" };
  if (viewer && order.userId === viewer.userId) return accountFormState(tx, productId, viewer, true);
  const [used] = await tx
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.productId, productId), eq(r.orderId, order.id)))
    .limit(1);
  if (used) return { status: "link_error", reason: "used" };
  return { status: "ready", via: "link", defaultName: initialsOf(order.fullName), verified: true, existing: null };
}

async function accountFormState(tx: Tx, productId: number, viewer: NonNullable<ReviewViewer>, viaLink = false): Promise<ReviewFormState> {
  const own = await findOwnReview(tx, viewer.userId, productId);
  if (own && own.status !== "pending") return { status: "reviewed", reviewStatus: own.status };
  const verified = own ? own.isVerifiedPurchase : (await purchasedOrderFor(tx, viewer.userId, productId)) !== null;
  return {
    status: "ready",
    via: viaLink ? "link" : "account",
    defaultName: initialsOf(viewer.name),
    verified: verified || viaLink,
    existing: own ? draftOf(own) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Submitting

export type ReviewSubmitOutcome =
  | { ok: true; reviewId: number; updated: boolean; verified: boolean }
  | { ok: false; error: ReviewSubmitError };

const fail = (error: ReviewSubmitError): ReviewSubmitOutcome => ({ ok: false, error });

/**
 * Stores a review (status pending) or updates the visitor's pending one. `data` comes from
 * parseReviewSubmission (already cleaned); `anonymousName` is used when neither the form nor the
 * account has a name (localized "a customer").
 */
export async function submitReview(
  tx: Tx,
  data: ParsedReview,
  viewer: ReviewViewer,
  settings: ReviewSettings,
  options: { anonymousName: string },
): Promise<ReviewSubmitOutcome> {
  if (!settings.enabled) return fail("disabled");
  const product = await reviewableProduct(tx, data.productId);
  if (!product) return fail("not_eligible");

  if (data.token && settings.allowGuestLinks) {
    const link = readReviewToken(data.token);
    const order = link.ok && link.productId === product.id ? await deliveredOrderWithProduct(tx, link.orderId, product.id) : null;
    if (order) {
      if (viewer && order.userId === viewer.userId) return saveAccountReview(tx, data, viewer, product.id, options, order.id);
      return insertLinkReview(tx, data, order, product.id, options);
    }
    if (!viewer) {
      if (!link.ok) return fail(link.reason === "expired" ? "link_expired" : "link_invalid");
      return fail(link.productId === product.id ? "not_eligible" : "link_invalid");
    }
    // Signed in with an unusable link: review from the account instead.
  }
  if (!viewer) return fail("signed_out");
  return saveAccountReview(tx, data, viewer, product.id, options, null);
}

async function insertLinkReview(
  tx: Tx,
  data: ParsedReview,
  order: LinkOrder,
  productId: number,
  options: { anonymousName: string },
): Promise<ReviewSubmitOutcome> {
  const [row] = await tx
    .insert(r)
    .values({
      productId,
      userId: null,
      orderId: order.id,
      authorName: data.displayName ?? (initialsOf(order.fullName) || options.anonymousName),
      rating: data.rating,
      title: data.title,
      body: data.body,
      locale: data.locale,
      status: "pending",
      isVerifiedPurchase: true,
    })
    .onConflictDoNothing()
    .returning({ id: r.id });
  // The (product, order) pair already has a review: the link was used before.
  return row ? { ok: true, reviewId: row.id, updated: false, verified: true } : fail("already_reviewed");
}

async function saveAccountReview(
  tx: Tx,
  data: ParsedReview,
  viewer: NonNullable<ReviewViewer>,
  productId: number,
  options: { anonymousName: string },
  linkOrderId: number | null,
): Promise<ReviewSubmitOutcome> {
  const own = await findOwnReview(tx, viewer.userId, productId, true);
  if (own) {
    if (own.status !== "pending") return fail("already_reviewed");
    const [row] = await tx
      .update(r)
      .set({
        rating: data.rating,
        title: data.title,
        body: data.body,
        authorName: data.displayName ?? own.authorName,
        locale: data.locale,
        // A pending review written through the link of the customer's own order becomes theirs.
        userId: viewer.userId,
      })
      .where(and(eq(r.id, own.id), eq(r.status, "pending")))
      .returning({ id: r.id });
    return row ? { ok: true, reviewId: row.id, updated: true, verified: own.isVerifiedPurchase } : fail("already_reviewed");
  }

  const orderId = linkOrderId ?? (await purchasedOrderFor(tx, viewer.userId, productId));
  const [row] = await tx
    .insert(r)
    .values({
      productId,
      userId: viewer.userId,
      orderId,
      authorName: data.displayName ?? (initialsOf(viewer.name) || options.anonymousName),
      rating: data.rating,
      title: data.title,
      body: data.body,
      locale: data.locale,
      status: "pending",
      isVerifiedPurchase: orderId !== null,
    })
    .onConflictDoNothing()
    .returning({ id: r.id });
  // A concurrent submit of the same customer won the unique index.
  return row ? { ok: true, reviewId: row.id, updated: false, verified: orderId !== null } : fail("already_reviewed");
}

// ---------------------------------------------------------------------------------------------
// Moderation (panel, editor+)

export type ModerationResult = {
  /** Reviews whose state actually changed. */
  changed: number;
  /** Cache tags to expire: reviews:<id> + product:<slug> per product, and `products` when a rating changed (cards). */
  tags: string[];
  audit: AuditEntry[];
};

type ReviewRow = {
  id: number;
  productId: number;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  adminReply: string | null;
  updatedAt: Date;
};

const reviewColumns = {
  id: r.id,
  productId: r.productId,
  status: r.status,
  rating: r.rating,
  title: r.title,
  body: r.body,
  authorName: r.authorName,
  adminReply: r.adminReply,
  updatedAt: r.updatedAt,
};

/**
 * Locks the products of the given reviews, then the reviews (both in id order, so two moderators never
 * deadlock), and returns the locked reviews and products. Missing ids are skipped.
 */
async function lockReviews(tx: Tx, ids: number[]): Promise<{ rows: ReviewRow[]; products: Map<number, LockedProduct> }> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  if (unique.length === 0) return { rows: [], products: new Map() };
  const pre = await tx.select({ id: r.id, productId: r.productId }).from(r).where(inArray(r.id, unique));
  if (pre.length === 0) return { rows: [], products: new Map() };
  const products = await lockProducts(
    tx,
    pre.map((x) => x.productId),
  );
  const rows = await tx
    .select(reviewColumns)
    .from(r)
    .where(inArray(
      r.id,
      pre.map((x) => x.id),
    ))
    .orderBy(asc(r.id))
    .for("update");
  return { rows, products };
}

function tagsFor(productIds: Iterable<number>, products: Map<number, LockedProduct>, ratingChanged: boolean): string[] {
  const tags = new Set<string>();
  for (const id of productIds) {
    tags.add(TAGS.reviews(id));
    const slug = products.get(id)?.slug;
    if (slug) tags.add(TAGS.product(slug));
  }
  if (ratingChanged) tags.add(TAGS.products);
  return [...tags];
}

async function recomputeAll(tx: Tx, productIds: Iterable<number>): Promise<boolean> {
  let changed = false;
  for (const id of [...new Set(productIds)].sort((a, b) => a - b)) {
    if ((await recomputeProductRating(tx, id)).changed) changed = true;
  }
  return changed;
}

/** Approves (bulk) or rejects reviews. Already-matching reviews are left alone. */
export async function setReviewStatus(
  tx: Tx,
  /** `expected`: the updatedAt the moderator saw per review (panel actions); a review changed since (e.g. edited by its author) is a conflict. */
  input: { ids: number[]; status: "approved" | "rejected"; expected?: ReadonlyMap<number, Date> },
  now: Date = new Date(),
): Promise<ModerationResult> {
  const { rows, products } = await lockReviews(tx, input.ids);
  if (rows.length === 0) throw new PanelError("not_found", "Yorum bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  if (input.expected) {
    if (rows.length < new Set(input.ids).size) throw new PanelError("conflict", "Seçilen yorumlardan biri silinmiş. Sayfayı yenileyip tekrar deneyin.");
    for (const row of rows) {
      const seen = input.expected.get(row.id);
      if (!seen || row.updatedAt.getTime() !== seen.getTime()) {
        throw new PanelError("conflict", "Yorum siz sayfayı açtıktan sonra değişti (müşteri düzenlemiş olabilir). Güncel metni görmek için sayfayı yenileyin.");
      }
    }
  }
  const changing = rows.filter((row) => row.status !== input.status);
  if (changing.length === 0) return { changed: 0, tags: [], audit: [] };

  await tx
    .update(r)
    .set({ status: input.status, approvedAt: input.status === "approved" ? now : null })
    .where(inArray(
      r.id,
      changing.map((row) => row.id),
    ));

  // Only moves into or out of "approved" change what the storefront shows.
  const affected = new Set(changing.filter((row) => row.status === "approved" || input.status === "approved").map((row) => row.productId));
  const ratingChanged = await recomputeAll(tx, affected);
  return {
    changed: changing.length,
    tags: tagsFor(affected, products, ratingChanged),
    audit: changing.map((row) => ({
      action: "status",
      entity: "review",
      entityId: row.id,
      before: { status: row.status },
      after: { status: input.status, productId: row.productId },
    })),
  };
}

/** Deletes a review for good (confirmed in the panel). */
export async function deleteReview(tx: Tx, input: { id: number }): Promise<ModerationResult> {
  const { rows, products } = await lockReviews(tx, [input.id]);
  const row = rows[0];
  if (!row) throw new PanelError("not_found", "Yorum bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  await tx.delete(r).where(eq(r.id, row.id));
  const wasPublic = row.status === "approved";
  const ratingChanged = wasPublic ? await recomputeAll(tx, [row.productId]) : false;
  return {
    changed: 1,
    tags: wasPublic ? tagsFor([row.productId], products, ratingChanged) : [],
    audit: [
      {
        action: "delete",
        entity: "review",
        entityId: row.id,
        before: {
          productId: row.productId,
          status: row.status,
          rating: row.rating,
          authorName: row.authorName,
          title: row.title,
          body: row.body,
          adminReply: row.adminReply,
        },
      },
    ],
  };
}

/** Sets or removes (empty) the shop's public reply. Locked by the review's updated_at. */
export async function replyToReview(
  tx: Tx,
  input: { id: number; reply: string | null; updatedAt: Date },
): Promise<ModerationResult & { updatedAt: Date; reply: string | null }> {
  const [row] = await tx.select(reviewColumns).from(r).where(eq(r.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found", "Yorum bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  assertFresh(row.updatedAt, input.updatedAt);
  const reply = cleanMultiline(input.reply ?? "") || null;
  if (reply && textLength(reply) > REVIEW_LIMITS.reply) {
    throw fieldError("reply", `Yanıt en fazla ${REVIEW_LIMITS.reply.toLocaleString("tr-TR")} karakter olabilir.`);
  }
  if (reply === row.adminReply) return { changed: 0, tags: [], audit: [], updatedAt: row.updatedAt, reply };

  const [saved] = await tx.update(r).set({ adminReply: reply }).where(eq(r.id, row.id)).returning({ updatedAt: r.updatedAt });
  let tags: string[] = [];
  if (row.status === "approved") {
    const [product] = await tx.select({ id: p.id, slug: p.slug }).from(p).where(eq(p.id, row.productId)).limit(1);
    tags = tagsFor([row.productId], new Map(product ? [[product.id, product]] : []), false);
  }
  return {
    changed: 1,
    tags,
    audit: [{ action: "update", entity: "review", entityId: row.id, before: { adminReply: row.adminReply }, after: { adminReply: reply } }],
    updatedAt: saved.updatedAt,
    reply,
  };
}
