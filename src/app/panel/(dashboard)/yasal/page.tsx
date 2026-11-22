import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, ExternalLink, FileText, ShoppingBag } from "lucide-react";
import EmptyState from "@/components/panel/EmptyState";
import LegalDraftBanner from "@/components/panel/legal/LegalDraftBanner";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton } from "@/components/panel/Skeleton";
import Badge from "@/components/panel/ui/Badge";
import { href } from "@/i18n/paths";
import { formatIstanbul } from "@/lib/panel/format";
import { isDraftLegalVersion } from "@/lib/panel/legal/draft";
import { listLegalDocuments, type LegalListItem } from "@/lib/panel/legal/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yasal Metinler" };

export default function LegalListPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="İçerik ve Görünüm"
        title="Yasal Metinler"
        description="Sözleşmeler ve bilgilendirme metinleri sürümlerle tutulur: her yayın yeni bir sürümdür, eski sürümler geçmişte kalır ve geri yüklenebilir."
      />
      <LegalDraftBanner />
      <Suspense fallback={<ListSkeleton />}>
        <LegalList />
      </Suspense>
    </div>
  );
}

async function LegalList() {
  await requireStaff("admin");
  const docs = await listLegalDocuments();
  if (docs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState icon={FileText} title="Henüz yasal metin yok" description="Yasal metinler ilk kurulumda eklenir; kurulum betiğini çalıştırın." />
      </div>
    );
  }
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {docs.map((doc) => (
        <li key={doc.key} className="min-w-0">
          <LegalCard doc={doc} />
        </li>
      ))}
    </ul>
  );
}

function LegalCard({ doc }: { doc: LegalListItem }) {
  const editHref = `/panel/yasal/${doc.key}`;
  return (
    <article className="group relative flex h-full flex-col rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(3_38_95/0.04)] transition-[border-color,box-shadow] focus-within:border-gold/50 hover:border-gold/50 hover:shadow-[0_6px_20px_-12px_rgb(3_38_95/0.25)] motion-reduce:transition-none">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-gold/35 bg-gold/10 text-gold-text">
          <FileText aria-hidden className="size-[1.125rem]" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium text-text">
            <Link href={editHref} className="rounded after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
              {doc.title.tr || doc.key}
            </Link>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            {doc.version ? (
              <>
                {/* A "taslak…" label marks a draft (for the sales contracts: the checkout stays closed). */}
                <Badge tone={isDraftLegalVersion(doc.version) ? "warning" : "success"} size="sm" title={isDraftLegalVersion(doc.version) ? "Taslak sürüm" : undefined}>
                  {doc.version}
                </Badge>
                <span>{formatIstanbul(doc.publishedAt)} tarihinde yayınlandı</span>
                {doc.checkout && isDraftLegalVersion(doc.version) ? <span className="text-text">· taslak: ödeme sayfası kapalı</span> : null}
              </>
            ) : (
              <Badge tone="danger" size="sm">
                Yürürlükte sürüm yok
              </Badge>
            )}
          </p>
        </div>
        <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-text-muted">
        <span>{doc.versionCount} sürüm</span>
        {doc.checkout ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-text">
            <ShoppingBag aria-hidden className="size-3" />
            Ödeme sayfasında
          </span>
        ) : null}
        {doc.pages.map((page) => (
          <a
            key={page.slug}
            href={href("tr", "page", { slug: page.slug })}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-text hover:border-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ExternalLink aria-hidden className="size-3" />/sayfa/{page.slug}
            {!page.isPublished ? <span className="text-text-muted"> (yayında değil)</span> : null}
            <span className="sr-only"> (yeni sekmede açılır)</span>
          </a>
        ))}
      </div>
    </article>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-live="polite" className="grid gap-4 lg:grid-cols-2">
      <span className="sr-only">Yükleniyor…</span>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start gap-4">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
          </div>
          <Skeleton className="mt-5 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
