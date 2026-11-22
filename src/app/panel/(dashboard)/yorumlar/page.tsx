import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, MessageSquareQuote, Settings2, Star } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { REVIEW_STATUS, reviewsListHref, STATUS_TABS, statusFromParam, type ReviewListFilter } from "@/components/panel/reviews/labels";
import ReviewModerationList from "@/components/panel/reviews/ReviewModerationList";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import { buttonClass } from "@/components/panel/ui/styles";
import { hasRole } from "@/lib/panel/roles";
import { listPanelReviews, type PanelReviewList } from "@/lib/reviews/panel-queries";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Yorumlar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Filter = Required<Pick<ReviewListFilter, "status">> & { productId: number | null; rating: number | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<ReviewsFallback />}>
        <ReviewsView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Header({ admin }: { admin: boolean }) {
  return (
    <PageHeader
      eyebrow="Katalog"
      title="Yorumlar"
      description="Müşteri değerlendirmeleri önce burada onayınıza düşer. Onayladığınız yorumlar ürün sayfasında yayınlanır, puan ortalaması kendiliğinden güncellenir; yanıtınız yorumun altında herkese görünür."
      actions={
        admin ? (
          <Link href="/panel/ayarlar/yorumlar" className={buttonClass("secondary", "sm")}>
            <Settings2 aria-hidden className="size-4" />
            Yorum ayarları
          </Link>
        ) : null
      }
    />
  );
}

function ReviewsFallback() {
  return (
    <>
      <Header admin={false} />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-9 w-full max-w-lg rounded-full" />
      </div>
      <TableSkeleton rows={5} />
    </>
  );
}

async function ReviewsView({ searchParams }: { searchParams: SearchParams }) {
  const { staffRole } = await requireStaff("editor");
  const params = await searchParams;
  const productParam = Number(first(params.urun));
  const ratingParam = Number(first(params.puan));
  const filter: Filter = {
    status: statusFromParam(first(params.durum)),
    productId: Number.isSafeInteger(productParam) && productParam > 0 ? productParam : null,
    rating: Number.isInteger(ratingParam) && ratingParam >= 1 && ratingParam <= 5 ? ratingParam : null,
  };
  const pageParam = Number(first(params.sayfa));
  const list = await listPanelReviews({ ...filter, page: Number.isSafeInteger(pageParam) ? pageParam : 1 });

  return (
    <>
      <Header admin={hasRole(staffRole, "admin")} />
      <div className="flex flex-col gap-3">
        <StatusTabs filter={filter} counts={list.counts} />
        <FilterChips filter={filter} list={list} />
      </div>
      {list.rows.length === 0 ? (
        <Card>
          <EmptyReviews filter={filter} list={list} />
        </Card>
      ) : (
        <>
          <ReviewModerationList rows={list.rows} />
          <Pagination list={list} filter={filter} />
        </>
      )}
    </>
  );
}

