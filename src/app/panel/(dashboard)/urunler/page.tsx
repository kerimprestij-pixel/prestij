import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Search } from "lucide-react";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { listPanelProducts, type ProductListQuery, type ProductListStatus } from "@/app/panel/_lib/products";
import { formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import ProductList from "@/components/panel/products/ProductList";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import { buttonClass, controlClass } from "@/components/panel/ui/styles";
import type { ProductType } from "@/db/schema/catalog";
import { localize } from "@/i18n/localize";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ürünler" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL values (Turkish) → status filter. */
const STATUS_TABS: { param: string | null; status: ProductListStatus; label: string }[] = [
  { param: null, status: "all", label: "Tümü" },
  { param: "aktif", status: "active", label: "Yayında" },
  { param: "taslak", status: "draft", label: "Taslak" },
  { param: "arsiv", status: "archived", label: "Arşiv" },
  { param: "dusuk-stok", status: "low-stock", label: "Düşük stok" },
];
const TYPE_PARAMS: { param: string; type: ProductType; label: string }[] = [
  { param: "urun", type: "standard", label: "Ürün" },
  { param: "set", type: "bundle", label: "Set" },
  { param: "numune", type: "sample", label: "Numune" },
];

type Filters = { q: string; durum: string | null; kategori: string | null; tur: string | null };

function listHref(f: Filters, patch: Partial<Filters>): string {
  const next = { ...f, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("ara", next.q);
  if (next.durum) params.set("durum", next.durum);
  if (next.kategori) params.set("kategori", next.kategori);
  if (next.tur) params.set("tur", next.tur);
  const qs = params.toString();
  return qs ? `/panel/urunler?${qs}` : "/panel/urunler";
}

export default function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<ProductsFallback />}>
        <ProductsView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Header({ canEdit }: { canEdit: boolean | null }) {
  return (
    <PageHeader
      eyebrow="Katalog"
      title="Ürünler"
      description="Ürünleri, varyantları, fiyatları ve stokları yönetin. Sıralama mağazadaki sırayı belirler."
      actions={
        canEdit ? (
          <Link href="/panel/urunler/yeni" className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni ürün
          </Link>
        ) : null
      }
    />
  );
}

function ProductsFallback() {
  return (
    <>
      <Header canEdit={null} />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
        <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
      </div>
      <TableSkeleton rows={8} />
    </>
  );
}

async function ProductsView({ searchParams }: { searchParams: SearchParams }) {
  const { staffRole } = await requireStaff("staff");
  const canEdit = hasRole(staffRole, "editor");
  const params = await searchParams;
  const filters: Filters = {
    q: (first(params.ara) ?? "").trim().slice(0, 100),
    durum: first(params.durum) ?? null,
    kategori: first(params.kategori) ?? null,
    tur: first(params.tur) ?? null,
  };
  const tab = STATUS_TABS.find((t) => t.param === filters.durum) ?? STATUS_TABS[0];
  const typeFilter = TYPE_PARAMS.find((t) => t.param === filters.tur) ?? null;
  const categoryParam = filters.kategori === "yok" ? "none" : Number(filters.kategori);
  const query: ProductListQuery = {
    q: filters.q,
    status: tab.status,
    category: categoryParam === "none" ? "none" : Number.isSafeInteger(categoryParam) && categoryParam > 0 ? categoryParam : null,
    type: typeFilter?.type ?? null,
  };
  const [list, categories] = await Promise.all([
    listPanelProducts(query),
    db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .orderBy(asc(schema.categories.position), asc(schema.categories.id)),
  ]);

  return (
    <>
      <Header canEdit={canEdit} />
      <div className="space-y-3">
        <Form action="/panel/urunler" role="search" aria-label="Ürünlerde ara ve filtrele" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {tab.param ? <input type="hidden" name="durum" value={tab.param} /> : null}
          <div className="relative w-full sm:max-w-sm">
            <label htmlFor="product-search" className="sr-only">
              Ad, SKU veya barkod
            </label>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              id="product-search"
              name="ara"
              type="search"
              defaultValue={filters.q}
              placeholder="Ad, SKU veya barkod ara"
              className={cn(controlClass, "h-10 ps-9 pe-3")}
            />
          </div>
          <label className="sr-only" htmlFor="product-category">
            Kategori
          </label>
          <select id="product-category" name="kategori" defaultValue={filters.kategori ?? ""} className={cn(controlClass, "h-10 px-3 sm:w-48")}>
            <option value="">Tüm kategoriler</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {localize(c.name, "tr")}
              </option>
            ))}
            <option value="yok">Kategorisiz</option>
          </select>
          <label className="sr-only" htmlFor="product-type">
            Tür
          </label>
          <select id="product-type" name="tur" defaultValue={filters.tur ?? ""} className={cn(controlClass, "h-10 px-3 sm:w-40")}>
            <option value="">Tüm türler</option>
            {TYPE_PARAMS.map((t) => (
              <option key={t.param} value={t.param}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("secondary")}>
              Filtrele
            </button>
            {filters.q || filters.kategori || filters.tur ? (
              <Link href={listHref(filters, { q: "", kategori: null, tur: null })} className={buttonClass("ghost")}>
                Temizle
              </Link>
            ) : null}
          </div>
        </Form>
        <nav aria-label="Ürün durumu" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
            {STATUS_TABS.map((t) => {
              const current = t.status === tab.status;
              return (
                <li key={t.status}>
                  <Link
                    href={listHref(filters, { durum: t.param })}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    {t.label}
                    <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums", current ? "bg-brand-contrast/15" : "bg-surface-2")}>
                      {formatNumber(list.counts[t.status])}
                      <span className="sr-only"> ürün</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <ProductList
        rows={list.rows}
        canEdit={canEdit}
        reorderable={canEdit && !list.filtered}
        filtered={list.filtered}
        clearHref="/panel/urunler"
      />
    </>
  );
}
