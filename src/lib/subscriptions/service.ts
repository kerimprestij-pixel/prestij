// Subscription services (no Next request APIs; DB tests call them with a transaction):
// - recordOrderSubscriptions: called by placeOrder inside the order transaction. Kapıda ödeme and
//   havale orders start their subscriptions at once; card orders park them in a
//   `subscription_pending` order event until the payment succeeds.
// - activatePendingSubscriptions: called while the order row is locked when a card payment succeeds
//   (completeCardPayment) or staff mark it paid. Idempotent (`subscription_created` event).
// - changeSubscription: self-service and panel changes (pause, resume, skip, plan, address, cancel).
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { AddressData, InvoiceData, OrderItemSnapshot, PaymentMethod } from "@/db/schema/commerce";
import { isLocale, type Locale } from "@/i18n/config";
import { absoluteUrl, href } from "@/i18n/paths";
import { loadVariantLines } from "@/lib/cart/load";
import type { DbExecutor } from "@/lib/cart/settings";
import { RETAIL_CUSTOMER, type PricedLine } from "@/lib/cart/types";
import { isAnonymizedEmail } from "@/lib/account/service";
import { firstNameOf } from "@/lib/customer/viewer";
import { enqueueEmail } from "@/lib/email";
import type { SubscriptionChangeKind, SubscriptionEmailItem } from "@/lib/email/templates/subscriptions";
import { signToken, verifyToken } from "@/lib/signed-token";
import { firstRunAt, startOfIstanbulDay } from "./schedule";
import type { SubscriptionLineSnapshot, SubscriptionStatus } from "./types";

const subs = schema.subscriptions;
const plans = schema.subscriptionPlans;
const events = schema.orderEvents;

export type SubscriptionItem = { variantId: number; quantity: number };
type PlanRow = typeof plans.$inferSelect;
type SubscriptionRow = typeof subs.$inferSelect;

export const SUBSCRIPTION_SKIP_PURPOSE = "subscription-skip";

export const localeOf = (value: string | null | undefined): Locale => (value && isLocale(value) ? value : "tr");

/** Absolute link to /hesap/abonelikler in the customer's language. */
export function subscriptionManageUrl(locale: Locale): string {
  return absoluteUrl(href(locale, "accountSubscriptions"));
}

// ---------------------------------------------------------------------------------------------
// Skip links (reminder e-mail): valid for the one renewal they were issued for.

export function subscriptionSkipToken(subscriptionId: number, nextRunAt: Date): string {
  const ttl = Math.max(3600, Math.ceil((nextRunAt.getTime() - Date.now()) / 1000) + 86_400);
  return signToken(SUBSCRIPTION_SKIP_PURPOSE, { s: subscriptionId, r: nextRunAt.getTime() }, ttl);
}

/** The subscription and renewal a skip link names, or null when it is forged, expired or malformed. */
export function readSubscriptionSkipToken(token: unknown): { subscriptionId: number; runAt: number } | null {
  const r = verifyToken<{ s?: unknown; r?: unknown }>(SUBSCRIPTION_SKIP_PURPOSE, token);
  if (!r.ok) return null;
  const { s, r: runAt } = r.payload;
  return Number.isSafeInteger(s) && (s as number) > 0 && Number.isSafeInteger(runAt) ? { subscriptionId: s as number, runAt: runAt as number } : null;
}

// ---------------------------------------------------------------------------------------------
// E-mail helpers

/** Products of a subscription for e-mails (current names and images; retail context, no prices). */
export async function emailItems(executor: DbExecutor, items: readonly SubscriptionItem[]): Promise<SubscriptionEmailItem[]> {
  const lines = await loadVariantLines(executor, items, RETAIL_CUSTOMER);
  return lines.map((l) => {
    const d = l.display;
    const detail = [d.subtitle, ...d.variantLabels].filter(Boolean);
    return {
      name: d.name,
      detail: detail.length ? joinLocalized(detail as NonNullable<(typeof detail)[number]>[]) : null,
      quantity: l.quantity,
      imageUrl: d.image?.url ?? null,
      accent: d.accentColor,
    };
  });
}

function joinLocalized(parts: { tr: string; en?: string; ar?: string }[]): { tr: string; en?: string; ar?: string } {
  const pick = (key: "tr" | "en" | "ar") => parts.map((p) => p[key] || p.tr).filter(Boolean).join(" · ");
  return { tr: pick("tr"), en: pick("en"), ar: pick("ar") };
}

async function ownerName(executor: DbExecutor, userId: string): Promise<string> {
  const [row] = await executor.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return firstNameOf(row?.name) ?? "";
}

// ---------------------------------------------------------------------------------------------
// Creation from the first order