function StatusTabs({ filter, counts }: { filter: Filter; counts: PanelReviewList["counts"] }) {
  return (
    <nav aria-label="Yorum durumu" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {STATUS_TABS.map((tab) => {
          const current = filter.status === tab.status;
          const n = counts[tab.status];
          const highlight = tab.status === "pending" && n > 0 && !current;
          return (
            <li key={tab.status}>
              <Link
                href={reviewsListHref({ status: tab.status, productId: filter.productId, rating: filter.rating })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                    current ? "bg-brand-contrast/15" : highlight ? "bg-gold/20 font-semibold text-text" : "bg-surface-2",
                  )}
                >
                  {formatNumber(n)}
                  <span className="sr-only"> yorum</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const chipClass = (current: boolean) =>
  cn(
    "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    current ? "border-brand bg-brand/[0.06] font-medium text-text" : "border-border text-text-muted hover:border-gold hover:text-text",
  );

function FilterChips({ filter, list }: { filter: Filter; list: PanelReviewList }) {
  return (
    <div className="flex flex-col gap-3">
      {list.products.length > 1 || filter.productId ? (
        <nav aria-label="Ürüne göre süz" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-2">
            <li>
              <Link href={reviewsListHref({ ...filter, productId: null })} aria-current={!filter.productId ? "page" : undefined} className={chipClass(!filter.productId)}>
                Tüm ürünler
              </Link>
            </li>
            {list.products.map((p) => (
              <li key={p.id}>
                <Link
                  href={reviewsListHref({ ...filter, productId: p.id })}
                  aria-current={filter.productId === p.id ? "page" : undefined}
                  className={chipClass(filter.productId === p.id)}
                >
                  {p.name}
                  <span className="text-xs tabular-nums text-text-muted">{formatNumber(p.count)}</span>
                  {p.pending > 0 ? (
                    <span aria-label={`${p.pending} bekleyen`} title={`${p.pending} bekleyen`} className="size-1.5 rounded-full bg-[#D68A12]" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <nav aria-label="Puana göre süz" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2">
          <li>
            <Link href={reviewsListHref({ ...filter, rating: null })} aria-current={!filter.rating ? "page" : undefined} className={chipClass(!filter.rating)}>
              Tüm puanlar
            </Link>
          </li>
          {[5, 4, 3, 2, 1].map((n) => (
            <li key={n}>
              <Link href={reviewsListHref({ ...filter, rating: n })} aria-current={filter.rating === n ? "page" : undefined} className={chipClass(filter.rating === n)}>
                <span className="tabular-nums">{n}</span>
                <Star aria-hidden className="size-3.5 fill-gold text-gold" strokeWidth={1.5} />
                <span className="sr-only">puan</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function Pagination({ list, filter }: { list: PanelReviewList; filter: Filter }) {
  if (list.pageCount <= 1) return null;
  const prev = list.page > 1 ? reviewsListHref({ ...filter, page: list.page - 1 }) : null;
  const next = list.page < list.pageCount ? reviewsListHref({ ...filter, page: list.page + 1 }) : null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";
  const from = (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(list.total)}</span> yorum
      </p>
      <div className="flex gap-2">
        {prev ? (
          <Link href={prev} rel="prev" className={linkClass}>
            <ChevronLeft aria-hidden className="size-4" />
            Önceki
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            <ChevronLeft aria-hidden className="size-4" />
            Önceki
          </span>
        )}
        {next ? (
          <Link href={next} rel="next" className={linkClass}>
            Sonraki
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Sonraki
            <ChevronRight aria-hidden className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}

function EmptyReviews({ filter, list }: { filter: Filter; list: PanelReviewList }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (list.counts.all === 0 && !filter.productId && !filter.rating) {
    return (
      <EmptyState
        icon={MessageSquareQuote}
        title="Henüz yorum yok"
        description="Müşteriler ürün sayfasından ya da teslimattan sonra gönderilen e-postadaki bağlantıyla yorum yazdığında burada onayınızı bekler."
      />
    );
  }
  if (filter.status === "pending" && !filter.productId && !filter.rating) {
    return (
      <EmptyState
        icon={MessageSquareQuote}
        title="Bekleyen yorum yok"
        description="Tüm yorumları incelediniz. Yeni bir yorum geldiğinde burada görünür."
        action={
          <Link href={reviewsListHref({ status: "all" })} className={linkClass}>
            Tüm yorumlar
          </Link>
        }
      />
    );
  }
  const label = filter.status === "all" ? "" : `${REVIEW_STATUS[filter.status].label.toLocaleLowerCase("tr-TR")} `;
  return (
    <EmptyState
      icon={MessageSquareQuote}
      title="Bu filtrede yorum yok"
      description={`Seçtiğiniz ürün veya puanda ${label}yorum bulunmuyor.`}
      action={
        <Link href={reviewsListHref({ status: filter.status })} className={linkClass}>
          Filtreleri temizle
        </Link>
      }
    />
  );
}
