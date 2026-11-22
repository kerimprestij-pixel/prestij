import type { Metadata } from "next";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import WhatsappSettingsForm from "@/components/panel/settings/WhatsappSettingsForm";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "WhatsApp · Ayarlar" };

export default function WhatsappSettingsPage() {
  return (
    <SettingsPageFrame slug="whatsapp">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const row = await readSettingsRow("whatsapp");
  return <WhatsappSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} />;
}
