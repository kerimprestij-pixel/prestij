import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Inbox, MailCheck, Search, SearchX, X } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import { MarkAllReadButton } from "@/components/panel/messages/MessageActions";
import { LOCALE_LABEL, messagesListHref, SUBJECT_FILTERS, SUBJECT_TONE, subjectLabel } from "@/components/panel/messages/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { SUBJECT_PARAMS, subjectFromParam, type ContactSubject } from "@/lib/contact/subjects";
import { listContactMessages, type PanelMessageList, type PanelMessageRow } from "@/lib/panel/messages/queries";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mesajlar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Filter = { unread: boolean; subject: ContactSubject | null; q: string };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function MessagesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Satış"
        title="Mesajlar"
        description="İletişim formundan gelen mesajlar. Okunmamış mesajlar altın noktayla işaretlenir; bir mesajı açtığınızda okundu sayılır."
      />
      <Suspense fallback={<MessagesFallback />}>
        <MessagesView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function MessagesFallback() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      </div>
      <TableSkeleton rows={6} />
    </>
  );
}

async function MessagesView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const params = await searchParams;
  const filter: Filter = {
    unread: first(params.durum) === "okunmamis",
    subject: subjectFromParam(first(params.konu)),
    q: (first(params.ara) ?? "").trim().slice(0, 100),
  };
  const pageParam = Number(first(params.sayfa));
  const list = await listContactMessages({
    status: filter.unread ? "unread" : "all",
    subject: filter.subject,
    q: filter.q,
    page: Number.isSafeInteger(pageParam) ? pageParam : 1,
  });

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusTabs filter={filter} counts={list.counts} />
          {list.inbox.unread > 0 && list.inbox.newestId ? <MarkAllReadButton maxId={list.inbox.newestId} unread={list.inbox.unread} /> : null}
        </div>
        <SubjectChips filter={filter} counts={list.counts} />
        <SearchForm key={`${filter.unread}:${filter.subject}:${filter.q}`} filter={filter} />
      </div>
      <MessagesCard list={list} filter={filter} />
    </>
  );
}

