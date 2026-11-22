import type { Metadata } from "next";
import { Suspense } from "react";
import GroupManager from "@/components/panel/b2b/GroupManager";
import { B2bSectionTabs } from "@/components/panel/b2b/shared";
import PageHeader from "@/components/panel/PageHeader";
import { TableSkeleton } from "@/components/panel/Skeleton";
import { describeGroupUsage, pendingCompanyCount } from "@/lib/b2b/service";
import { listGroupsWithUsage } from "@/lib/b2b/queries";
import { db } from "@/db";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Müşteri Grupları" };

export default function GroupsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Kurumsal Hesaplar"
        title="Müşteri Grupları"
        description="Kurumsal ve özel fiyat grupları. Bir firmayı onaylarken bu gruplardan birini seçersiniz; grup fiyatlarını ürün düzenleme sayfasındaki Fiyatlar sekmesinden girersiniz."
      />
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Groups />
      </Suspense>
    </div>
  );
}

async function Groups() {
  const session = await requireStaff();
  const [groups, pending] = await Promise.all([listGroupsWithUsage(), pendingCompanyCount(db)]);
  return (
    <>
      <B2bSectionTabs current="groups" pending={pending} />
      <GroupManager
        canEdit={hasRole(session.staffRole, "admin")}
        groups={groups.map((g) => ({
          id: g.id,
          slug: g.slug,
          name: g.name,
          isBusiness: g.isBusiness,
          discountPercent: g.discountPercent,
          showPricesExVat: g.showPricesExVat,
          updatedAt: g.updatedAt,
          usage: describeGroupUsage(g.usage),
          isDefault: g.usage.isDefault,
        }))}
      />
    </>
  );
}
