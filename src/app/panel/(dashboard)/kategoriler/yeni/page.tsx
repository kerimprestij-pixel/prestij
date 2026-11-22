import type { Metadata } from "next";
import { Suspense } from "react";
import CategoryEditorView, { CategoriesBackLink } from "@/components/panel/categories/CategoryEditorView";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { EMPTY_CATEGORY } from "@/lib/panel/categories/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni kategori" };

export default function NewCategoryPage() {
  return (
    <div className="space-y-6">
      <CategoriesBackLink />
      <Suspense fallback={<DetailSkeleton />}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  await requireStaff("editor");
  return <CategoryEditorView state={EMPTY_CATEGORY} />;
}