export type OrderSubscriptionGroup = { planId: number; items: SubscriptionItem[] };

/** Included paid lines with a plan, grouped by plan (one subscription per plan). */
export function subscriptionGroups(lines: readonly Pick<PricedLine, "included" | "isSample" | "variantId" | "quantity" | "subscription">[]): OrderSubscriptionGroup[] {
  const groups = new Map<number, SubscriptionItem[]>();
  for (const l of lines) {
    if (!l.included || l.isSample || !l.subscription) continue;
    const list = groups.get(l.subscription.planId) ?? [];
    const same = list.find((i) => i.variantId === l.variantId);
    if (same) same.quantity += l.quantity;
    else list.push({ variantId: l.variantId, quantity: l.quantity });
    groups.set(l.subscription.planId, list);
  }
  return [...groups.entries()].map(([planId, items]) => ({ planId, items }));
}

export type RecordOrderSubscriptionsInput = {
  orderId: number;
  userId: string | null;
  email: string;
  locale: string;
  paymentMethod: PaymentMethod;
  shippingAddress: AddressData;
  invoice: InvoiceData;
  /** The priced lines of the order (CartTotals.lines). */
  lines: readonly PricedLine[];
  now: Date;
};

/**
 * Called by placeOrder inside its transaction, after the order items exist. Marks subscribed lines in
 * the item snapshots; then starts the subscriptions (kapıda ödeme, havale, vadeli) or, for card orders,
 * records them as pending until the payment succeeds. Returns the created subscription ids.
 */
export async function recordOrderSubscriptions(tx: DbExecutor, input: RecordOrderSubscriptionsInput): Promise<number[]> {
  const groups = subscriptionGroups(input.lines);
  if (groups.length === 0 || !input.userId) return [];

  // Order item snapshots name the plan (order page, panel, renewals of the same order).
  for (const line of input.lines) {
    if (!line.included || line.isSample || !line.subscription) continue;
    const snap: SubscriptionLineSnapshot = { planId: line.subscription.planId, percent: line.subscription.percent, discount: line.subscription.discount };
    await tx
      .update(schema.orderItems)
      .set({ snapshot: sql`${schema.orderItems.snapshot} || ${JSON.stringify({ subscription: snap })}::jsonb` })
      .where(and(eq(schema.orderItems.orderId, input.orderId), eq(schema.orderItems.variantId, line.variantId), eq(schema.orderItems.isSample, false)));
  }

  if (input.paymentMethod === "card") {
    await tx.insert(events).values({ orderId: input.orderId, type: "subscription_pending", data: { groups } });
    return [];
  }
  return startSubscriptions(tx, { ...input, userId: input.userId, groups });
}

async function startSubscriptions(
  tx: DbExecutor,
  input: Omit<RecordOrderSubscriptionsInput, "lines" | "userId"> & { userId: string; groups: OrderSubscriptionGroup[] },
): Promise<number[]> {
  const planRows = await tx.select().from(plans).where(inArray(plans.id, input.groups.map((g) => g.planId)));
  const byId = new Map(planRows.map((p) => [p.id, p]));
  const locale = localeOf(input.locale);
  const name = await ownerName(tx, input.userId);
  const created: number[] = [];
  for (const group of input.groups) {
    const plan = byId.get(group.planId);
    if (!plan) continue;
    const nextRunAt = firstRunAt(input.now, plan);
    const [row] = await tx
      .insert(subs)
      .values({
        userId: input.userId,
        planId: plan.id,
        status: "active",
        items: group.items,
        shippingAddress: input.shippingAddress,
        invoice: input.invoice,
        nextRunAt,
        lastOrderId: input.orderId,
        email: input.email,
        locale,
        paymentMethod: input.paymentMethod,
      })
      .returning({ id: subs.id });
    created.push(row.id);
    await enqueueEmail(tx, {
      template: "subscription_started",
      to: input.email,
      locale,
      data: {
        name,
        plan: plan.name,
        manageUrl: subscriptionManageUrl(locale),
        date: nextRunAt.toISOString(),
        items: await emailItems(tx, group.items),
        paymentMethod: input.paymentMethod,
      },
      related: { type: "subscription", id: row.id },
      dedupeKey: `subscription:${row.id}:started:customer`,
    });
  }
  if (created.length) await tx.insert(events).values({ orderId: input.orderId, type: "subscription_created", data: { subscriptionIds: created } });
  return created;
}

/**
 * Starts the subscriptions parked by a card order once it is paid. Call it inside the transaction that
 * holds the order row lock (completeCardPayment, the panel's mark_paid). No-op without pending plans
 * or when they were started already. When the account was deleted (anonymized) before the payment
 * landed, nothing starts: a `subscription_skipped` event records why (no renewals, no mails to the
 * old address).
 */
