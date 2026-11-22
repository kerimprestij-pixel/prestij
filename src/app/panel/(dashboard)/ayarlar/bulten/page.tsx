import type { Metadata } from "next";
import NewsletterSettingsForm from "@/components/panel/settings/NewsletterSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "E-bülten · Ayarlar" };

export default function NewsletterSettingsPage() {
  return (
    <SettingsPageFrame slug="bulten">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const row = await readSettingsRow("newsletter");
  return <NewsletterSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} />;
}