function StatusTabs({ filter, counts }: { filter: Filter; counts: PanelMessageList["counts"] }) {
  const tabs = [
    { unread: false, label: "Tümü", n: counts.all },
    { unread: true, label: "Okunmamış", n: counts.unread },
  ];
  return (
    <nav aria-label="Okunma durumu" className="relative min-w-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((tab) => {
          const current = filter.unread === tab.unread;
          const highlight = tab.unread && tab.n > 0 && !current;
          return (
            <li key={tab.label}>
              <Link
                href={messagesListHref({ unread: tab.unread, subject: filter.subject, q: filter.q })}
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
                  {formatNumber(tab.n)}
                  <span className="sr-only"> mesaj</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SubjectChips({ filter, counts }: { filter: Filter; counts: PanelMessageList["counts"] }) {
  const chip = (current: boolean) =>
    cn(
      "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      current ? "border-brand bg-brand/[0.06] font-medium text-text" : "border-border text-text-muted hover:border-gold hover:text-text",
    );
  return (
    <nav aria-label="Konuya göre süz" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2">
        <li>
          <Link href={messagesListHref({ unread: filter.unread, q: filter.q })} aria-current={!filter.subject ? "page" : undefined} className={chip(!filter.subject)}>
            Tüm konular
          </Link>
        </li>
        {SUBJECT_FILTERS.map((s) => (
          <li key={s.key}>
            <Link
              href={messagesListHref({ unread: filter.unread, subject: s.key, q: filter.q })}
              aria-current={filter.subject === s.key ? "page" : undefined}
              className={chip(filter.subject === s.key)}
            >
              {s.label}
              <span className="text-xs tabular-nums text-text-muted">{formatNumber(counts.bySubject[s.key])}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SearchForm({ filter }: { filter: Filter }) {
  return (
    <Form action="/panel/mesajlar" role="search" aria-label="Mesajlarda ara" className="relative w-full max-w-md">
      {filter.unread ? <input type="hidden" name="durum" value="okunmamis" /> : null}
      {filter.subject ? <input type="hidden" name="konu" value={SUBJECT_PARAMS[filter.subject]} /> : null}
      <label htmlFor="message-search" className="sr-only">
        Ad, e-posta, telefon veya mesaj metni
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <input
        id="message-search"
        name="ara"
        type="search"
        defaultValue={filter.q}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Ad, e-posta, telefon, mesaj…"
        className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-20 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {filter.q ? (
        <Link
          href={messagesListHref({ unread: filter.unread, subject: filter.subject })}
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

function MessagesCard({ list, filter }: { list: PanelMessageList; filter: Filter }) {
  const title = filter.q ? `“${filter.q}” için ${formatNumber(list.total)} sonuç` : `${formatNumber(list.total)} mesaj`;
  const parts = [filter.unread ? "Okunmamış" : null, filter.subject ? subjectLabel(filter.subject) : null].filter(Boolean);
  const description = parts.length ? `${parts.join(" · ")} · en yeni en üstte` : "En yeni mesaj en üstte";
  return (
    <Card title={title} description={description} flush>
      {list.rows.length === 0 ? (
        <EmptyMessages list={list} filter={filter} />
      ) : (
        <>
          <ul className="divide-y divide-border" aria-label="Mesajlar">
            {list.rows.map((row) => (
              <MessageRow key={row.id} row={row} />
            ))}
          </ul>
          <Pagination list={list} filter={filter} />
        </>
      )}
    </Card>
  );
}

function MessageRow({ row }: { row: PanelMessageRow }) {
  return (
    <li>
      <Link
        href={`/panel/mesajlar/${row.id}`}
        className={cn(
          "group flex gap-3 px-4 py-4 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:gap-4 sm:px-5",
          !row.isRead && "bg-gold/[0.04]",
        )}
      >
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", row.isRead ? "bg-transparent" : "bg-gold")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn("min-w-0 truncate text-sm text-text", !row.isRead && "font-semibold")}>
              {row.name}
              {!row.isRead ? <span className="sr-only"> (okunmadı)</span> : null}
            </span>
            <time dateTime={row.createdAt} className="shrink-0 text-xs tabular-nums text-text-muted">
              {formatDateTime(row.createdAt)}
            </time>
          </span>
          <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge tone={row.subject ? SUBJECT_TONE[row.subject] : "neutral"}>{subjectLabel(row.subject)}</StatusBadge>
            {row.locale !== "tr" ? (
              <span className="rounded border border-border px-1.5 text-[0.6875rem] font-medium uppercase leading-5 text-text-muted" title={`${LOCALE_LABEL[row.locale] ?? row.locale} sayfadan`}>
                {row.locale}
              </span>
            ) : null}
            <span className="min-w-0 truncate text-xs text-text-muted" dir="ltr">
              {row.email}
            </span>
          </span>
          <span className={cn("mt-2 line-clamp-2 block text-sm leading-relaxed", row.isRead ? "text-text-muted" : "text-text")} dir="auto">
            {row.excerpt}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Pagination({ list, filter }: { list: PanelMessageList; filter: Filter }) {
  const from = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const prev = list.page > 1 ? messagesListHref({ ...filter, page: list.page - 1 }) : null;
  const next = list.page < list.pageCount ? messagesListHref({ ...filter, page: list.page + 1 }) : null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(list.total)}</span> mesaj
      </p>
      {list.pageCount > 1 ? (
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
      ) : null}
    </nav>
  );
}

function EmptyMessages({ list, filter }: { list: PanelMessageList; filter: Filter }) {
  const linkClass = "text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (filter.q) {
    return (
      <EmptyState
        icon={SearchX}
        title="Sonuç bulunamadı"
        description={`“${filter.q}” ile eşleşen mesaj yok. Adı, e-postayı, telefonun son hanelerini ya da mesajdan bir kelimeyi deneyin.`}
        action={
          <Link href={messagesListHref({ unread: filter.unread, subject: filter.subject })} className={linkClass}>
            Aramayı temizle
          </Link>
        }
      />
    );
  }
  if (list.inbox.newestId === null) {
    return (
      <EmptyState
        icon={Inbox}
        title="Henüz mesaj yok"
        description="Ziyaretçiler iletişim sayfasındaki formu gönderdiğinde mesajlar burada listelenir."
        action={
          <a href="/tr/iletisim" target="_blank" rel="noopener noreferrer" className={linkClass}>
            İletişim sayfasını aç
          </a>
        }
      />
    );
  }
  if (filter.unread && !filter.subject) {
    return <EmptyState icon={MailCheck} title="Okunmamış mesaj yok" description="Tüm mesajları okudunuz; yeni bir mesaj geldiğinde burada görünecek." />;
  }
  return (
    <EmptyState
      icon={Inbox}
      title="Bu filtrede mesaj yok"
      description="Başka bir konu seçin veya tüm mesajlara dönün."
      action={
        <Link href="/panel/mesajlar" className={linkClass}>
          Tüm mesajlar
        </Link>
      }
    />
  );
}
