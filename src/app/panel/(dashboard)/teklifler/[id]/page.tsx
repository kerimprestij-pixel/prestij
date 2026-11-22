import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FileQuestion, Phone, Reply } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDate, formatDateTime, formatNumber } from "@/components/panel/labels";
import Notice from "@/components/panel/Notice";
import CopyButton from "@/components/panel/orders/CopyButton";
import PageHeader from "@/components/panel/PageHeader";
import { LANGUAGE_LABEL, requestReplyMailto, sectorLabel, statusBadge } from "@/components/panel/requests/labels";
import QuoteOfferEditor from "@/components/panel/requests/QuoteOfferEditor";
import { AdminNoteForm, QuoteStatusActions } from "@/components/panel/requests/RequestActions";
import { BackLink, DetailRow, EmailLogCard } from "@/components/panel/requests/RequestListParts";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui";
import { formatInternationalPhone, telHref } from "@/lib/contact/links";
import { formatTryAmount } from "@/lib/panel/format";
import { getQuoteRequest, type QuoteDetail } from "@/lib/requests/queries";
import { QUOTE_OFFER_FROM } from "@/lib/requests/types";
import { istanbulToday } from "@/lib/requests/workflow";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Teklif talebi" };

type Params = Promise<{ id: string }>;

export default function QuotePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <QuoteView params={params} />
    </Suspense>
  );
}

