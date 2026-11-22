import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, MailSearch, Search, SearchX, Settings2 } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { EMAIL_RELATED_LABELS, EMAIL_STATUS_LABELS, relatedHref, relatedRef } from "@/components/panel/emails/labels";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { db } from "@/db";
import { emailDriverStatus, listEmailTemplates } from "@/lib/email";
import { EMAIL_STATUS_PARAM, emailLogHref, parseEmailLogFilter, parseEmailLogPage, type EmailLogFilter } from "@/lib/panel/emails/filter";
import { listEmailLog, type EmailLogList } from "@/lib/panel/emails/service";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "E-postalar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_TABS = [null, "queued", "sent", "failed", "cancelled"] as const;

export default function EmailLogPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <>
            <Header canEditTemplates={false} />
            <Skeleton className="h-10 w-full max-w-2xl rounded-lg" />
            <TableSkeleton rows={8} />
          </>
        }
      >
        <EmailLogView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Header({ canEditTemplates }: { canEditTemplates: boolean }) {
  return (
    <PageHeader
      eyebrow="Sistem"
      title="E-postalar"
      description="Siteden gönderilen her e-postanın kaydı: sipariş, hesap, e-bülten ve yönetici bildirimleri. İçeriği tam gönderildiği haliyle görebilir, gerekirse yeniden gönderebilirsiniz."
      actions={
        canEditTemplates ? (
          <Link href="/panel/ayarlar/e-posta" className={buttonClass("secondary")}>
            <Settings2 aria-hidden className="size-4" />
            Şablonlar ve gönderen
          </Link>
        ) : null
      }
    />
  );
}

