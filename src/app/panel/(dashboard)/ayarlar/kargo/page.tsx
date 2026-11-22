import type { Metadata } from "next";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import ShippingSettingsForm from "@/components/panel/settings/ShippingSettingsForm";
import { carrierKeysInUse, readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kargo · Ayarlar" };

export default function ShippingSettingsPage() {
  return (
    <SettingsPageFrame slug="kargo">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const [row, carrierUsage] = await Promise.all([readSettingsRow("shipping"), carrierKeysInUse()]);
  return <ShippingSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} carrierUsage={carrierUsage} />;
}
