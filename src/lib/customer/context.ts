import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { getSession, staffRoleOf } from "@/lib/session";
import { resolveCustomerContext } from "./resolve";

export type { CustomerContext };

/**
 * Pricing context of the current visitor, read fresh from the DB (group and company status can change
 * at any time). Reads request headers: call it only in Server Actions, Route Handlers or inside
 * `<Suspense>`. Never inside "use cache".
 */
export async function getCustomerContext(): Promise<CustomerContext> {
  const session = await getSession();
  if (!session?.user?.id) return { ...RETAIL_CUSTOMER };

  const [user] = await db
    .select({ id: schema.user.id, customerGroupId: schema.user.customerGroupId, companyId: schema.user.companyId, banned: schema.user.banned, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);
  if (!user || user.banned) return { ...RETAIL_CUSTOMER };

  const [company, settings] = await Promise.all([
    user.companyId != null
      ? db
          .select({
            id: schema.companies.id,
            status: schema.companies.status,
            groupId: schema.companies.groupId,
            paymentTerms: schema.companies.paymentTerms,
          })
          .from(schema.companies)
          .where(eq(schema.companies.id, user.companyId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    loadCommerceSettings(),
  ]);

  const groupId = user.customerGroupId ?? company?.groupId ?? null;
  const group =
    groupId != null
      ? await db
          .select({
            id: schema.customerGroups.id,
            slug: schema.customerGroups.slug,
            discountPercent: schema.customerGroups.discountPercent,
            isBusiness: schema.customerGroups.isBusiness,
            showPricesExVat: schema.customerGroups.showPricesExVat,
          })
          .from(schema.customerGroups)
          .where(eq(schema.customerGroups.id, groupId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null;

  const context = resolveCustomerContext({ user, company, group, b2b: settings.b2b });
  // Go-live CF-11: panel staff may pay by card while the test mode is on (to test the provider on the live site).
  return staffRoleOf(user.role) ? { ...context, staff: true } : context;
}
