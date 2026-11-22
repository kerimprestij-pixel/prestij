// Shared building blocks of the request lists and detail pages (server components): status tabs,
// search, paging, the e-mail log card and the back link.
import Form from "next/form";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Card from "@/components/panel/Card";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import StatusBadge from "@/components/panel/StatusBadge";
import type { RequestEmailRow } from "@/lib/requests/queries";
import { cn } from "@/lib/utils";
import { EMAIL_STATUS_LABEL, EMAIL_TEMPLATE_LABEL, requestListHref, statusBadge, STATUS_PARAM, type RequestListFilter } from "./labels";

type Base = "/panel/teklifler" | "/panel/numune-talepleri";

export function StatusTabs({
  base,
  statuses,
  filter,
  counts,
  label,
}: {
  base: Base;
  statuses: readonly string[];
  filter: RequestListFilter;
  counts: Record<string, number>;
  label: string;
}) {
  const tabs = [{ status: null as string | null, label: "Tümü", n: counts.all ?? 0 }, ...statuses.map((s) => ({ status: s, label: statusBadge(s).label, n: counts[s] ?? 0 }))];
  return (
    <nav aria-label={label} className="relative -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((tab) => {
          const current = filter.status === tab.status;
          const highlight = tab.status === "new" && tab.n > 0 && !current;
          return (
            <li key={tab.label}>
              <Link
                href={requestListHref(base, { status: tab.status, q: filter.q })}
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
                  <span className="sr-only"> talep</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function RequestSearch({ base, filter, placeholder, label }: { base: Base; filter: RequestListFilter; placeholder: string; label: string }) {
  return (
    <Form action={base} role="search" aria-label={label} className="relative w-full max-w-md">
      {filter.status ? <input type="hidden" name="durum" value={STATUS_PARAM[filter.status as keyof typeof STATUS_PARAM] ?? filter.status} /> : null}
      <label htmlFor="request-search" className="sr-only">
        {label}
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <input
        id="request-search"
        name="ara"
        type="search"
        defaultValue={filter.q}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-20 text-sm text-text placeholder:text-text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {filter.q ? (
        <Link
          href={requestListHref(base, { status: filter.status })}
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

export function RequestPagination({ base, filter, page, pageCount, pageSize, total }: { base: Base; filter: RequestListFilter; page: number; pageCount: number; pageSize: number; total: number }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const prev = page > 1 ? requestListHref(base, { ...filter, page: page - 1 }) : null;
  const next = page < pageCount ? requestListHref(base, { ...filter, page: page + 1 }) : null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(total)}</span> talep
      </p>
      {pageCount > 1 ? (
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

export const backLinkClass =
  "inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={backLinkClass}>
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {children}
    </Link>
  );
}

/** The e-mails sent for one request (template, recipient, status, time). */
export function EmailLogCard({ emails }: { emails: RequestEmailRow[] }) {
  return (
    <Card title="E-postalar" description={emails.length ? "Bu talep için oluşturulan e-postalar, en yenisi üstte." : undefined} flush>
      {emails.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">Henüz e-posta yok.</p>
      ) : (
        <ul className="divide-y divide-border">
          {emails.map((mail) => {
            const status = EMAIL_STATUS_LABEL[mail.status] ?? { label: mail.status, tone: "neutral" as const };
            return (
              <li key={mail.id} className="flex flex-col gap-1 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{EMAIL_TEMPLATE_LABEL[mail.template] ?? mail.template}</span>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
                <span className="truncate text-xs text-text-muted" dir="ltr">
                  {mail.toEmail}
                </span>
                <time dateTime={mail.createdAt} className="text-xs tabular-nums text-text-muted">
                  {formatDateTime(mail.sentAt ?? mail.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** A definition list row for the side cards. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-text">{children}</dd>
    </div>
  );
}
