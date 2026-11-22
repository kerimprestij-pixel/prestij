import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, MailQuestion, Phone, Reply } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime } from "@/components/panel/labels";
import { MarkReadOnOpen, MessageActions } from "@/components/panel/messages/MessageActions";
import { LOCALE_LABEL, replyMailto, SUBJECT_TONE, subjectLabel } from "@/components/panel/messages/labels";
import Notice from "@/components/panel/Notice";
import CopyButton from "@/components/panel/orders/CopyButton";
import PageHeader from "@/components/panel/PageHeader";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui";
import { telHref } from "@/lib/contact/links";
import { getContactMessage } from "@/lib/panel/messages/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Mesaj" };

type Params = Promise<{ id: string }>;

export default function MessagePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <MessageView params={params} />
    </Suspense>
  );
}

const backLinkClass =
  "inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

async function MessageView({ params }: { params: Params }) {
  await requireStaff();
  const { id: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const message = await getContactMessage(Number(raw));

  if (!message) {
    // Also what the page re-renders into right after "Sil", before the client moves back to the list.
    return (
      <div className="space-y-6">
        <Link href="/panel/mesajlar" className={backLinkClass}>
          <ArrowLeft aria-hidden className="size-4" />
          Mesajlar
        </Link>
        <Card>
          <EmptyState
            icon={MailQuestion}
            title="Mesaj bulunamadı"
            description="Bu mesaj silinmiş olabilir."
            action={
              <Link href="/panel/mesajlar" className={buttonClass("secondary", "sm")}>
                Mesajlara dön
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const phoneLink = telHref(message.phone);
  const language = LOCALE_LABEL[message.locale] ?? message.locale;
  const dt = "text-xs font-medium uppercase tracking-[0.12em] text-text-muted";
  const dd = "mt-1 text-sm text-text";

  return (
    <div className="space-y-6">
      <MarkReadOnOpen id={message.id} isRead={message.isRead} />
      <Link href="/panel/mesajlar" className={backLinkClass}>
        <ArrowLeft aria-hidden className="size-4" />
        Mesajlar
      </Link>
      <PageHeader
        eyebrow={subjectLabel(message.subject)}
        title={message.name}
        description={
          <>
            <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time> tarihinde {language} sayfadan gönderildi.
          </>
        }
        actions={
          <>
            <a href={replyMailto(message)} className={buttonClass("primary")}>
              <Reply aria-hidden className="size-4" />
              E-postayla yanıtla
            </a>
            <MessageActions id={message.id} isRead={message.isRead} senderName={message.name} />
          </>
        }
      />

      {message.locale !== "tr" ? (
        <Notice>
          Bu mesaj {language} sayfadan gönderildi. “E-postayla yanıtla” {language} bir selamlamayla açılır; yanıtınızı da {language} yazmanız iyi
          olur.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Mesaj" className="lg:col-span-2">
          <div dir="auto" lang={message.locale} className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-text">
            {message.message}
          </div>
        </Card>
        <Card title="Gönderen">
          <dl className="space-y-4">
            <div>
              <dt className={dt}>Ad soyad</dt>
              <dd className={dd}>{message.name}</dd>
            </div>
            <div>
              <dt className={dt}>E-posta</dt>
              <dd className={`${dd} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                <a href={`mailto:${message.email}`} dir="ltr" className="break-all underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                  {message.email}
                </a>
                <CopyButton text={message.email} label="Kopyala" srLabel="E-posta adresini kopyala" />
              </dd>
            </div>
            <div>
              <dt className={dt}>Telefon</dt>
              <dd className={dd}>
                {message.phone ? (
                  phoneLink ? (
                    <a href={phoneLink} dir="ltr" className="inline-flex items-center gap-1.5 underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                      <Phone aria-hidden className="size-3.5" />
                      {message.phone}
                    </a>
                  ) : (
                    <span dir="ltr">{message.phone}</span>
                  )
                ) : (
                  <span className="text-text-muted">Belirtilmemiş</span>
                )}
              </dd>
            </div>
            <div>
              <dt className={dt}>Konu</dt>
              <dd className="mt-1.5">
                <StatusBadge tone={message.subject ? SUBJECT_TONE[message.subject] : "neutral"}>{subjectLabel(message.subject)}</StatusBadge>
              </dd>
            </div>
            <div>
              <dt className={dt}>Dil</dt>
              <dd className={dd}>{language}</dd>
            </div>
            <div>
              <dt className={dt}>Durum</dt>
              <dd className={dd}>{message.isRead ? "Okundu" : "Okunmadı"}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
