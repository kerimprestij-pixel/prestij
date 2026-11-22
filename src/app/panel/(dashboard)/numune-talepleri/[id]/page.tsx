import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, FileQuestion, Phone, Reply } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import Notice from "@/components/panel/Notice";
import CopyButton from "@/components/panel/orders/CopyButton";
import PageHeader from "@/components/panel/PageHeader";
import { LANGUAGE_LABEL, requestReplyMailto, sectorLabel, statusBadge } from "@/components/panel/requests/labels";
import { AdminNoteForm, SampleStatusActions } from "@/components/panel/requests/RequestActions";
import { BackLink, DetailRow, EmailLogCard } from "@/components/panel/requests/RequestListParts";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui";
import { formatInternationalPhone, telHref } from "@/lib/contact/links";
import { getSampleRequest, type SampleDetail } from "@/lib/requests/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Numune talebi" };

type Params = Promise<{ id: string }>;

export default function SamplePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <SampleView params={params} />
    </Suspense>
  );
}

async function SampleView({ params }: { params: Params }) {
  await requireStaff();
  const { id: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const sample = await getSampleRequest(Number(raw));
  if (!sample) {
    return (
      <div className="space-y-6">
        <BackLink href="/panel/numune-talepleri">Numune Talepleri</BackLink>
        <Card>
          <EmptyState
            icon={FileQuestion}
            title="Numune talebi bulunamadı"
            description="Bu talep silinmiş olabilir."
            action={
              <Link href="/panel/numune-talepleri" className={buttonClass("secondary", "sm")}>
                Taleplere dön
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const status = statusBadge(sample.status);
  const language = LANGUAGE_LABEL[sample.locale] ?? sample.locale;
  const quoted = sample.products.map((p) => p.name).join(", ");

  return (
    <div className="space-y-6">
      <BackLink href="/panel/numune-talepleri">Numune Talepleri</BackLink>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{sample.reference}</span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
        }
        title={sample.companyName}
        description={
          <>
            <time dateTime={sample.createdAt}>{formatDateTime(sample.createdAt)}</time> tarihinde {language} sayfadan gönderildi.
          </>
        }
        actions={
          <>
            <a
              href={requestReplyMailto({ kind: "sample", email: sample.email, contactName: sample.contactName, reference: sample.reference, locale: sample.locale, quoted })}
              className={buttonClass("secondary")}
            >
              <Reply aria-hidden className="size-4" />
              E-postayla yanıtla
            </a>
            <SampleStatusActions id={sample.id} status={sample.status} updatedAt={sample.updatedAt} email={sample.email} language={language} carriers={sample.carriers} />
          </>
        }
      />

      {sample.locale !== "tr" ? <Notice>Bu talep {language} sayfadan geldi. Müşteriye giden e-postalar {language} gönderilir.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Seçilen kokular" description={`${formatNumber(sample.products.length)} ürün`} flush>
            <ul className="grid gap-px bg-border sm:grid-cols-2">
              {sample.products.map((p) => (
                <li key={p.id} className="flex items-center gap-3 bg-surface px-5 py-3">
                  <span aria-hidden className="size-10 shrink-0 overflow-hidden rounded-full border border-border bg-surface-2" style={p.accent ? { backgroundColor: p.accent } : undefined}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a small panel thumbnail of a known local file
                      <img src={p.imageUrl} alt="" width={40} height={40} className="size-10 object-cover" loading="lazy" />
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-text">{p.name}</span>
                </li>
              ))}
            </ul>
          </Card>
          <ShippingCard sample={sample} />
          {sample.message ? (
            <Card title="Mesaj">
              <div dir="auto" lang={sample.locale} className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-text">
                {sample.message}
              </div>
            </Card>
          ) : null}
        </div>
        <div className="min-w-0 space-y-6">
          <RequesterCard sample={sample} language={language} />
          <Card title="Yönetici notu">
            <AdminNoteForm kind="sample" id={sample.id} note={sample.adminNote} updatedAt={sample.updatedAt} />
          </Card>
          <EmailLogCard emails={sample.emails} />
        </div>
      </div>
    </div>
  );
}

function ShippingCard({ sample }: { sample: SampleDetail }) {
  const a = sample.address;
  const label = `${sample.companyName}\n${a.fullName}\n${a.line1}\n${a.district} / ${a.city}\n${formatInternationalPhone(a.phone)}`;
  return (
    <Card title="Gönderim" description="Kargo etiketi için adresi tek tıkla kopyalayabilirsiniz.">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Adres</p>
          <address className="mt-1 whitespace-pre-line text-sm not-italic leading-relaxed text-text">{label}</address>
          <div className="mt-2">
            <CopyButton text={label} label="Adresi kopyala" srLabel="Gönderim adresini kopyala" />
          </div>
        </div>
        <dl className="space-y-4">
          <DetailRow label="Tahmini aylık tüketim">{sample.estimatedMonthlyLiters ? `${formatNumber(sample.estimatedMonthlyLiters)} litre` : "Belirtilmemiş"}</DetailRow>
          <DetailRow label="Onaylandı">{sample.approvedAt ? formatDateTime(sample.approvedAt) : "—"}</DetailRow>
          <DetailRow label="Kargo">
            {sample.carrier ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{sample.carrier.name}</span>
                <span className="font-mono">{sample.trackingNumber}</span>
                {sample.trackingUrl ? (
                  <a href={sample.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                    Takip et
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                ) : null}
              </span>
            ) : (
              <span className="text-text-muted">Henüz kargoya verilmedi</span>
            )}
          </DetailRow>
          {sample.shippedAt ? <DetailRow label="Kargoya verildi">{formatDateTime(sample.shippedAt)}</DetailRow> : null}
        </dl>
      </div>
    </Card>
  );
}

function RequesterCard({ sample, language }: { sample: SampleDetail; language: string }) {
  const phoneLink = telHref(sample.phone);
  return (
    <Card title="Firma ve yetkili">
      <dl className="space-y-4">
        <DetailRow label="Firma">{sample.companyName}</DetailRow>
        <DetailRow label="Sektör">{sectorLabel(sample.sector)}</DetailRow>
        <DetailRow label="Yetkili">{sample.contactName}</DetailRow>
        <DetailRow label="E-posta">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={`mailto:${sample.email}`} dir="ltr" className="break-all underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
              {sample.email}
            </a>
            <CopyButton text={sample.email} label="Kopyala" srLabel="E-posta adresini kopyala" />
          </span>
        </DetailRow>
        <DetailRow label="Telefon">
          {phoneLink ? (
            <a href={phoneLink} dir="ltr" className="inline-flex items-center gap-1.5 underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
              <Phone aria-hidden className="size-3.5" />
              {formatInternationalPhone(sample.phone)}
            </a>
          ) : (
            <span dir="ltr">{sample.phone}</span>
          )}
        </DetailRow>
        <DetailRow label="Dil">{language}</DetailRow>
        <DetailRow label="KVKK onayı">{sample.consentAt ? formatDateTime(sample.consentAt) : "—"}</DetailRow>
      </dl>
    </Card>
  );
}
