import type { Metadata } from "next";
import B2bSettingsForm from "@/components/panel/settings/B2bSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { listCustomerGroups, readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kurumsal satış · Ayarlar" };

export default function B2bSettingsPage() {
  return (
    <SettingsPageFrame slug="kurumsal">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const [row, groups] = await Promise.all([readSettingsRow("b2b"), listCustomerGroups()]);
  return <B2bSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} groups={groups} />;
}
