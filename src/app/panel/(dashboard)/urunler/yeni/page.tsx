import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import PageHeader from "@/components/panel/PageHeader";
import NewProductForm from "@/components/panel/products/NewProductForm";
import { Skeleton } from "@/components/panel/Skeleton";
import { localize } from "@/i18n/localize";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni ürün" };

export default function NewProductPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/urunler"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        Ürünler
      </Link>
      <PageHeader
        eyebrow="Katalog"
        title="Yeni ürün"
        description="Adı, türü ve kategorisi yeterli. Fiyat, varyant, görsel ve çevirileri bir sonraki adımda eklersiniz."
      />
      <Suspense fallback={<Skeleton className="h-80 max-w-2xl rounded-xl" />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await requireStaff("editor");
  const c = schema.categories;
  const rows = await db.select({ id: c.id, name: c.name, slug: c.slug, isVisible: c.isVisible }).from(c).orderBy(asc(c.position), asc(c.id));
  return <NewProductForm categories={rows.map((r) => ({ id: r.id, name: localize(r.name, "tr"), slug: r.slug, isVisible: r.isVisible }))} />;
}
