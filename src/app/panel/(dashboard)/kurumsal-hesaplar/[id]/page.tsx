import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import Card, { CardLink } from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import CompanyDecision from "@/components/panel/b2b/CompanyDecision";
import CompanyEditor, { type CompanyEditorState } from "@/components/panel/b2b/CompanyEditor";
import { BACK_LINK_CLASS, DetailRow, EMAIL_STATUS_LABEL, groupLabel, groupSummary, termsLabel } from "@/components/panel/b2b/shared";
import { COMPANY_STATUS, formatDate, formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import Notice from "@/components/panel/Notice";
import { PAYMENT_METHOD_SHORT } from "@/components/panel/orders/labels";
import PageHeader from "@/components/panel/PageHeader";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui";
import { formatBusinessPhone, SECTOR_LABELS_TR, VOLUME_LABELS_TR } from "@/lib/b2b/application";
import { getCompanyDetail, type CompanyDetail } from "@/lib/b2b/queries";
import { formatTryAmount } from "@/lib/panel/format";
import { hasRole } from "@/lib/panel/roles";
import { isSafeHref } from "@/lib/safe-href";
import { requireStaff } from "@/lib/session";
import { TR_PROVINCE_NAMES } from "@/lib/validation/tr";

export const metadata: Metadata = { title: "Kurumsal hesap" };

type Params = Promise<{ id: string }>;

export default function CompanyPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <CompanyView params={params} />
    </Suspense>
  );
}

