// Pure rules that turn a user + company + group into the pricing context (unit-tested).
import type { CompanyStatus } from "@/db/schema/commerce";
import { RETAIL_CUSTOMER, type CustomerContext } from "@/lib/cart/types";

export type CustomerSources = {
  user: { id: string; customerGroupId: number | null; companyId: number | null } | null;
  company: {
    id: number;
    status: CompanyStatus;
    groupId: number | null;
    paymentTerms: { allowDeferred?: boolean; days?: number } | null;
  } | null;
  /** The group named by user.customerGroupId, else by company.groupId. */
  group: { id: number; slug: string; discountPercent: number; isBusiness: boolean; showPricesExVat: boolean } | null;
  b2b: { enabled: boolean; requireApproval: boolean };
};

/**
 * - No user → retail.
 * - The user's own group wins over the company's group.
 * - B2B disabled → no group pricing at all.
 * - b2b.requireApproval → the group applies only when the user's company is approved.
 * - Deferred payment needs an approved company whose paymentTerms.allowDeferred is set.
 */
export function resolveCustomerContext(src: CustomerSources): CustomerContext {
  if (!src.user) return { ...RETAIL_CUSTOMER };
  const company = src.company && src.company.id === src.user.companyId ? src.company : null;
  const companyApproved = company?.status === "approved";
  const groupAllowed = src.b2b.enabled && src.group != null && (!src.b2b.requireApproval || companyApproved);
  const group = groupAllowed ? src.group : null;
  const pct = group ? Math.min(100, Math.max(0, Math.round(group.discountPercent || 0))) : 0;
  const allowDeferred = Boolean(src.b2b.enabled && companyApproved && company?.paymentTerms?.allowDeferred);
  return {
    userId: src.user.id,
    groupId: group?.id ?? null,
    groupSlug: group?.slug ?? null,
    groupDiscountPercent: pct,
    isBusiness: Boolean(group?.isBusiness || companyApproved),
    showPricesExVat: Boolean(group?.showPricesExVat),
    companyId: company?.id ?? null,
    companyApproved,
    allowDeferred,
    deferredDays: allowDeferred ? (company?.paymentTerms?.days ?? null) : null,
  };
}
