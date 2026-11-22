import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import CategoryEditorView, { CategoriesBackLink } from "@/components/panel/categories/CategoryEditorView";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { loadCategoryState } from "@/lib/panel/categories/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kategoriyi düzenle" };

type Params = Promise<{ id: string }>;

export default function CategoryEditPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <CategoriesBackLink />
      <Suspense fallback={<DetailSkeleton />}>
        <Editor params={params} />
      </Suspense>
    </div>
  );
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const categoryId = Number(id);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) notFound();
  const state = await loadCategoryState(db, categoryId);
  if (!state) notFound();
  return <CategoryEditorView state={state} />;
}