async function CompanyView({ params }: { params: Params }) {
  const session = await requireStaff();
  const { id: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const company = await getCompanyDetail(Number(raw));
  if (!company) return <Missing />;
  const isAdmin = hasRole(session.staffRole, "admin");
  const status = COMPANY_STATUS[company.status];
  const recipient = company.applicant && !company.applicant.anonymized ? company.applicant.email : company.email;
  const defaultGroupId = company.groups.find((g) => g.slug === company.defaultGroupSlug)?.id ?? null;

  return (
    <div className="space-y-6">
      <Link href="/panel/kurumsal-hesaplar" className={BACK_LINK_CLASS}>
        <ArrowLeft aria-hidden className="size-4" />
        Kurumsal Hesaplar
      </Link>
      <PageHeader
        eyebrow={SECTOR_LABELS_TR[company.sector]}
        title={company.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <span>
              Başvuru: <time dateTime={company.createdAt}>{formatDateTime(company.createdAt)}</time>
            </span>
            {company.approvedAt ? (
              <span>
                Onay: <time dateTime={company.approvedAt}>{formatDateTime(company.approvedAt)}</time>
              </span>
            ) : null}
            {company.rejectedAt ? (
              <span>
                Ret: <time dateTime={company.rejectedAt}>{formatDateTime(company.rejectedAt)}</time>
              </span>
            ) : null}
          </span>
        }
        actions={
          isAdmin ? (
            <CompanyDecision
              company={{ id: company.id, name: company.name, status: company.status, updatedAt: company.updatedAt, groupId: company.groupId, paymentTerms: company.paymentTerms }}
              groups={company.groups}
              defaultGroupId={defaultGroupId}
              recipient={recipient}
            />
          ) : null
        }
      />

      {!isAdmin ? <Notice>Başvuruları onaylamak, reddetmek ve firma bilgilerini düzenlemek yönetici yetkisi gerektirir.</Notice> : null}
      {company.status === "rejected" && company.rejectionReason ? (
        <Notice tone="warning">
          <p className="font-medium">Ret gerekçesi (müşteriye gönderildi)</p>
          <p className="mt-1 whitespace-pre-line">{company.rejectionReason}</p>
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {company.status === "approved" ? <TermsCard company={company} /> : null}
          <Card title="Firma bilgileri" description={isAdmin ? "Değişiklikler kaydedildiğinde firmanın sonraki e-postalarında kullanılır." : undefined}>
            {isAdmin ? <CompanyEditor initial={editorState(company)} provinces={[...TR_PROVINCE_NAMES]} /> : <CompanyFacts company={company} />}
          </Card>
          <OrdersCard company={company} />
        </div>
        <div className="min-w-0 space-y-6">
          <ApplicationCard company={company} />
          <MembersCard company={company} />
          <EmailsCard company={company} />
        </div>
      </div>
    </div>
  );
}

function editorState(c: CompanyDetail): CompanyEditorState {
  return {
    id: c.id,
    updatedAt: c.updatedAt,
    adminNote: c.adminNote ?? "",
    fields: {
      companyName: c.name,
      sector: c.sector,
      taxOffice: c.taxOffice ?? "",
      taxNumber: c.taxNumber ?? "",
      phone: formatBusinessPhone(c.phone),
      email: c.email ?? "",
      website: c.website ?? "",
      address: { city: c.address?.city ?? "", district: c.address?.district ?? "", line1: c.address?.line1 ?? "", postalCode: c.address?.postalCode ?? "" },
    },
  };
}

function TermsCard({ company }: { company: CompanyDetail }) {
  return (
    <Card title="Hesap koşulları" description="Firmanın üyeleri bu grubun fiyatlarını görür; vadeli ödeme açıksa ödeme adımında sunulur.">
      <dl className="grid gap-4 sm:grid-cols-3">
        <DetailRow label="Müşteri grubu">{company.group ? groupSummary(company.group) : <span className="text-[#B5730C]">Grup yok (perakende fiyat)</span>}</DetailRow>
        <DetailRow label="Ödeme koşulu">{termsLabel(company.paymentTerms)}</DetailRow>
        <DetailRow label="Fiyat gösterimi">{company.group?.showPricesExVat ? "KDV hariç" : "KDV dahil"}</DetailRow>
      </dl>
    </Card>
  );
}

function CompanyFacts({ company }: { company: CompanyDetail }) {
  const website = company.website && isSafeHref(company.website) ? company.website : null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <DetailRow label="Vergi dairesi">{company.taxOffice}</DetailRow>
      <DetailRow label="Vergi no" ltr>
        {company.taxNumber}
      </DetailRow>
      <DetailRow label="Telefon" ltr>
        {company.phone ? formatBusinessPhone(company.phone) : null}
      </DetailRow>
      <DetailRow label="E-posta" ltr>
        {company.email}
      </DetailRow>
      <DetailRow label="Web sitesi" ltr>
        {website ? (
          <a href={website} target="_blank" rel="noopener noreferrer" className="underline decoration-gold/60 underline-offset-4">
            {website}
          </a>
        ) : null}
      </DetailRow>
      <DetailRow label="Adres">
        {company.address ? [company.address.line1, [company.address.district, company.address.city].filter(Boolean).join(" / "), company.address.postalCode].filter(Boolean).join(", ") : null}
      </DetailRow>
      {company.adminNote ? (
        <div className="sm:col-span-2">
          <DetailRow label="Yönetici notu">{company.adminNote}</DetailRow>
        </div>
      ) : null}
    </dl>
  );
}

function ApplicationCard({ company }: { company: CompanyDetail }) {
  const a = company.application;
  return (
    <Card title="Başvuru">
      <dl className="space-y-4">
        <DetailRow label="Başvuran">
          {company.applicant ? (
            company.applicant.anonymized ? (
              <span className="text-text-muted">Silinmiş hesap</span>
            ) : (
              <Link href={`/panel/musteriler/${company.applicant.id}`} className="underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                {company.applicant.name}
              </Link>
            )
          ) : (
            <span className="text-text-muted">Panelden oluşturuldu</span>
          )}
        </DetailRow>
        {company.applicant && !company.applicant.anonymized ? (
          <DetailRow label="Hesap e-postası" ltr>
            {company.applicant.email}
          </DetailRow>
        ) : null}
        {company.address?.fullName ? <DetailRow label="Yetkili">{company.address.fullName}</DetailRow> : null}
        <DetailRow label="Tahmini aylık ihtiyaç">{a?.monthlyVolume ? VOLUME_LABELS_TR[a.monthlyVolume] : <span className="text-text-muted">Belirtilmedi</span>}</DetailRow>
        <DetailRow label="Başvuru dili">{a ? { tr: "Türkçe", en: "İngilizce", ar: "Arapça" }[a.locale] : "Türkçe"}</DetailRow>
        <DetailRow label="Başvuru notu">
          {a?.note ? (
            <span className="whitespace-pre-line" dir="auto">
              {a.note}
            </span>
          ) : (
            <span className="text-text-muted">Not yok</span>
          )}
        </DetailRow>
      </dl>
    </Card>
  );
}

function MembersCard({ company }: { company: CompanyDetail }) {
  return (
    <Card
      title={`Üyeler (${formatNumber(company.members.length)})`}
      description="Bu firmaya bağlı müşteri hesapları"
      action={company.members.length ? <CardLink href={`/panel/musteriler?firma=${company.id}`}>Listede gör</CardLink> : undefined}
      flush
    >
      {company.members.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">Bağlı müşteri hesabı yok.</p>
      ) : (
        <ul className="divide-y divide-border">
          {company.members.map((m) => (
            <li key={m.id} className="px-5 py-3">
              <Link href={`/panel/musteriler/${m.id}`} className="text-sm font-medium text-text underline-offset-4 hover:underline">
                {m.name}
              </Link>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span dir="ltr" className="truncate">
                  {m.email}
                </span>
                {m.isApplicant ? <StatusBadge tone="gold">Başvuran</StatusBadge> : null}
                {m.banned ? <StatusBadge tone="danger">Erişimi kapalı</StatusBadge> : null}
                {m.ownGroupName ? <span>Kendi grubu: {groupLabel(m.ownGroupName)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OrdersCard({ company }: { company: CompanyDetail }) {
  return (
    <Card title={`Siparişler (${formatNumber(company.orderCount)})`} description={company.orderCount > company.orders.length ? "Son 20 sipariş" : undefined} flush>
      {company.orders.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">Bu firmaya bağlı sipariş yok.</p>
      ) : (
        <ul className="divide-y divide-border">
          {company.orders.map((o) => (
            <li key={o.id}>
              <Link href={`/panel/siparisler/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm transition-colors hover:bg-surface-2/50">
                <span className="font-mono text-xs tracking-wide text-text">{o.orderNumber}</span>
                <StatusBadge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusBadge>
                <span className="text-xs text-text-muted">{PAYMENT_METHOD_SHORT[o.paymentMethod]}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{o.customerName}</span>
                <span className="tabular-nums text-text">{formatTryAmount(o.grandTotal, { symbol: true })}</span>
                <time dateTime={o.createdAt} className="text-xs tabular-nums text-text-muted">
                  {formatDate(o.createdAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EmailsCard({ company }: { company: CompanyDetail }) {
  return (
    <Card title="E-postalar" description="Bu başvuruyla ilgili gönderilen e-postalar" flush>
      {company.emails.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">Henüz e-posta yok.</p>
      ) : (
        <ul className="divide-y divide-border">
          {company.emails.map((e) => (
            <li key={e.id} className="px-5 py-3">
              <p className="truncate text-sm text-text">{e.subject}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-text-muted">
                <span dir="ltr" className="truncate">
                  {e.toEmail}
                </span>
                <span>· {EMAIL_STATUS_LABEL[e.status] ?? e.status}</span>
                <time dateTime={e.createdAt}>· {formatDateTime(e.createdAt)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Missing() {
  return (
    <div className="space-y-6">
      <Link href="/panel/kurumsal-hesaplar" className={BACK_LINK_CLASS}>
        <ArrowLeft aria-hidden className="size-4" />
        Kurumsal Hesaplar
      </Link>
      <Card>
        <EmptyState
          icon={BriefcaseBusiness}
          title="Firma bulunamadı"
          description="Bu kayıt silinmiş olabilir."
          action={
            <Link href="/panel/kurumsal-hesaplar" className={buttonClass("secondary", "sm")}>
              Listeye dön
            </Link>
          }
        />
      </Card>
    </div>
  );
}
