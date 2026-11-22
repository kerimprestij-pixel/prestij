import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { findNavItem, PANEL_NAV } from "@/components/panel/nav-config";
import { Skeleton } from "@/components/panel/Skeleton";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Hazırlanıyor" };

type Params = Promise<{ slug: string[] }>;

/** "Coming soon" page for panel sections listed in the sidebar but not built yet. */
export default function SectionPlaceholderPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<PlaceholderSkeleton />}>
      <SectionPlaceholder params={params} />
    </Suspense>
  );
}

async function SectionPlaceholder({ params }: { params: Params }) {
  await requireStaff();
  const { slug } = await params;
  const item = findNavItem(`/panel/${slug.map(encodeURIComponent).join("/")}`);
  // Built sections (e.g. Siparişler) own their URLs; unknown sub-paths there are a 404, not "coming soon".
  if (!item || item.href === "/panel" || item.ready) notFound();
  if (item.minRole) await requireStaff(item.minRole);

  const group = PANEL_NAV.find((g) => g.items.includes(item))?.title;
  const Icon = item.icon;

  return (
    <div className="mx-auto max-w-2xl py-6 sm:py-12">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-6 py-12 text-center sm:px-12 sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gold to-transparent"
        />
        <span className="mx-auto grid size-14 place-items-center rounded-full border border-gold/40 bg-gold/10 text-gold-text">
          <Icon aria-hidden className="size-6" strokeWidth={1.5} />
        </span>
        {group ? <p className="eyebrow mt-6">{group}</p> : null}
        <h1 className="mt-2 font-heading text-3xl font-medium text-text sm:text-4xl">{item.label}</h1>
        <p className="mt-4 text-base font-medium text-text">Bu bölüm hazırlanıyor</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
          {item.summary} Bu ekran kısa süre içinde panele eklenecek.
        </p>
        <Link
          href="/panel"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-contrast transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
          Genel Bakış&apos;a dön
        </Link>
      </div>
    </div>
  );
}

function PlaceholderSkeleton() {
  return (
    <div role="status" className="mx-auto max-w-2xl py-6 sm:py-12">
      <span className="sr-only">Yükleniyor…</span>
      <div className="flex flex-col items-center rounded-2xl border border-border bg-surface px-6 py-16">
        <Skeleton className="size-14 rounded-full" />
        <Skeleton className="mt-6 h-3 w-20" />
        <Skeleton className="mt-3 h-9 w-56" />
        <Skeleton className="mt-5 h-4 w-72 max-w-full" />
        <Skeleton className="mt-8 h-10 w-44 rounded-lg" />
      </div>
    </div>
  );
}
