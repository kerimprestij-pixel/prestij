import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import ProductEditor from "@/components/panel/products/ProductEditor";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { siteOrigin } from "@/i18n/paths";
import { loadProductContext, loadProductState } from "@/lib/panel/products/queries";
import { getSettings } from "@/lib/settings/get-settings";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ürünü düzenle" };

type Params = Promise<{ id: string }>;

export default function ProductEditPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/urunler"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        Ürünler
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Editor params={params} />
      </Suspense>
    </div>
  );
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isSafeInteger(productId) || productId <= 0) notFound();
  const state = await loadProductState(db, productId);
  if (!state) notFound();
  const [context, seo, general] = await Promise.all([loadProductContext(db, state), getSettings("seo"), getSettings("general")]);
  const titleTemplate = seo.titleTemplate.includes("%s") ? seo.titleTemplate : `%s | ${general.siteName}`;
  return <ProductEditor initial={state} context={{ ...context, titleTemplate, siteUrl: siteOrigin() }} />;
}
