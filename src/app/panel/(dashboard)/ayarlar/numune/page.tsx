import type { Metadata } from "next";
import SampleSettingsForm from "@/components/panel/settings/SampleSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { countActiveSampleProducts, readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Numune · Ayarlar" };

export default function SampleSettingsPage() {
  return (
    <SettingsPageFrame slug="numune">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const [row, sampleProducts] = await Promise.all([readSettingsRow("samples"), countActiveSampleProducts()]);
  return <SampleSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} sampleProducts={sampleProducts} />;
}