export async function activatePendingSubscriptions(tx: DbExecutor, orderId: number, now: Date = new Date()): Promise<number[]> {
  const rows = await tx
    .select({ type: events.type, data: events.data })
    .from(events)
    .where(and(eq(events.orderId, orderId), inArray(events.type, ["subscription_pending", "subscription_created", "subscription_skipped"])))
    .orderBy(asc(events.id));
  if (rows.some((r) => r.type === "subscription_created" || r.type === "subscription_skipped")) return [];
  const pending = rows.find((r) => r.type === "subscription_pending");
  const groups = parseGroups((pending?.data as { groups?: unknown } | null)?.groups);
  if (groups.length === 0) return [];
  const o = schema.orders;
  const [order] = await tx
    .select({ userId: o.userId, email: o.email, locale: o.locale, paymentMethod: o.paymentMethod, shippingAddress: o.shippingAddress, invoice: o.invoice })
    .from(o)
    .where(eq(o.id, orderId))
    .limit(1);
  if (!order?.userId) return [];
  const [owner] = await tx.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, order.userId)).limit(1);
  if (!owner || isAnonymizedEmail(owner.email)) {
    await tx.insert(events).values({ orderId, type: "subscription_skipped", data: { reason: "account_deleted" } });
    return [];
  }
  return startSubscriptions(tx, { ...order, orderId, userId: order.userId, groups, now });
}

function parseGroups(value: unknown): OrderSubscriptionGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((g) => {
    const planId = (g as { planId?: unknown })?.planId;
    const items = (g as { items?: unknown })?.items;
    if (!Number.isSafeInteger(planId) || !Array.isArray(items)) return [];
    const clean = items.flatMap((i) => {
      const variantId = (i as { variantId?: unknown })?.variantId;
      const quantity = (i as { quantity?: unknown })?.quantity;
      return Number.isSafeInteger(variantId) && Number.isSafeInteger(quantity) && (quantity as number) > 0 ? [{ variantId: variantId as number, quantity: quantity as number }] : [];
    });
    return clean.length ? [{ planId: planId as number, items: clean }] : [];
  });
}

/** The plan stored on an order item snapshot by recordOrderSubscriptions, or null. */
export function snapshotSubscription(snapshot: OrderItemSnapshot): SubscriptionLineSnapshot | null {
  const sub = (snapshot as OrderItemSnapshot & { subscription?: SubscriptionLineSnapshot }).subscription;
  return sub && Number.isSafeInteger(sub.planId) ? sub : null;
}

// ---------------------------------------------------------------------------------------------
// Changes (customer self-service and panel)

export type SubscriptionChange =
  | { kind: "pause" }
  | { kind: "resume" }
  /** `runAt`: the renewal a skip link was issued for (epoch ms); refused when the renewal moved. */
  | { kind: "skip"; runAt?: number }
  | { kind: "unskip" }
  | { kind: "plan"; planId: number }
  | { kind: "address"; address: AddressData }
  | { kind: "cancel" };

export type ChangeActor = { type: "customer"; userId: string } | { type: "staff"; userId: string; role: "staff" | "editor" | "admin" };

export type ChangeResult =
  | {
      ok: true;
      subscriptionId: number;
      kind: SubscriptionChangeKind;
      status: SubscriptionStatus;
      before: Partial<SubscriptionRow>;
      after: Partial<SubscriptionRow>;
      /** False when the subscription_changed template is switched off (or nothing changed). */
      mailQueued: boolean;
    }
  | { ok: false; code: "not_found" | "state" | "plan_unavailable" | "forbidden" };

const STAFF_CHANGES: readonly SubscriptionChange["kind"][] = ["pause", "resume", "cancel"];

const sameAddress = (a: AddressData | null | undefined, b: AddressData | null | undefined) =>
  Boolean(a && b) && JSON.stringify([a!.fullName, a!.city, a!.district, a!.neighbourhood ?? "", a!.line1, a!.postalCode ?? ""]) ===
    JSON.stringify([b!.fullName, b!.city, b!.district, b!.neighbourhood ?? "", b!.line1, b!.postalCode ?? ""]);

/**
 * Applies one change under the subscription row lock and queues the `subscription_changed` mail in the
 * same transaction. A customer only reaches their own subscriptions (anything else is not_found);
 * staff may pause, resume and cancel.
 */
