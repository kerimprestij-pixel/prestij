import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AnnouncementEditor from "@/components/panel/announcements/AnnouncementEditor";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { announcementStatus } from "@/lib/panel/content/announcements";
import { listPanelAnnouncements } from "@/lib/panel/content/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Duyuru düzenle" };

type Params = Promise<{ id: string }>;

export default function AnnouncementEditorPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const announcementId = /^\d{1,9}$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(announcementId) || announcementId <= 0) notFound();
  const all = await listPanelAnnouncements();
  const row = all.find((a) => a.id === announcementId);
  if (!row) notFound();
  const live = all.filter((a) => a.id !== row.id && announcementStatus(a) === "live").length;
  return (
    <AnnouncementEditor
      key={row.id}
      initial={{
        id: row.id,
        text: row.text,
        href: row.href ?? "",
        variant: row.variant,
        isActive: row.isActive,
        schedule: { startsAt: row.startsAt, endsAt: row.endsAt },
        updatedAt: row.updatedAt,
      }}
      liveCount={live + 1}
    />
  );
}
