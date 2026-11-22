import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import AnnouncementList from "@/components/panel/announcements/AnnouncementList";
import PageHeader from "@/components/panel/PageHeader";
import { ListSkeleton } from "@/components/panel/Skeleton";
import { buttonClass } from "@/components/panel/ui/styles";
import { listPanelAnnouncements } from "@/lib/panel/content/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Duyurular" };

export default function AnnouncementsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Duyurular"
        description="Sitenin en üstündeki ince şerit. Birden fazla duyuru yayındaysa sırayla döner; zamanlayarak kampanya başında açılıp sonunda kapanmasını sağlayabilirsiniz."
        actions={
          <Link href="/panel/duyurular/yeni" className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni duyuru
          </Link>
        }
      />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <Announcements />
      </Suspense>
    </div>
  );
}

async function Announcements() {
  await requireStaff("editor");
  const items = await listPanelAnnouncements();
  return <AnnouncementList initial={items} />;
}
