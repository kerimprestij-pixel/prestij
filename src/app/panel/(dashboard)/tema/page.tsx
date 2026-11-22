import type { Metadata } from "next";
import { Suspense } from "react";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton } from "@/components/panel/Skeleton";
import ThemeList from "@/components/panel/theme/ThemeList";
import { listPanelThemes } from "@/lib/panel/theme/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Tema & Renkler" };

export default function ThemesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Tema & Renkler"
        description="Sitenin renklerini, yazı tiplerini ve köşe stilini belirleyin. Dönemsel temalar planladığınız tarihlerde ya da bağlı oldukları kampanya sürerken kendiliğinden yayına girer."
      />
      <Suspense fallback={<ThemesSkeleton />}>
        <Themes />
      </Suspense>
    </div>
  );
}

async function Themes() {
  await requireStaff("editor");
  const themes = await listPanelThemes();
  return <ThemeList themes={themes} />;
}

function ThemesSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Yükleniyor…</span>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
            <Skeleton className="h-28 rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-8 w-48 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
