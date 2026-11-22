import type { Metadata } from "next";
import { Suspense } from "react";
import SettingsOverview, { SettingsOverviewSkeleton } from "@/components/panel/settings/SettingsOverview";
import { readAllSettings } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ayarlar" };

export default function SettingsIndexPage() {
  return (
    <Suspense fallback={<SettingsOverviewSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  await requireStaff("admin");
  return <SettingsOverview settings={await readAllSettings()} />;
}
