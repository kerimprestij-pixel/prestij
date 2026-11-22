import type { Metadata } from "next";
import GeneralSettingsForm from "@/components/panel/settings/GeneralSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { getPanelMedia } from "@/lib/panel/media/queries";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Firma bilgileri · Ayarlar" };

export default function GeneralSettingsPage() {
  return (
    <SettingsPageFrame slug="genel">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const row = await readSettingsRow("general");
  const ids = [row.value.logo.lightId, row.value.logo.darkId].filter((id): id is number => typeof id === "number");
  const media = await getPanelMedia(ids);
  return <GeneralSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} media={media} />;
}
