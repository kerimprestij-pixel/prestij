import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import CategoryList from "@/components/panel/categories/CategoryList";
import PageHeader from "@/components/panel/PageHeader";
import { TableSkeleton } from "@/components/panel/Skeleton";
import { buttonClass } from "@/components/panel/ui/styles";
import { listPanelCategories } from "@/lib/panel/categories/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kategoriler" };

export default function CategoriesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Katalog"
        title="Kategoriler"
        description="Ürünleri gruplayan kategoriler. Sıralama, mağazadaki kategori sırasını belirler."
        actions={
          <Link href="/panel/kategoriler/yeni" className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni kategori
          </Link>
        }
      />
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Categories />
      </Suspense>
    </div>
  );
}

async function Categories() {
  await requireStaff("editor");
  const rows = await listPanelCategories();
  return <CategoryList rows={rows} />;
}
