import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Filter, ScrollText, SearchX } from "lucide-react";
import { db } from "@/db";
import AuditDiff from "@/components/panel/audit/AuditDiff";
import { actionInfo, auditSubject, diffAudit, entityHref, entityLabel } from "@/components/panel/audit/labels";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber, initials } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { SETTINGS_PAGES } from "@/components/panel/settings/settings-pages";
import { Skeleton, TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass, controlClass, labelClass } from "@/components/panel/ui/styles";
import {
  auditFilterOptions,
  listAuditLog,
  parseDay,
  type AuditFilterOptions,
  type AuditLogFilters,
  type AuditLogPage,
  type AuditLogRow,
} from "@/lib/panel/team/audit-log";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "İşlem Kaydı" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const BASE = "/panel/islem-kaydi";

type Filters = { entity: string | null; userId: string | null; from: string | null; to: string | null };

function readFilters(params: Record<string, string | string[] | undefined>): Filters & { page: number } {
  const text = (v: string | undefined, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);
  const page = Number(first(params.sayfa));
  return {
    entity: text(first(params.tur), 64),
    userId: text(first(params.kullanici), 100),
    from: parseDay(first(params.baslangic)),
    to: parseDay(first(params.bitis)),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

function auditHref(filters: Filters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.entity) params.set("tur", filters.entity);
  if (filters.userId) params.set("kullanici", filters.userId);
  if (filters.from) params.set("baslangic", filters.from);
  if (filters.to) params.set("bitis", filters.to);
  if (page > 1) params.set("sayfa", String(page));
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

const hasFilters = (f: Filters) => Boolean(f.entity || f.userId || f.from || f.to);

export default function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sistem"
        title="İşlem Kaydı"
        description="Panelde kimin neyi ne zaman değiştirdiği. Kayıtlar sonradan değiştirilemez; şifreler ve gizli anahtarlar hiçbir zaman yazılmaz."
      />
      <Suspense fallback={<AuditFallback />}>
        <AuditView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function AuditFallback() {
  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
          <Skeleton className="h-10 w-24 self-end" />
        </div>
      </div>
      <TableSkeleton rows={8} />
    </>
  );
}

async function AuditView({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff("admin");
  const { page, ...filters } = readFilters(await searchParams);
  const query: AuditLogFilters = { ...filters, page };
  const [log, options] = await Promise.all([listAuditLog(db, query), auditFilterOptions(db)]);
  return (
    <>
      <FilterBar key={auditHref(filters)} filters={filters} options={options} />
      <LogCard log={log} filters={filters} options={options} />
    </>
  );
}

function FilterBar({ filters, options }: { filters: Filters; options: AuditFilterOptions }) {
  const selectClass = cn(controlClass, "h-10 w-full px-3 pe-8");
  return (
    <Form action={BASE} aria-label="İşlem kaydını filtrele" className="rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] lg:items-end">
        <div>
          <label htmlFor="audit-entity" className={labelClass}>
            Kayıt türü
          </label>
          <select id="audit-entity" name="tur" defaultValue={filters.entity ?? ""} className={cn(selectClass, "mt-1.5")}>
            <option value="">Tümü</option>
            {options.entities.map((entity) => (
              <option key={entity} value={entity}>
                {entityLabel(entity)}
              </option>
            ))}
            {filters.entity && !options.entities.includes(filters.entity) ? (
              <option value={filters.entity}>{entityLabel(filters.entity)}</option>
            ) : null}
          </select>
        </div>
        <div>
          <label htmlFor="audit-user" className={labelClass}>
            Kullanıcı
          </label>
          <select id="audit-user" name="kullanici" defaultValue={filters.userId ?? ""} className={cn(selectClass, "mt-1.5")}>
            <option value="">Herkes</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email ?? "Silinmiş kullanıcı"}
              </option>
            ))}
            {options.hasSystemRows ? <option value="system">Sistem</option> : null}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-2">
          <div>
            <label htmlFor="audit-from" className={labelClass}>
              Başlangıç
            </label>
            <input
              id="audit-from"
              name="baslangic"
              type="date"
              defaultValue={filters.from ?? ""}
              className={cn(controlClass, "mt-1.5 h-10 w-full min-w-0 px-3")}
            />
          </div>
          <div>
            <label htmlFor="audit-to" className={labelClass}>
              Bitiş
            </label>
            <input
              id="audit-to"
              name="bitis"
              type="date"
              defaultValue={filters.to ?? ""}
              className={cn(controlClass, "mt-1.5 h-10 w-full min-w-0 px-3")}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className={buttonClass("primary", "md", "flex-1 lg:flex-none")}>
            <Filter aria-hidden className="size-4" />
            Filtrele
          </button>
          {hasFilters(filters) ? (
            <Link href={BASE} className={buttonClass("ghost", "md")}>
              Temizle
            </Link>
          ) : null}
        </div>
      </div>
    </Form>
  );
}

