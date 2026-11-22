// The review request e-mail (job reviews.request, daily). For delivered orders whose delivery is
// `requestDaysAfterDelivery` days old (and at most REVIEW_REQUEST_MAX_AGE_DAYS older than that, so
// switching the feature on never mails old customers), queue one `review_request` per order with a
// signed link per product that the customer has not reviewed yet, and stamp
// orders.review_requested_at. Idempotent and safe to run twice at once: rows are claimed with
// FOR UPDATE SKIP LOCKED, the stamp is set in the same transaction as the mail, and the mail has the
// dedupe key order:<id>:review_request:customer.
import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { schema } from "@/db";
import { isLocale, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { isAnonymizedEmail } from "@/lib/account/service";
import { firstNameOf } from "@/lib/customer/viewer";
import { enqueueEmail } from "@/lib/email";
import type { ReviewRequestProduct } from "@/lib/email/templates/reviews";
import { variantUrl, type MediaLike } from "@/lib/media/types";
import type { Tx } from "@/lib/panel/tx";
import { loadReviewSettings } from "./service";
import { createReviewToken, reviewLinkPath, reviewsSectionPath } from "./tokens";
import { REVIEW_LINK_TTL_DAYS, REVIEW_REQUEST_BATCH, REVIEW_REQUEST_MAX_AGE_DAYS } from "./types";

const o = schema.orders;
const oi = schema.orderItems;
const p = schema.products;
const r = schema.reviews;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewRequestRun = { queued: number; skipped: number; disabled: number };

export type ReviewRequestOptions = {
  now?: Date;
  limit?: number;
  /** Tests: only these orders (the shared database holds other agents' orders). */
  orderIds?: number[];
};

/** Smallest WebP variant that is at least 128 px wide (64×64 at 2×), else the fallback URL. */
export function emailImageUrl(media: MediaLike | null | undefined): string | null {
  if (!media) return null;
  const webp = (media.variants ?? []).filter((v) => v.format === "webp").sort((a, b) => a.width - b.width);
  const pick = webp.find((v) => v.width >= 128) ?? webp[webp.length - 1];
  if (pick) return variantUrl(media, pick.key);
  return /\.(webp|png|jpe?g)$/i.test(media.url) ? media.url : null;
}

/**
 * Queues the due review requests. `executor` is `db` (the job) or a test transaction (a savepoint is
 * used then). Returns counts only.
 */
export async function sendDueReviewRequests(executor: Tx, options: ReviewRequestOptions = {}): Promise<ReviewRequestRun> {
  const now = options.now ?? new Date();
  const settings = await loadReviewSettings(executor);
  if (!settings.enabled) return { queued: 0, skipped: 0, disabled: 1 };

  const dueBefore = new Date(now.getTime() - settings.requestDaysAfterDelivery * DAY_MS);
  const notBefore = new Date(dueBefore.getTime() - REVIEW_REQUEST_MAX_AGE_DAYS * DAY_MS);
  const limit = Math.max(1, Math.min(REVIEW_REQUEST_BATCH, options.limit ?? REVIEW_REQUEST_BATCH));

  return executor.transaction(async (tx) => {
    const orders = await tx
      .select({ id: o.id, orderNumber: o.orderNumber, email: o.email, locale: o.locale, userId: o.userId, shippingAddress: o.shippingAddress })
      .from(o)
      .where(
        and(
          eq(o.status, "delivered"),
          isNull(o.reviewRequestedAt),
          lte(o.deliveredAt, dueBefore),
          gte(o.deliveredAt, notBefore),
          options.orderIds ? inArray(o.id, options.orderIds.length ? options.orderIds : [0]) : undefined,
        ),
      )
      .orderBy(asc(o.deliveredAt), asc(o.id))
      .limit(limit)
      .for("update", { skipLocked: true });

    // Customers who deleted their account (anonymized, KVKK) are not mailed again.
    const userIds = [...new Set(orders.map((x) => x.userId).filter((id): id is string => !!id))];
    const deleted = new Set(
      userIds.length
        ? (await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(inArray(schema.user.id, userIds)))
            .filter((u) => isAnonymizedEmail(u.email))
            .map((u) => u.id)
        : [],
    );

    let queued = 0;
    let skipped = 0;
    for (const order of orders) {
      if (order.userId && deleted.has(order.userId)) {
        await tx.update(o).set({ reviewRequestedAt: now }).where(eq(o.id, order.id));
        skipped++;
        continue;
      }
      const locale: Locale = isLocale(order.locale) ? order.locale : "tr";
      const products = await productsToReview(tx, order, locale, settings.allowGuestLinks);
      await tx.update(o).set({ reviewRequestedAt: now }).where(eq(o.id, order.id));
      // Nothing left to review, or a guest order while review links are switched off.
      if (products.length === 0 || (!settings.allowGuestLinks && !order.userId)) {
        skipped++;
        continue;
      }
      const mail = await enqueueEmail(tx, {
        template: "review_request",
        to: order.email,
        locale,
        data: {
          name: firstNameOf(order.shippingAddress?.fullName) ?? "",
          orderNumber: order.orderNumber,
          products,
          personalLinks: settings.allowGuestLinks,
          linkDays: REVIEW_LINK_TTL_DAYS,
        },
        related: { type: "order", id: order.id },
        dedupeKey: `order:${order.id}:review_request:customer`,
      });
      // null: the template is switched off in the panel, or the mail was queued before.
      if (mail) queued++;
      else skipped++;
    }
    return { queued, skipped, disabled: 0 };
  });
}

type RequestOrder = { id: number; userId: string | null };

/** The order's active, non-sample products that this customer (order or account) has not reviewed. */
async function productsToReview(tx: Tx, order: RequestOrder, locale: Locale, personalLinks: boolean): Promise<ReviewRequestProduct[]> {
  const items = await tx
    .select({ snapshot: oi.snapshot, quantity: oi.quantity })
    .from(oi)
    .where(and(eq(oi.orderId, order.id), eq(oi.isSample, false)))
    .orderBy(asc(oi.id));
  const byProduct = new Map<number, { quantity: number; variants: Set<string>; image: MediaLike | null; variantTitle: string }>();
  for (const item of items) {
    const productId = Number(item.snapshot?.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;
    const entry = byProduct.get(productId) ?? { quantity: 0, variants: new Set<string>(), image: item.snapshot.image ?? null, variantTitle: "" };
    entry.quantity += item.quantity;
    const title = localize(item.snapshot.variantTitle, locale);
    entry.variants.add(title);
    entry.variantTitle = title;
    entry.image ??= item.snapshot.image ?? null;
    byProduct.set(productId, entry);
  }
  if (byProduct.size === 0) return [];

  const ids = [...byProduct.keys()];
  const [products, reviewed] = await Promise.all([
    tx
      .select({ id: p.id, slug: p.slug, name: p.name, subtitle: p.subtitle, accentColor: p.accentColor })
      .from(p)
      .where(and(inArray(p.id, ids), eq(p.status, "active"), ne(p.type, "sample"))),
    tx
      .select({ productId: r.productId })
      .from(r)
      .where(
        and(
          inArray(r.productId, ids),
          order.userId
            ? or(eq(r.orderId, order.id), eq(r.userId, order.userId), sql`${r.orderId} in (select id from orders where user_id = ${order.userId})`)
            : eq(r.orderId, order.id),
        ),
      ),
  ]);
  const done = new Set(reviewed.map((row) => row.productId));
  const byId = new Map(products.map((row) => [row.id, row]));

  const out: ReviewRequestProduct[] = [];
  for (const id of ids) {
    const product = byId.get(id);
    const entry = byProduct.get(id);
    if (!product || !entry || done.has(id)) continue;
    const subtitle = localize(product.subtitle, locale);
    const variant = entry.variants.size === 1 ? entry.variantTitle : "";
    out.push({
      name: localize(product.name, locale),
      detail: [subtitle, variant].filter(Boolean).join(" · ") || null,
      imageUrl: emailImageUrl(entry.image),
      accent: product.accentColor,
      quantity: entry.quantity,
      url: personalLinks ? reviewLinkPath(locale, product.slug, createReviewToken(order.id, product.id)) : reviewsSectionPath(locale, product.slug),
    });
  }
  return out;
}
