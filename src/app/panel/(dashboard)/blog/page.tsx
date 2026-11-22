import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Newspaper, Plus, Search, SearchX, X } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { postFilterFromParam, postListHref, postStatus, POST_FILTERS } from "@/components/panel/blog/labels";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui/styles";
import { localize } from "@/i18n/localize";
import { listPanelPosts, type PanelPostList, type PanelPostRow } from "@/lib/panel/blog/queries";
import Img from "@/lib/media/Img";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Blog" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Filter = ReturnType<typeof postFilterFromParam>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function BlogPostsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Blog"
        description="Yazıları hazırlayın, yayınlayın veya ileri bir tarihe planlayın. Planlanan yazılar zamanı gelince sitede kendiliğinden görünür."
        actions={
          <Link href="/panel/blog/yeni" className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni yazı
          </Link>
        }
      />
      <Suspense
        fallback={
          <>
            <div className="flex flex-col gap-3">
              <FilterTabs active={null} counts={null} q="" />
              <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            </div>
            <TableSkeleton rows={5} />
          </>
        }
      >
        <PostsView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PostsView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff("editor");
  const params = await searchParams;
  const filter = postFilterFromParam(first(params.durum));
  const q = (first(params.ara) ?? "").trim().slice(0, 100);
  const pageParam = Number(first(params.sayfa));
  const list = await listPanelPosts({ filter: filter.filter, q, page: Number.isSafeInteger(pageParam) ? pageParam : 1 });
  const now = list.now;

  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterTabs active={filter} counts={list.counts} q={q} />
        <SearchForm key={`${filter.filter}:${q}`} filter={filter} q={q} />
      </div>
      <PostsCard list={list} filter={filter} q={q} now={now} />
    </>
  );
}

