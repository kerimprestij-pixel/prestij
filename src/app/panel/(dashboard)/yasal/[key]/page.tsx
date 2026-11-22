import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import LegalDraftBanner from "@/components/panel/legal/LegalDraftBanner";
import LegalEditor, { type LegalEditorState } from "@/components/panel/legal/LegalEditor";
import PageHeader from "@/components/panel/PageHeader";
import { Skeleton } from "@/components/panel/Skeleton";
import { buttonClass } from "@/components/panel/ui/styles";
import { href } from "@/i18n/paths";
import { formatIstanbul } from "@/lib/panel/format";
import { LEGAL_KEY_PATTERN, splitLocalizedBody } from "@/lib/panel/legal/schemas";
import { getLegalEditorData } from "@/lib/panel/legal/service";
import { WHEEL_TERMS_LEGAL_KEY } from "@/lib/panel/seo/launch";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yasal metin" };

type Params = Promise<{ key: string }>;

export default function LegalEditorPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("admin");
  const { key } = await params;
  if (!LEGAL_KEY_PATTERN.test(key)) notFound();
  const data = await getLegalEditorData(key);
  if (!data) notFound();

  const source = data.current ?? null;
  const parts = splitLocalizedBody(source?.body ?? { tr: "" });
  const showNotice = source ? parts.hasNotice : true;
  const initial: LegalEditorState = {
    key: data.key,
    baseId: source?.id ?? null,
    baseUpdatedAt: source?.updatedAt ?? null,
    // The suggested label follows the draft notice: "taslak-N" while it is on, "2026-11 v1" once it is off.
    version: showNotice ? data.nextDraftVersion : data.nextVersion,
    title: source?.title ?? data.versions[0]?.title ?? { tr: "" },
    showNotice,
    notice: parts.notice,
    body: parts.body,
  };
  // Where a "taslak…" label has an effect: the checkout stays closed (contracts), or the wheel terms stay unapproved.
  const draftEffect = data.checkout ? "checkout" : data.key === WHEEL_TERMS_LEGAL_KEY ? "wheel" : null;
  const title = initial.title.tr || data.key;
  const pages = data.pages.map((p) => ({ slug: p.slug, title: p.title.tr, href: href("tr", "page", { slug: p.slug }), isPublished: p.isPublished }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/panel/yasal" className="inline-flex items-center gap-1.5 rounded hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <ArrowLeft aria-hidden className="size-3.5" />
            Yasal Metinler
          </Link>
        }
        title={title}
        description={
          source
            ? `Yürürlükte: ${source.version} · ${formatIstanbul(source.createdAt)} tarihinde yayınlandı. Her yayın yeni bir sürüm oluşturur.`
            : "Bu metnin yürürlükte bir sürümü yok; yayınladığınız sürüm hemen yürürlüğe girer."
        }
        actions={
          pages[0] ? (
            <a href={pages[0].href} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
              <ExternalLink aria-hidden className="size-4" />
              Sitede gör
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          ) : null
        }
      />
      <LegalDraftBanner checkout={data.checkout} />
      <LegalEditor
        initial={initial}
        title={title}
        checkout={data.checkout}
        draftEffect={draftEffect}
        suggestions={{ approved: data.nextVersion, draft: data.nextDraftVersion }}
        current={source ? { version: source.version, createdAt: source.createdAt } : null}
        versions={data.versions}
        pages={pages}
      />
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Yükleniyor…</span>
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[32rem] rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
