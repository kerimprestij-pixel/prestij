import type { Metadata } from "next";
import { Suspense } from "react";
import AnnouncementEditor, { NEW_ANNOUNCEMENT } from "@/components/panel/announcements/AnnouncementEditor";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { announcementStatus } from "@/lib/panel/content/announcements";
import { listPanelAnnouncements } from "@/lib/panel/content/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni duyuru" };

export default function NewAnnouncementPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Editor />
    </Suspense>
  );
}

async function Editor() {
  await requireStaff("editor");
  const all = await listPanelAnnouncements();
  const live = all.filter((a) => announcementStatus(a) === "live").length;
  return <AnnouncementEditor initial={NEW_ANNOUNCEMENT} liveCount={live + 1} />;
}