function FilterTabs({ active, counts, q }: { active: Filter | null; counts: PanelPostList["counts"] | null; q: string }) {
  return (
    <nav aria-label="Yazı durumu" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {POST_FILTERS.map((f) => {
          const current = active?.filter === f.filter;
          const n = counts?.[f.filter];
          return (
            <li key={f.filter}>
              <Link
                href={postListHref({ filter: f.param, q })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {f.label}
                {n != null ? (
                  <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums", current ? "bg-brand-contrast/15" : "bg-surface-2")}>
                    {formatNumber(n)}
                    <span className="sr-only"> yazı</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SearchForm({ filter, q }: { filter: Filter; q: string }) {
  return (
    <Form action="/panel/blog" role="search" aria-label="Yazılarda ara" className="relative w-full max-w-md">
      {filter.param ? <input type="hidden" name="durum" value={filter.param} /> : null}
      <label htmlFor="post-search" className="sr-only">
        Başlık, kısa ad, etiket veya yazar
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <input
        id="post-search"
        name="ara"
        type="search"
        defaultValue={q}
        maxLength={100}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Başlık, etiket, yazar…"
        className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-20 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <Link
          href={postListHref({ filter: filter.param })}
          className="absolute end-11 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-4" />
          <span className="sr-only">Aramayı temizle</span>
        </Link>
      ) : null}
      <button
        type="submit"
        className="absolute end-1 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-md bg-brand text-brand-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Search aria-hidden className="size-4" />
        <span className="sr-only">Ara</span>
      </button>
    </Form>
  );
}

function Cover({ post, size = 48 }: { post: PanelPostRow; size?: number }) {
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2" style={{ width: Math.round(size * 1.33), height: size }}>
      {post.cover ? (
        <Img media={post.cover} alt="" sizes={`${Math.round(size * 1.33)}px`} fill />
      ) : (
        <span aria-hidden className="grid size-full place-items-center text-text-muted">
          <ImageOff className="size-4" strokeWidth={1.5} />
        </span>
      )}
    </span>
  );
}

function Languages({ post }: { post: PanelPostRow }) {
  return (
    <span className="flex gap-1" aria-label={`Çeviriler: İngilizce ${post.hasEn ? "var" : "yok"}, Arapça ${post.hasAr ? "var" : "yok"}`}>
      {(["EN", "AR"] as const).map((code) => {
        const has = code === "EN" ? post.hasEn : post.hasAr;
        return (
          <span
            key={code}
            aria-hidden
            className={cn(
              "rounded px-1 py-px text-[0.625rem] font-semibold tracking-wider",
              has ? "bg-gold/15 text-gold-text" : "border border-dashed border-border text-text-muted/70",
            )}
          >
            {code}
          </span>
        );
      })}
    </span>
  );
}

function PostsCard({ list, filter, q, now }: { list: PanelPostList; filter: Filter; q: string; now: number }) {
  const title = q ? `“${q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} yazı`;
  const description = filter.filter === "all" ? "En yeni yayın tarihi en üstte; taslaklar başta" : filter.label;
  return (
    <Card title={title} description={description} flush>
      {list.rows.length === 0 ? (
        <EmptyPosts list={list} filter={filter} q={q} />
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {list.rows.map((post) => {
              const status = postStatus(post, now);
              return (
                <li key={post.id}>
                  <Link
                    href={`/panel/blog/${post.id}`}
                    className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    <Cover post={post} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text">{localize(post.title, "tr")}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        <span>{status.detail ?? (post.publishedAt && status.visibility === "published" ? formatDateTime(post.publishedAt) : `Düzenlendi: ${formatDateTime(post.updatedAt)}`)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="relative hidden overflow-x-auto md:block">
            <table className={`${tableClass} min-w-[44rem]`}>
              <caption className="sr-only">{title}</caption>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Yazı</th>
                  <th scope="col" className={thClass}>Durum</th>
                  <th scope="col" className={thClass}>Yayın tarihi</th>
                  <th scope="col" className={`${thClass} hidden lg:table-cell`}>Çeviri</th>
                  <th scope="col" className={`${thClass} hidden text-end xl:table-cell`}>Son düzenleme</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((post) => {
                  const status = postStatus(post, now);
                  return (
                    <tr key={post.id} className={cn(trClass, "relative")}>
                      <td className={tdClass}>
                        <span className="flex items-center gap-3">
                          <Cover post={post} />
                          <span className="min-w-0">
                            <Link
                              href={`/panel/blog/${post.id}`}
                              className="block max-w-[26rem] truncate font-medium text-text underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-[-2px] focus-visible:before:outline-ring"
                            >
                              {localize(post.title, "tr")}
                            </Link>
                            <span className="block max-w-[26rem] truncate font-mono text-xs text-text-muted">/blog/{post.slug}</span>
                          </span>
                        </span>
                      </td>
                      <td className={tdClass}>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                        {post.publishedAt ? <time dateTime={post.publishedAt}>{formatDateTime(post.publishedAt)}</time> : "—"}
                        {post.readingMinutes ? <span className="block text-xs">{post.readingMinutes} dk okuma</span> : null}
                      </td>
                      <td className={`${tdClass} hidden lg:table-cell`}>
                        <Languages post={post} />
                      </td>
                      <td className={`${tdClass} hidden whitespace-nowrap text-end text-text-muted xl:table-cell`}>
                        <time dateTime={post.updatedAt}>{formatDateTime(post.updatedAt)}</time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.pageCount > 1 ? <Pagination list={list} filter={filter} q={q} /> : null}
        </>
      )}
    </Card>
  );
}

function Pagination({ list, filter, q }: { list: PanelPostList; filter: Filter; q: string }) {
  const prev = list.page > 1 ? postListHref({ filter: filter.param, q, page: list.page - 1 }) : null;
  const next = list.page < list.pageCount ? postListHref({ filter: filter.param, q, page: list.page + 1 }) : null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        Sayfa {formatNumber(list.page)} / {formatNumber(list.pageCount)}
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

function EmptyPosts({ list, filter, q }: { list: PanelPostList; filter: Filter; q: string }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (q) {
    return (
      <EmptyState
        icon={SearchX}
        title="Sonuç bulunamadı"
        description={`“${q}” ile eşleşen yazı yok. Başlığın bir kısmını, bir etiketi veya yazar adını deneyin.`}
        action={
          <Link href={postListHref({ filter: filter.param })} className={linkClass}>
            Aramayı temizle
          </Link>
        }
      />
    );
  }
  if (list.counts.all === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        title="Henüz yazı yok"
        description="İlk yazınızı oluşturun. Yayınlayana kadar taslak olarak kalır; sitede blog sayfası o zamana kadar “Yakında” gösterir."
        action={
          <Link href="/panel/blog/yeni" className={buttonClass("primary", "sm")}>
            <Plus aria-hidden className="size-4" />
            İlk yazıyı oluştur
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Newspaper}
      title={`“${filter.label}” durumunda yazı yok`}
      description="Başka bir sekme seçin veya tüm yazılara dönün."
      action={
        <Link href="/panel/blog" className={linkClass}>
          Tüm yazılar
        </Link>
      }
    />
  );
}
