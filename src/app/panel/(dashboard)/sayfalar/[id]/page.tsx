import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import PageEditor from "@/components/panel/sections/PageEditor";
import { getPageEditorData } from "@/lib/panel/content/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Sayfa düzenle" };

type Params = Promise<{ id: string }>;

export default function PageEditorPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const pageId = /^\d{1,9}$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(pageId) || pageId <= 0) notFound();
  const data = await getPageEditorData(pageId);
  if (!data) notFound();
  return <PageEditor key={data.page.id} initial={data.page} media={data.media} />;
}
