import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/panel/Skeleton";
import ThemeEditor from "@/components/panel/theme/ThemeEditor";
import { getPanelTheme } from "@/lib/panel/theme/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Temayı düzenle" };

type Params = Promise<{ id: string }>;

export default function ThemeEditorPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const detail = /^\d{1,9}$/.test(id) ? await getPanelTheme(Number(id)) : null;
  if (!detail) notFound();
  return <ThemeEditor detail={detail} />;
}

function EditorSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Yükleniyor…</span>
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
