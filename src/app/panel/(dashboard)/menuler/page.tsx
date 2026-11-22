import type { Metadata } from "next";
import { Suspense } from "react";
import MenuEditor from "@/components/panel/menus/MenuEditor";
import PageHeader from "@/components/panel/PageHeader";
import { ListSkeleton } from "@/components/panel/Skeleton";
import { getMenusEditorState } from "@/lib/panel/content/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Menüler" };

export default function MenusPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Menüler"
        description="Sitenin üst menüsünü ve alt bilgideki bağlantı sütunlarını düzenleyin. Bağlantı yazıları üç dilde; adresler her dilde doğru sayfaya gider."
      />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <Menus />
      </Suspense>
    </div>
  );
}

async function Menus() {
  await requireStaff("editor");
  const state = await getMenusEditorState();
  return <MenuEditor initial={state} />;
}
