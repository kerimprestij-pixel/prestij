import type { Metadata } from "next";
import { Suspense } from "react";
import MediaLibrary from "@/components/panel/media/MediaLibrary";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton } from "@/components/panel/Skeleton";
import { collectMediaUsage, listMedia } from "@/lib/panel/media/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Medya" };

export default function MediaPage({ searchParams }: PageProps<"/panel/medya">) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Medya"
        description="Sitedeki tüm görseller ve videolar. Yükleyin, klasörlere ayırın ve açıklamaları üç dilde girin. Kullanımdaki bir dosya silinemez."
      />
      <Suspense fallback={<LibrarySkeleton />}>
        <Library searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Library({ searchParams }: Pick<PageProps<"/panel/medya">, "searchParams">) {
  await requireStaff("editor");
  // Day 6: the library shows images and videos ("Tümü" tab); ?medya=<id> opens that file's drawer.
  const [initial, params] = await Promise.all([listMedia({ kind: "all" }), searchParams]);
  const usage = await collectMediaUsage(initial.items.map((m) => m.id));
  const counts = Object.fromEntries([...usage].map(([id, list]) => [id, list.length]));
  const raw = Array.isArray(params.medya) ? params.medya[0] : params.medya;
  const focusId = raw && /^[1-9]\d{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null;
  return <MediaLibrary initial={initial} initialCounts={counts} focusId={focusId} />;
}

function LibrarySkeleton() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Yükleniyor…</span>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-10 w-full rounded-lg sm:max-w-sm" />
        <Skeleton className="h-10 w-full rounded-lg sm:w-60" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-square rounded-lg" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
