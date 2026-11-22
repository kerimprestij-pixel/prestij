// What /hesap/kurumsal shows the signed-in customer: their own company application (status, group,
// terms, rejection reason) and the values to prefill the form with. Only the caller's own rows.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import type { BusinessSector, CompanyStatus } from "@/db/schema/commerce";
import { loadCommerceSettings, type DbExecutor } from "@/lib/cart/settings";
import { formatBusinessPhone, readApplicationDetails, readCompanyAddress, deferredDaysOf, type MonthlyVolume } from "./application";
import { isStaffUserRole } from "./service";

export type BusinessAccountView = {
  b2bEnabled: boolean;
  isStaff: boolean;
  user: { name: string; email: string; phone: string | null };
  company: {
    id: number;
    name: string;
    sector: BusinessSector;
    status: CompanyStatus;
    isApplicant: boolean;
    submittedAt: string;
    groupName: LocalizedText | null;
    deferredDays: number | null;
    pricesExVat: boolean;
    rejectionReason: string | null;
    taxOffice: string | null;
    taxNumber: string | null;
    city: string | null;
    district: string | null;
  } | null;
  /** Form defaults: the previous application (to resubmit after a rejection) or the account data. */
  defaults: Record<string, string>;
};

export async function loadBusinessAccount(userId: string, executor: DbExecutor = db): Promise<BusinessAccountView | null> {
  const u = schema.user;
  const [user] = await executor
    .select({ name: u.name, email: u.email, phone: u.phone, role: u.role, banned: u.banned, companyId: u.companyId })
    .from(u)
    .where(eq(u.id, userId));
  if (!user || user.banned) return null;
  const [settings, row] = await Promise.all([
    loadCommerceSettings(executor),
    user.companyId != null
      ? executor
          .select({ company: schema.companies, groupName: schema.customerGroups.name, pricesExVat: schema.customerGroups.showPricesExVat })
          .from(schema.companies)
          .leftJoin(schema.customerGroups, eq(schema.customerGroups.id, schema.companies.groupId))
          .where(eq(schema.companies.id, user.companyId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const c = row?.company ?? null;
  const address = c ? readCompanyAddress(c.address) : null;
  const details = c ? readApplicationDetails(c.address) : null;
  const defaults: Record<string, string> = c
    ? {
        companyName: c.name,
        sector: c.sector,
        taxOffice: c.taxOffice ?? "",
        taxNumber: c.taxNumber ?? "",
        phone: formatBusinessPhone(c.phone),
        email: c.email ?? user.email,
        website: c.website ?? "",
        "address.city": address?.city ?? "",
        "address.district": address?.district ?? "",
        "address.line1": address?.line1 ?? "",
        "address.postalCode": address?.postalCode ?? "",
        monthlyVolume: (details?.monthlyVolume ?? "") as MonthlyVolume | "",
        note: details?.note ?? "",
      }
    : { email: user.email, phone: formatBusinessPhone(user.phone) };

  return {
    b2bEnabled: settings.b2b.enabled,
    isStaff: isStaffUserRole(user.role),
    user: { name: user.name, email: user.email, phone: user.phone },
    company: c
      ? {
          id: c.id,
          name: c.name,
          sector: c.sector,
          status: c.status,
          isApplicant: c.applicantUserId === userId,
          submittedAt: c.updatedAt.toISOString(),
          groupName: c.status === "approved" ? (row?.groupName ?? null) : null,
          deferredDays: c.status === "approved" ? deferredDaysOf(c.paymentTerms) : null,
          pricesExVat: c.status === "approved" && Boolean(row?.pricesExVat),
          rejectionReason: c.status === "rejected" ? c.rejectionReason : null,
          taxOffice: c.taxOffice,
          taxNumber: c.taxNumber,
          city: address?.city ?? null,
          district: address?.district ?? null,
        }
      : null,
    defaults,
  };
}
