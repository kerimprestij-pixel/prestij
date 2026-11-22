import { cn } from "@/lib/utils";
import Card from "./Card";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none", className)} />;
}

/** Announces loading once for screen readers; the shimmering blocks themselves are hidden. */
function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">Yükleniyor…</span>
      {children}
    </div>
  );
}

export function KpiGridSkeleton({ count = 5 }: { count?: number }) {
  return (
    <Loading className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-8 w-16" />
          <Skeleton className="mt-3 h-3 w-24" />
        </div>
      ))}
    </Loading>
  );
}

export function TableSkeleton({ rows = 6, title }: { rows?: number; title?: string }) {
  return (
    <Loading>
      <Card title={title} flush>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </Loading>
  );
}

export function ListSkeleton({ rows = 4, title }: { rows?: number; title?: string }) {
  return (
    <Loading>
      <Card title={title}>
        <div className="space-y-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </Loading>
  );
}

export function DetailSkeleton() {
  return (
    <Loading className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </Loading>
  );
}
