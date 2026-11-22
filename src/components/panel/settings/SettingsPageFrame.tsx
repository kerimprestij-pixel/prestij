import { Suspense } from "react";
import { Skeleton } from "@/components/panel/Skeleton";
import { settingsPage } from "./settings-pages";

/** Heading of one settings screen (icon, title, one line) and its editor, streamed after the admin check. */
export default function SettingsPageFrame({ slug, children }: { slug: string; children: React.ReactNode }) {
  const page = settingsPage(slug);
  const Icon = page.icon;
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-gold/35 bg-gold/10 text-gold-text">
          <Icon aria-hidden className="size-5" strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-medium leading-tight text-text sm:text-[1.75rem]">{page.label}</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{page.description}</p>
        </div>
      </header>
      <Suspense fallback={<SettingsFormSkeleton />}>{children}</Suspense>
    </div>
  );
}

export function SettingsFormSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Yükleniyor…</span>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface">
          <div className="space-y-2 border-b border-border px-6 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <div className="grid gap-5 p-6 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
