import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CampaignEditor, { type CampaignState } from "@/components/panel/marketing/CampaignEditor";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { customerGroupOptions, getPanelCampaign, themeOptions } from "@/lib/panel/marketing/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kampanya" };

type Params = Promise<{ id: string }>;

export default function CampaignPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Campaign params={params} />
    </Suspense>
  );
}

async function Campaign({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) notFound();
  const [row, groups, themes] = await Promise.all([getPanelCampaign(numeric), customerGroupOptions(), themeOptions()]);
  if (!row) notFound();
  const initial: CampaignState = {
    id: row.id,
    name: row.name,
    label: row.label,
    discountPercent: row.discountPercent,
    productIds: row.productIds,
    categoryIds: row.categoryIds,
    customerGroupIds: row.customerGroupIds,
    schedule: row.schedule,
    priority: row.priority,
    isActive: row.isActive,
    themeId: row.themeId,
    updatedAt: row.updatedAt,
  };
  return <CampaignEditor key={row.id} initial={initial} groups={groups} themes={themes} status={row.status} />;
}