async function EmailLogView({ searchParams }: { searchParams: SearchParams }) {
  const { staffRole } = await requireStaff("staff");
  const params = await searchParams;
  const filter = parseEmailLogFilter(params);
  const list = await listEmailLog(db, filter, parseEmailLogPage(params));
  const labels = new Map(listEmailTemplates().map((t) => [t.key, t.label]));
  const driver = emailDriverStatus();

  return (
    <>
      <Header canEditTemplates={hasRole(staffRole, "admin")} />
      {!driver.ready ? (
        <p role="status" className="rounded-xl border border-[#D68A12]/40 bg-[#D68A12]/10 px-4 py-3 text-sm text-text">
          {driver.problem ?? "E-posta gönderimi yapılandırılmamış; e-postalar kuyrukta bekliyor."}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <StatusTabs filter={filter} counts={list.counts} />
        <FilterForm key={JSON.stringify(filter)} filter={filter} templates={list.templates} labels={labels} />
        {filter.related ? (
          <p className="text-sm text-text-muted">
            Yalnızca {EMAIL_RELATED_LABELS[filter.related.type]}
            {filter.related.id ? ` #${filter.related.id}` : ""} e-postaları gösteriliyor ·{" "}
            <Link href={emailLogHref({ ...filter, related: null })} className="font-medium text-text underline underline-offset-4">
              tümünü göster
            </Link>
          </p>
        ) : null}
      </div>
      <LogTable list={list} filter={filter} labels={labels} />
    </>
  );
}

function StatusTabs({ filter, counts }: { filter: EmailLogFilter; counts: EmailLogList["counts"] }) {
  return (
    <nav aria-label="Gönderim durumu" className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {STATUS_TABS.map((status) => {
          const current = filter.status === status;
          const n = status ? counts[status] : counts.all;
          return (
            <li key={status ?? "all"}>
              <Link
                href={emailLogHref({ ...filter, status })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {status ? EMAIL_STATUS_LABELS[status].label : "Tümü"}
                <span className={cn("rounded-full px-1.5 text-xs tabular-nums", current ? "bg-brand-contrast/15" : "bg-surface-2")}>{formatNumber(n)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const selectClass =
  "h-10 min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20";

function FilterForm({ filter, templates, labels }: { filter: EmailLogFilter; templates: string[]; labels: Map<string, string> }) {
  return (
    <Form action="/panel/e-postalar" role="search" aria-label="E-postalarda ara" className="flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:items-center">
      {filter.status ? <input type="hidden" name="durum" value={EMAIL_STATUS_PARAM[filter.status]} /> : null}
      {filter.related ? <input type="hidden" name="ilgili" value={filter.related.id ? `${filter.related.type}:${filter.related.id}` : filter.related.type} /> : null}
      <div className="relative min-w-0 flex-1">
        <label htmlFor="email-search" className="sr-only">
          Alıcı veya konu
        </label>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          id="email-search"
          name="ara"
          type="search"
          defaultValue={filter.q}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Alıcı adresi veya konu…"
          className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-3 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex">
        <label className="sr-only" htmlFor="email-template">
          Şablon
        </label>
        <select id="email-template" name="sablon" defaultValue={filter.template ?? ""} className={cn(selectClass, "sm:max-w-56")}>
          <option value="">Tüm şablonlar</option>
          {templates.map((key) => (
            <option key={key} value={key}>
              {labels.get(key) ?? key}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("primary")}>
          Filtrele
        </button>
      </div>
    </Form>
  );
}

function LogTable({ list, filter, labels }: { list: EmailLogList; filter: EmailLogFilter; labels: Map<string, string> }) {
  const filtered = Boolean(filter.q || filter.template || filter.status || filter.related);
  const title = `${formatNumber(list.total)} e-posta`;
  return (
    <Card title={title} description="En yeni en üstte · saatler Türkiye saatiyle" flush>
      {list.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="Eşleşen e-posta yok"
            description="Filtreleri değiştirin veya temizleyin."
            action={
              <Link href="/panel/e-postalar" className="text-sm font-medium text-text underline underline-offset-4">
                Filtreleri temizle
              </Link>
            }
          />
        ) : (
          <EmptyState icon={MailSearch} title="Henüz e-posta gönderilmedi" description="Sipariş, hesap ve e-bülten e-postaları gönderildikçe burada listelenir." />
        )
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {list.rows.map((row) => {
              const st = EMAIL_STATUS_LABELS[row.status];
              return (
                <li key={row.id} className="px-4 py-3.5">
                  <Link href={`/panel/e-postalar/${row.id}`} className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <p className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-text">{row.subject}</span>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    </p>
                    <p className="mt-1 truncate text-xs text-text-muted">
                      {row.toEmail} · {labels.get(row.template) ?? row.template}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">{formatDateTime(row.createdAt)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="relative hidden overflow-x-auto md:block">
            <table className={cn(tableClass, "min-w-[56rem]")}>
              <caption className="sr-only">{title}</caption>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Tarih</th>
                  <th scope="col" className={thClass}>Alıcı</th>
                  <th scope="col" className={thClass}>Konu</th>
                  <th scope="col" className={thClass}>Şablon</th>
                  <th scope="col" className={thClass}>İlgili kayıt</th>
                  <th scope="col" className={thClass}>Durum</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => {
                  const st = EMAIL_STATUS_LABELS[row.status];
                  const rel = row.relatedType ? EMAIL_RELATED_LABELS[row.relatedType as keyof typeof EMAIL_RELATED_LABELS] ?? row.relatedType : null;
                  const relHref = relatedHref(row.relatedType, row.relatedId);
                  return (
                    <tr key={row.id} className={trClass}>
                      <td className={cn(tdClass, "whitespace-nowrap text-text-muted")}>
                        <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>
                      </td>
                      <td className={cn(tdClass, "max-w-56 truncate")}>{row.toEmail}</td>
                      <td className={cn(tdClass, "max-w-80")}>
                        <Link href={`/panel/e-postalar/${row.id}`} className="line-clamp-2 font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {row.subject}
                        </Link>
                      </td>
                      <td className={cn(tdClass, "text-text-muted")}>{labels.get(row.template) ?? row.template}</td>
                      <td className={cn(tdClass, "whitespace-nowrap text-text-muted")}>
                        {rel ? (
                          relHref ? (
                            <Link href={relHref} className="underline-offset-4 hover:text-text hover:underline">
                              {rel} {relatedRef(row.relatedType, row.relatedId)}
                            </Link>
                          ) : (
                            <span>
                              {rel} {relatedRef(row.relatedType, row.relatedId)}
                            </span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={tdClass}>
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination list={list} filter={filter} />
        </>
      )}
    </Card>
  );
}

function Pagination({ list, filter }: { list: EmailLogList; filter: EmailLogFilter }) {
  const from = (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(list.total)}</span> e-posta
      </p>
      {list.pageCount > 1 ? (
        <div className="flex gap-2">
          {list.page > 1 ? (
            <Link href={emailLogHref(filter, list.page - 1)} rel="prev" className={linkClass}>
              <ChevronLeft aria-hidden className="size-4" />
              Önceki
            </Link>
          ) : null}
          {list.page < list.pageCount ? (
            <Link href={emailLogHref(filter, list.page + 1)} rel="next" className={linkClass}>
              Sonraki
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