export async function changeSubscription(
  tx: DbExecutor,
  input: { subscriptionId: number; change: SubscriptionChange },
  actor: ChangeActor,
  now: Date = new Date(),
): Promise<ChangeResult> {
  const [row] = await tx.select().from(subs).where(eq(subs.id, input.subscriptionId)).for("update").limit(1);
  if (!row || (actor.type === "customer" && row.userId !== actor.userId)) return { ok: false, code: "not_found" };
  if (actor.type === "staff" && !STAFF_CHANGES.includes(input.change.kind)) return { ok: false, code: "forbidden" };
  const [plan] = await tx.select().from(plans).where(eq(plans.id, row.planId)).limit(1);
  if (!plan) return { ok: false, code: "not_found" };

  const c = input.change;
  let set: Partial<typeof subs.$inferInsert> | null = null;
  let kind: SubscriptionChangeKind;
  let mailPlan: PlanRow = plan;
  let skippedDate: Date | null = null;
  switch (c.kind) {
    case "pause":
      if (row.status !== "active" && row.status !== "past_due") return { ok: false, code: "state" };
      set = { status: "paused" };
      kind = "paused";
      break;
    case "resume": {
      if (row.status !== "paused") return { ok: false, code: "state" };
      // A renewal date that passed while paused restarts one period from today.
      const nextRunAt = row.nextRunAt.getTime() <= now.getTime() ? firstRunAt(now, plan) : row.nextRunAt;
      set = { status: "active", nextRunAt, reminderSentAt: null, failedCount: 0 };
      kind = "resumed";
      break;
    }
    case "skip":
      if (row.status !== "active" || row.skipNext) return { ok: false, code: "state" };
      if (c.runAt != null && c.runAt !== row.nextRunAt.getTime()) return { ok: false, code: "state" };
      set = { skipNext: true };
      kind = "skipped";
      skippedDate = row.nextRunAt;
      break;
    case "unskip":
      if (row.status !== "active" || !row.skipNext) return { ok: false, code: "state" };
      set = { skipNext: false };
      kind = "unskipped";
      break;
    case "plan": {
      if (row.status === "cancelled") return { ok: false, code: "state" };
      if (c.planId === row.planId) return { ok: false, code: "state" };
      const [next] = await tx.select().from(plans).where(and(eq(plans.id, c.planId), eq(plans.isActive, true))).limit(1);
      if (!next) return { ok: false, code: "plan_unavailable" };
      set = { planId: next.id };
      kind = "plan";
      mailPlan = next;
      break;
    }
    case "address": {
      if (row.status === "cancelled") return { ok: false, code: "state" };
      // The same address again (a double submit, a second tab): nothing changes and no second mail goes out.
      if (sameAddress(row.shippingAddress, c.address) && (row.shippingAddress.phone ?? "") === (c.address.phone ?? "")) {
        return { ok: true, subscriptionId: row.id, kind: "address", status: row.status, before: {}, after: {}, mailQueued: false };
      }
      const invoice: InvoiceData = sameAddress(row.invoice.address, row.shippingAddress) ? { ...row.invoice, address: c.address } : row.invoice;
      set = { shippingAddress: c.address, invoice };
      kind = "address";
      break;
    }
    case "cancel":
      if (row.status === "cancelled") return { ok: false, code: "state" };
      set = { status: "cancelled", cancelledAt: now, skipNext: false };
      kind = "cancelled";
      break;
  }

  const [saved] = await tx.update(subs).set({ ...set, updatedAt: now }).where(eq(subs.id, row.id)).returning();
  const locale = localeOf(row.locale);
  const next = saved.status === "cancelled" || saved.status === "paused" ? null : saved.skipNext ? null : saved.nextRunAt;
  const mail = await enqueueEmail(tx, {
    template: "subscription_changed",
    to: row.email,
    locale,
    data: {
      name: await ownerName(tx, row.userId),
      plan: mailPlan.name,
      manageUrl: subscriptionManageUrl(locale),
      kind,
      date: skippedDate ? skippedDate.toISOString() : null,
      next: kind === "skipped" ? null : next ? next.toISOString() : null,
    },
    related: { type: "subscription", id: row.id },
    createdBy: actor.type === "staff" ? actor.userId : null,
  });

  const before: Partial<SubscriptionRow> = {};
  const after: Partial<SubscriptionRow> = {};
  for (const key of Object.keys(set) as (keyof SubscriptionRow)[]) {
    (before as Record<string, unknown>)[key] = row[key];
    (after as Record<string, unknown>)[key] = saved[key];
  }
  return { ok: true, subscriptionId: row.id, kind, status: saved.status, before, after, mailQueued: mail !== null };
}

/** The renewal after a skipped one, for the account page and the skip confirmation. */
export function dayOf(date: Date): Date {
  return startOfIstanbulDay(date);
}
