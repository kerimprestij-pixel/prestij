import type { Metadata } from "next";
import SeoSettingsForm from "@/components/panel/settings/SeoSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { siteOrigin } from "@/i18n/paths";
import { getPanelMedia } from "@/lib/panel/media/queries";
import { indexNowKeyState, isLocalOrigin, seoToolUrls } from "@/lib/panel/seo/launch";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "SEO ve paylaşım · Ayarlar" };

export default function SeoSettingsPage() {
  return (
    <SettingsPageFrame slug="seo">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const row = await readSettingsRow("seo");
  const media = row.value.ogImageId ? await getPanelMedia([row.value.ogImageId]) : [];
  const origin = siteOrigin();
  return (
    <SeoSettingsForm
      initial={{ ...row.value, updatedAt: row.updatedAt }}
      media={media}
      siteUrl={origin}
      tools={seoToolUrls(origin)}
      // Only whether the key is set reaches the page, never the key itself.
      indexNow={indexNowKeyState(process.env.INDEXNOW_KEY)}
      siteIsLocal={isLocalOrigin(origin)}
    />
  );
}
