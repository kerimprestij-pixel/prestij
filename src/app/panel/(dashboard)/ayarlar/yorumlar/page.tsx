import type { Metadata } from "next";
import ReviewSettingsForm from "@/components/panel/settings/ReviewSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { countPendingReviews } from "@/lib/reviews/panel-queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yorumlar · Ayarlar" };

export default function ReviewSettingsPage() {
  return (
    <SettingsPageFrame slug="yorumlar">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const [row, pending] = await Promise.all([readSettingsRow("reviews"), countPendingReviews()]);
  return <ReviewSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} pending={pending} />;
}
