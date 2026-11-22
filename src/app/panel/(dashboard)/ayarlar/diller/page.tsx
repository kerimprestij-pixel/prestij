import type { Metadata } from "next";
import LocaleSettingsForm from "@/components/panel/settings/LocaleSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Diller · Ayarlar" };

export default function LocaleSettingsPage() {
  return (
    <SettingsPageFrame slug="diller">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const row = await readSettingsRow("locales");
  return <LocaleSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} />;
}
