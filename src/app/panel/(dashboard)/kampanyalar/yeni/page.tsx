import type { Metadata } from "next";
import { Suspense } from "react";
import CampaignEditor, { NEW_CAMPAIGN } from "@/components/panel/marketing/CampaignEditor";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { customerGroupOptions, themeOptions } from "@/lib/panel/marketing/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni kampanya" };

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <NewCampaign />
    </Suspense>
  );
}

async function NewCampaign() {
  await requireStaff("editor");
  const [groups, themes] = await Promise.all([customerGroupOptions(), themeOptions()]);
  return <CampaignEditor initial={NEW_CAMPAIGN} groups={groups} themes={themes} status={null} />;
}
