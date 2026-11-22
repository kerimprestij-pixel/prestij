import type { Metadata } from "next";
import { Suspense } from "react";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton } from "@/components/panel/Skeleton";
import UiStringsEditor from "@/components/panel/ui-strings/UiStringsEditor";
import { listUiStringGroups, listUiStrings } from "@/lib/panel/ui-strings/catalog";
import { listUiStringOverrides } from "@/lib/panel/ui-strings/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Arayüz Metinleri" };

export default function UiStringsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Arayüz Metinleri"
        description="Butonlar, etiketler ve uyarılar gibi sitede görünen kısa metinleri Türkçe, İngilizce ve Arapça olarak değiştirin. Boş bıraktığınız dilde varsayılan metin kullanılır; kaydettiğinizde site bir sonraki ziyarette güncellenir."
      />
      <Suspense fallback={<EditorSkeleton />}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  await requireStaff("editor");
  const { values, versions } = await listUiStringOverrides();
  return <UiStringsEditor entries={listUiStrings()} groups={listUiStringGroups()} overrides={values} versions={versions} />;
}

function EditorSkeleton() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Yükleniyor…</span>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="hidden space-y-2 xl:block">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