async function QuoteView({ params }: { params: Params }) {
  await requireStaff();
  const { id: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const quote = await getQuoteRequest(Number(raw));
  if (!quote) {
    return (
      <div className="space-y-6">
        <BackLink href="/panel/teklifler">Teklif Talepleri</BackLink>
        <Card>
          <EmptyState
            icon={FileQuestion}
            title="Teklif talebi bulunamadı"
            description="Bu talep silinmiş olabilir."
            action={
              <Link href="/panel/teklifler" className={buttonClass("secondary", "sm")}>
                Taleplere dön
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const status = statusBadge(quote.status);
  const language = LANGUAGE_LABEL[quote.locale] ?? quote.locale;
  const now = new Date();
  const validDefault = istanbulToday(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
  const canSend = QUOTE_OFFER_FROM.includes(quote.status);
  const quoted = quote.lines.map((l) => `${l.quantity} × ${[l.label, l.detail].filter(Boolean).join(" · ")}`).join("\n");

  return (
    <div className="space-y-6">
      <BackLink href="/panel/teklifler">Teklif Talepleri</BackLink>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{quote.reference}</span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
        }
        title={quote.companyName}
        description={
          <>
            <time dateTime={quote.createdAt}>{formatDateTime(quote.createdAt)}</time> tarihinde {language} sayfadan gönderildi.
          </>
        }
        actions={
          <>
            <a
              href={requestReplyMailto({ kind: "quote", email: quote.email, contactName: quote.contactName, reference: quote.reference, locale: quote.locale, quoted })}
              className={buttonClass("secondary")}
            >
              <Reply aria-hidden className="size-4" />
              E-postayla yanıtla
            </a>
            <QuoteStatusActions id={quote.id} status={quote.status} updatedAt={quote.updatedAt} email={quote.email} />
          </>
        }
      />

      {quote.locale !== "tr" ? (
        <Notice>
          Bu talep {language} sayfadan geldi. Teklif e-postası {language} gönderilir; müşteriye notunuzu da {language} yazmanız iyi olur.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <RequestedLines quote={quote} />
          <Card
            title={quote.status === "quoted" ? "Teklif (gönderildi)" : "Teklif hazırla"}
            description={
              canSend
                ? "Birim fiyatları girin; toplam otomatik hesaplanır. Gönderdiğinizde müşteri teklifi e-postayla alır."
                : "Bu talep kapandı; son gönderilen teklif aşağıda. Yeniden teklif vermek için talebi yeniden açın."
            }
          >
            {canSend ? (
              <QuoteOfferEditor
                id={quote.id}
                updatedAt={quote.updatedAt}
                status={quote.status}
                email={quote.email}
                locale={quote.locale}
                lines={quote.lines}
                offer={quote.offer}
                quotedAt={quote.quotedAt}
                variantOptions={quote.variantOptions}
                priceGroup={quote.priceGroup}
                defaultValidUntil={validDefault}
                today={istanbulToday(now)}
                canSend={canSend}
              />
            ) : (
              <OfferSummary quote={quote} />
            )}
          </Card>
          {quote.message ? (
            <Card title="Mesaj">
              <div dir="auto" lang={quote.locale} className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-text">
                {quote.message}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <RequesterCard quote={quote} language={language} />
          <Card title="Yönetici notu">
            <AdminNoteForm kind="quote" id={quote.id} note={quote.adminNote} updatedAt={quote.updatedAt} />
          </Card>
          <EmailLogCard emails={quote.emails} />
        </div>
      </div>
    </div>
  );
}

function RequestedLines({ quote }: { quote: QuoteDetail }) {
  const totalQuantity = quote.lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <Card title="Talep edilen ürünler" description={`${formatNumber(quote.lines.length)} kalem · ${formatNumber(totalQuantity)} adet`} flush>
      <ul className="divide-y divide-border">
        {quote.lines.map((line, i) => (
          <li key={i} className="flex items-center gap-3 px-5 py-3">
            <span
              aria-hidden
              className="size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2"
              style={line.accent ? { backgroundColor: line.accent } : undefined}
            >
              {line.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a small panel thumbnail of a known local file
                <img src={line.imageUrl} alt="" width={40} height={40} className="size-10 object-cover" loading="lazy" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">{line.label}</span>
              <span className="block text-xs text-text-muted">{line.variantId ? (line.detail ?? "Ürün") : "Serbest satır (müşterinin yazdığı)"}</span>
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-text">× {formatNumber(line.quantity)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OfferSummary({ quote }: { quote: QuoteDetail }) {
  if (!quote.offer) return <p className="text-sm text-text-muted">Bu talep için teklif gönderilmedi.</p>;
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {quote.offer.lines.map((l, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
            <span className="min-w-0 text-text">{l.label}</span>
            <span className="tabular-nums text-text-muted">
              {formatNumber(l.quantity)} × {formatTryAmount(l.unitPrice, { symbol: true })} ={" "}
              <span className="font-medium text-text">{formatTryAmount(l.unitPrice * l.quantity, { symbol: true })}</span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid gap-4 sm:grid-cols-3">
        <DetailRow label="Toplam (KDV dahil)">
          <span className="font-heading text-xl tabular-nums">{formatTryAmount(quote.offer.total, { symbol: true })}</span>
        </DetailRow>
        <DetailRow label="Geçerlilik">{quote.offer.validUntil ? formatDate(`${quote.offer.validUntil}T12:00:00+03:00`) : "Belirtilmemiş"}</DetailRow>
        <DetailRow label="Gönderildi">{quote.quotedAt ? formatDateTime(quote.quotedAt) : "—"}</DetailRow>
      </dl>
      {quote.offer.note ? <p className="whitespace-pre-wrap rounded-lg bg-surface-2/60 px-4 py-3 text-sm text-text">{quote.offer.note}</p> : null}
    </div>
  );
}

function RequesterCard({ quote, language }: { quote: QuoteDetail; language: string }) {
  const phoneLink = telHref(quote.phone);
  return (
    <Card title="Firma ve yetkili">
      <dl className="space-y-4">
        <DetailRow label="Firma">{quote.companyName}</DetailRow>
        <DetailRow label="Sektör">{sectorLabel(quote.sector)}</DetailRow>
        <DetailRow label="Yetkili">{quote.contactName}</DetailRow>
        <DetailRow label="E-posta">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={`mailto:${quote.email}`} dir="ltr" className="break-all underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
              {quote.email}
            </a>
            <CopyButton text={quote.email} label="Kopyala" srLabel="E-posta adresini kopyala" />
          </span>
        </DetailRow>
        <DetailRow label="Telefon">
          {quote.phone ? (
            phoneLink ? (
              <a href={phoneLink} dir="ltr" className="inline-flex items-center gap-1.5 underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                <Phone aria-hidden className="size-3.5" />
                {formatInternationalPhone(quote.phone)}
              </a>
            ) : (
              <span dir="ltr">{quote.phone}</span>
            )
          ) : (
            <span className="text-text-muted">Belirtilmemiş</span>
          )}
        </DetailRow>
        <DetailRow label="Dil">{language}</DetailRow>
        <DetailRow label="Hesap">
          {quote.company ? (
            <Link href={`/panel/kurumsal-hesaplar/${quote.company.id}`} className="underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
              {quote.company.name}
            </Link>
          ) : quote.userId ? (
            "Üye hesabıyla gönderildi"
          ) : (
            <span className="text-text-muted">Misafir</span>
          )}
        </DetailRow>
        <DetailRow label="KVKK onayı">{quote.consentAt ? formatDateTime(quote.consentAt) : "—"}</DetailRow>
      </dl>
    </Card>
  );
}
