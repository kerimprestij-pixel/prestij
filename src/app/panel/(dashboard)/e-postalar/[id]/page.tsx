import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import Card from "@/components/panel/Card";
import EmailActions from "@/components/panel/emails/EmailActions";
import EmailPreviewFrame from "@/components/panel/emails/EmailPreviewFrame";
import { EMAIL_LOCALE_LABELS, EMAIL_RELATED_LABELS, EMAIL_STATUS_LABELS, relatedHref, relatedRef } from "@/components/panel/emails/labels";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isStaffUserRole } from "@/lib/b2b/service";
import { getEmailTemplate } from "@/lib/email";
import { emailLogHref } from "@/lib/panel/emails/filter";
import { getEmailMessage, type EmailMessageDetail } from "@/lib/panel/emails/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "E-posta" };

type Params = Promise<{ id: string }>;

export default function EmailDetailPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/e-postalar"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        E-postalar
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <EmailDetail params={params} />
      </Suspense>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-end text-sm text-text">{children}</dd>
    </div>
  );
}

async function EmailDetail({ params }: { params: Params }) {
  await requireStaff("staff");
  const { id } = await params;
  const mail = /^\d{1,10}$/.test(id) ? await getEmailMessage(db, Number(id)) : null;
  if (!mail) notFound();
  const template = getEmailTemplate(mail.template);
  const st = EMAIL_STATUS_LABELS[mail.status];

  return (
    <div className="space-y-6">
      <header className="min-w-0">
        <p className="eyebrow">{template?.label ?? mail.template}</p>
        <h1 className="mt-1 font-heading text-2xl font-medium leading-tight text-text sm:text-3xl">{mail.subject}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          <span className="break-all">{mail.toEmail}</span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:order-2">
          <Card title="Gönderim">
            <dl className="-my-2.5 divide-y divide-border">
              <Row label="Durum">
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </Row>
              <Row label="Oluşturuldu">{formatDateTime(mail.createdAt)}</Row>
              {mail.status === "queued" && new Date(mail.sendAfter).getTime() > Date.parse(mail.createdAt) + 1000 ? (
                <Row label="Gönderim zamanı">{formatDateTime(mail.sendAfter)}</Row>
              ) : null}
              <Row label="Gönderildi">{mail.sentAt ? formatDateTime(mail.sentAt) : "—"}</Row>
              <Row label="Deneme">{formatNumber(mail.attempts)}</Row>
              <Row label="Dil">{EMAIL_LOCALE_LABELS[mail.locale] ?? mail.locale}</Row>
              <Row label="İlgili kayıt">
                <RelatedLink mail={mail} customer={await isCustomerUser(mail)} />
              </Row>
              <Row label="Gönderen">{mail.createdByName ?? (mail.createdBy ? "Panel kullanıcısı" : "Sistem (otomatik)")}</Row>
            </dl>
            {mail.lastError ? (
              <p className="mt-4 rounded-lg border border-[#C2413A]/30 bg-[#C2413A]/8 px-3 py-2.5 text-xs leading-relaxed text-text">
                <span className="font-medium">Son hata:</span> {mail.lastError}
              </p>
            ) : null}
            {mail.headers?.["List-Unsubscribe"] ? (
              <p className="mt-4 text-xs leading-relaxed text-text-muted">Pazarlama e-postası: tek tıkla abonelikten çıkma başlıkları (List-Unsubscribe) eklendi.</p>
            ) : null}
            <div className="mt-5 border-t border-border pt-5">
              <EmailActions
                id={mail.id}
                to={mail.toEmail}
                canCancel={mail.status === "queued"}
                canResend={Boolean(mail.html) && !template?.marketing && !mail.authLink && mail.status !== "queued" && mail.status !== "sending"}
              />
              {template?.marketing ? (
                <p className="mt-3 text-xs text-text-muted">Kampanya e-postaları tek tek yeniden gönderilemez.</p>
              ) : mail.authLink ? (
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  Güvenlik nedeniyle bu e-posta panelden yeniden gönderilemez. Müşteri yeni bağlantıyı sitedeki formdan isteyebilir.
                </p>
              ) : null}
            </div>
          </Card>
        </div>
        <div className="min-w-0 lg:order-1">
          <Card
            title="İçerik"
            description={
              mail.redacted
                ? "Alıcıya gönderilen haliyle; kişiye özel güvenlik bağlantıları (şifre, doğrulama, sipariş, abonelik ve değerlendirme bağlantıları) gizlendi."
                : "Alıcıya gönderilen haliyle (bağlantılar yeni sekmede açılır)."
            }
          >
            {mail.html ? (
              <EmailPreviewFrame html={mail.html} text={mail.text} title={`E-posta: ${mail.subject}`} />
            ) : (
              <p className="text-sm text-text-muted">Bu e-postanın içeriği oluşturulamadı.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A user mail links to the customer page only for customers (team members have none). */
async function isCustomerUser(mail: EmailMessageDetail): Promise<boolean> {
  if (mail.relatedType !== "user" || !mail.relatedId) return false;
  const [u] = await db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, mail.relatedId)).limit(1);
  return Boolean(u) && !isStaffUserRole(u.role);
}

function RelatedLink({ mail, customer }: { mail: EmailMessageDetail; customer: boolean }) {
  if (!mail.relatedType) return <>—</>;
  const label = EMAIL_RELATED_LABELS[mail.relatedType as keyof typeof EMAIL_RELATED_LABELS] ?? mail.relatedType;
  if (mail.relatedType === "test") return <>{label}</>;
  const href = relatedHref(mail.relatedType, mail.relatedId, { customer });
  const ref = relatedRef(mail.relatedType, mail.relatedId);
  const listHref = emailLogHref({ related: { type: mail.relatedType as never, id: mail.relatedId } });
  return (
    <span className="flex flex-col items-end gap-0.5">
      {href ? (
        <Link href={href} className="font-medium underline-offset-4 hover:underline">
          {label} {ref}
        </Link>
      ) : (
        <span>
          {label} {ref}
        </span>
      )}
      <Link href={listHref} className="text-xs text-text-muted underline-offset-4 hover:text-text hover:underline">
        Bu kayda ait e-postalar
      </Link>
    </span>
  );
}
