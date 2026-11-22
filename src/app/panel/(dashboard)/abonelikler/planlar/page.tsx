import type { Metadata } from "next";
import { Suspense } from "react";
import Notice from "@/components/panel/Notice";
import PageHeader from "@/components/panel/PageHeader";
import { TableSkeleton } from "@/components/panel/Skeleton";
import PlanEditor from "@/components/panel/subscriptions/PlanEditor";
import SectionTabs from "@/components/panel/subscriptions/SectionTabs";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";
import { listPanelPlans } from "@/lib/subscriptions/queries";

export const metadata: Metadata = { title: "Abonelik planları" };

export default function PlansPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Abonelikler"
        description="Müşterilerin seçebileceği teslimat sıklıkları ve abone indirimleri."
      />
      <SectionTabs active="plans" />
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <Plans />
      </Suspense>
    </div>
  );
}

async function Plans() {
  const { staffRole } = await requireStaff("staff");
  const plans = await listPanelPlans();
  const canEdit = hasRole(staffRole, "admin");
  return (
    <>
      {!canEdit ? <Notice tone="info">Planları yalnızca yöneticiler düzenleyebilir.</Notice> : null}
      <PlanEditor plans={plans} canEdit={canEdit} />
    </>
  );
}
