// Orders in the customer's account: the list (/hesap/siparisler), access to one order (the detail
// page reuses the guest order view through the order's own access token), and linking guest orders
// to an account once its e-mail address is verified. A customer only ever sees orders whose user_id
// is theirs: another customer's order number behaves exactly like an unknown one.
import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { OrderStatus, PaymentMethod } from "@/db/schema/commerce";
import type { MediaLike } from "@/lib/media/types";
import { normalizeOrderNumber } from "@/lib/orders/number";
import type { Tx } from "@/lib/panel/tx";

const o = schema.orders;
const oi = schema.orderItems;

export const ACCOUNT_ORDERS_PAGE_SIZE = 10;

export type AccountOrderListItem = {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  createdAt: string;
  grandTotal: number;
  /** Paid units + samples. */
  itemCount: number;
  /** Up to three lines for the thumbnails. */
  preview: { name: LocalizedText; variant: LocalizedText | null; image: MediaLike | null; accentColor: string | null }[];
  /** More lines than the preview shows. */
  moreLines: number;
};

export type AccountOrderPage = { items: AccountOrderListItem[]; total: number; page: number; pageCount: number; pageSize: number };

/** One page of the user's orders, newest first. */
export async function listAccountOrders(executor: Tx, userId: string, opts: { page?: number; pageSize?: number } = {}): Promise<AccountOrderPage> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(opts.pageSize ?? ACCOUNT_ORDERS_PAGE_SIZE)));
  const [{ n }] = await executor.select({ n: count() }).from(o).where(eq(o.userId, userId));
  const pageCount = Math.max(1, Math.ceil(n / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number.isFinite(opts.page) ? (opts.page as number) : 1)));
  const rows = await executor
    .select({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentMethod: o.paymentMethod,
      createdAt: o.createdAt,
      grandTotal: o.grandTotal,
      breakdown: o.breakdown,
    })
    .from(o)
    .where(eq(o.userId, userId))
    .orderBy(desc(o.createdAt), desc(o.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const ids = rows.map((r) => r.id);
  const lines = ids.length
    ? await executor
        .select({ orderId: oi.orderId, snapshot: oi.snapshot, quantity: oi.quantity, isSample: oi.isSample })
        .from(oi)
        .where(inArray(oi.orderId, ids))
        .orderBy(oi.orderId, oi.isSample, oi.id)
    : [];
  const byOrder = new Map<number, typeof lines>();
  for (const line of lines) byOrder.set(line.orderId, [...(byOrder.get(line.orderId) ?? []), line]);
  return {
    total: n,
    page,
    pageCount,
    pageSize,
    items: rows.map((r) => {
      const own = byOrder.get(r.id) ?? [];
      return {
        orderNumber: r.orderNumber,
        status: r.status,
        paymentMethod: r.paymentMethod,
        createdAt: r.createdAt.toISOString(),
        grandTotal: r.grandTotal,
        itemCount: r.breakdown?.itemCount ?? own.reduce((sum, l) => sum + l.quantity, 0),
        preview: own.slice(0, 3).map((l) => ({
          name: l.snapshot.productName,
          variant: l.snapshot.variantTitle ?? null,
          image: l.snapshot.image ?? null,
          accentColor: l.snapshot.accentColor ?? null,
        })),
        moreLines: Math.max(0, own.length - 3),
      };
    }),
  };
}

/** How many orders are linked to the user. */
export async function countAccountOrders(executor: Tx, userId: string): Promise<number> {
  const [{ n }] = await executor.select({ n: count() }).from(o).where(eq(o.userId, userId));
  return n;
}

/**
 * The access token of one of the user's orders (the detail page renders it with the guest order view
 * via getOrderByToken), or null when the number is malformed, unknown or another customer's.
 */
export async function accountOrderToken(executor: Tx, userId: string, orderNumber: string): Promise<string | null> {
  const number = normalizeOrderNumber(orderNumber);
  if (!number) return null;
  const [row] = await executor
    .select({ accessToken: o.accessToken })
    .from(o)
    .where(and(eq(o.orderNumber, number), eq(o.userId, userId)))
    .limit(1);
  return row?.accessToken ?? null;
}

/**
 * Links guest orders (no user) placed with this e-mail address to the user. Call it only for an
 * address the user has proven to own (after verification, or at a sign-in, which requires a verified
 * address). Returns how many orders were linked. `updated_at` stays as it is: the order itself did
 * not change, and a panel user editing it must not get a false "changed meanwhile" conflict.
 */
export async function linkGuestOrders(tx: Tx, user: { id: string; email: string }): Promise<number> {
  const email = user.email.trim().toLowerCase();
  if (!email || !user.id) return 0;
  const linked = await tx
    .update(o)
    .set({ userId: user.id, updatedAt: sql`${o.updatedAt}` }) // keep it ($onUpdate would bump it)
    .where(and(isNull(o.userId), sql`lower(${o.email}) = ${email}`))
    .returning({ id: o.id });
  return linked.length;
}
