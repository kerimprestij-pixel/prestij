// The pricing context of a subscription's owner, read from the DB (jobs have no session): the same
// rules as getCustomerContext (src/lib/customer/context.ts), through the pure resolveCustomerContext.
import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import type { CommerceSettings, DbExecutor } from "@/lib/cart/settings";
import { resolveCustomerContext } from "@/lib/customer/resolve";

export type SubscriptionOwner = { id: string; name: string; email: string; banned: boolean };

/** The owner row and their pricing context; null when the user no longer exists. */
export async function customerContextForUser(
  executor: DbExecutor,
  userId: string,
  settings: Pick<CommerceSettings, "b2b">,
): Promise<{ owner: SubscriptionOwner; customer: CustomerContext } | null> {
  const u = schema.user;
  const [user] = await executor
    .select({ id: u.id, name: u.name, email: u.email, banned: u.banned, customerGroupId: u.customerGroupId, companyId: u.companyId })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  if (!user) return null;
  const owner: SubscriptionOwner = { id: user.id, name: user.name, email: user.email, banned: Boolean(user.banned) };
  // A banned account keeps its user id (the subscription stays theirs) but gets retail prices.
  if (owner.banned) return { owner, customer: { ...RETAIL_CUSTOMER, userId: user.id } };

  const company =
    user.companyId != null
      ? ((
          await executor
            .select({ id: schema.companies.id, status: schema.companies.status, groupId: schema.companies.groupId, paymentTerms: schema.companies.paymentTerms })
            .from(schema.companies)
            .where(eq(schema.companies.id, user.companyId))
            .limit(1)
        )[0] ?? null)
      : null;
  const groupId = user.customerGroupId ?? company?.groupId ?? null;
  const g = schema.customerGroups;
  const group =
    groupId != null
      ? ((
          await executor
            .select({ id: g.id, slug: g.slug, discountPercent: g.discountPercent, isBusiness: g.isBusiness, showPricesExVat: g.showPricesExVat })
            .from(g)
            .where(eq(g.id, groupId))
            .limit(1)
        )[0] ?? null)
      : null;
  return { owner, customer: resolveCustomerContext({ user, company, group, b2b: settings.b2b }) };
}