function describeFilters(filters: Filters, options: AuditFilterOptions): string {
  const parts: string[] = [];
  if (filters.entity) parts.push(entityLabel(filters.entity));
  if (filters.userId) {
    const u = options.users.find((x) => x.id === filters.userId);
    parts.push(filters.userId === "system" ? "Sistem" : (u?.name ?? u?.email ?? "Seçili kullanıcı"));
  }
  const day = (d: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  if (filters.from && filters.to) parts.push(`${day(filters.from)} – ${day(filters.to)}`);
  else if (filters.from) parts.push(`${day(filters.from)} ve sonrası`);
  else if (filters.to) parts.push(`${day(filters.to)} ve öncesi`);
  return parts.length ? parts.join(" · ") : "En yeni kayıt en üstte · Saatler Türkiye saatiyle";
}

function LogCard({ log, filters, options }: { log: AuditLogPage; filters: Filters; options: AuditFilterOptions }) {
  const title = `${formatNumber(log.total)} kayıt`;
  return (
    <Card title={title} description={describeFilters(filters, options)} flush>
      {log.rows.length === 0 ? (
        hasFilters(filters) ? (
          <EmptyState
            icon={SearchX}
            title="Bu filtrelerle kayıt yok"
            description="Tarih aralığını genişletin veya başka bir kayıt türü seçin."
            action={
              <Link href={BASE} className="text-sm font-medium text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Filtreleri temizle
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={ScrollText}
            title="Henüz işlem kaydı yok"
            description="Panelde bir ürün, sayfa veya ayar değiştirildiğinde kim, neyi, ne zaman değiştirdi burada görünür."
          />
        )
      ) : (
        <>
          <ol className="divide-y divide-border">
            {log.rows.map((row) => (
              <LogEntry key={row.id} row={row} />
            ))}
          </ol>
          <Pagination log={log} filters={filters} />
        </>
      )}
    </Card>
  );
}

function actorName(row: AuditLogRow): string {
  if (!row.userId) return "Sistem";
  return row.userName ?? row.userEmail ?? "Silinmiş kullanıcı";
}

function LogEntry({ row }: { row: AuditLogRow }) {
  const action = actionInfo(row.action);
  const subject =
    (row.entity === "user" ? row.subjectUserName : null) ??
    (row.entity === "settings" && row.entityId === "giftWheel" ? "Hediye Çarkı" : null) ??
    (row.entity === "settings" ? (SETTINGS_PAGES.find((p) => p.key === row.entityId)?.label ?? null) : null) ??
    auditSubject(row.before, row.after);
  const changes = diffAudit(row.before, row.after).filter((d) => d.kind !== "same").length;
  const href = entityHref(row.entity, row.entityId);
  const name = actorName(row);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:flex-nowrap sm:px-5 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="hidden size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-xs font-medium text-text sm:grid"
          >
            {row.userId ? initials(name) : "S"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-text">{name}</span>
              <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
              <span className="min-w-0 text-text">
                <span className="text-text-muted">{entityLabel(row.entity)}</span>
                {subject ? <span className="font-medium"> · {subject}</span> : null}
                {row.entityId && !subject ? <span className="tabular-nums text-text-muted"> #{row.entityId}</span> : null}
              </span>
            </span>
            <time dateTime={row.createdAt} className="mt-0.5 block text-xs text-text-muted">
              {formatDateTime(row.createdAt)}
            </time>
          </span>
          <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
            {changes > 0 ? `${formatNumber(changes)} alan` : "Ayrıntı"}
            <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className="border-t border-border bg-surface-2/30">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-text-muted sm:px-5">
            <span>
              Kayıt no <span className="tabular-nums">{formatNumber(row.id)}</span>
              {row.entityId ? (
                <>
                  {" "}
                  · {entityLabel(row.entity)} kimliği <code className="font-mono text-text">{row.entityId}</code>
                </>
              ) : null}
            </span>
            {href ? (
              <Link
                href={href}
                className="inline-flex items-center gap-1 font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {entityLabel(row.entity)} sayfasını aç
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <div className="border-t border-border bg-surface">
            <AuditDiff before={row.before} after={row.after} />
          </div>
        </div>
      </details>
    </li>
  );
}

function Pagination({ log, filters }: { log: AuditLogPage; filters: Filters }) {
  const from = (log.page - 1) * log.pageSize + 1;
  const to = Math.min(log.total, log.page * log.pageSize);
  const prev = log.page > 1 ? auditHref(filters, log.page - 1) : null;
  const next = log.page < log.pageCount ? auditHref(filters, log.page + 1) : null;
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const disabledClass = "inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted opacity-50";
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-sm text-text-muted">
        <span className="tabular-nums">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        / <span className="tabular-nums">{formatNumber(log.total)}</span> kayıt
        {log.pageCount > 1 ? (
          <span className="hidden sm:inline">
            {" "}
            · Sayfa {formatNumber(log.page)} / {formatNumber(log.pageCount)}
          </span>
        ) : null}
      </p>
      {log.pageCount > 1 ? (
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
