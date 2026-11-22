import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Star, UserRoundX } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import CustomerActions from "@/components/panel/b2b/CustomerActions";
import { BACK_LINK_CLASS, DetailRow, EMAIL_STATUS_LABEL, groupLabel } from "@/components/panel/b2b/shared";
import { COMPANY_STATUS, formatDate, formatDateTime, formatNumber, ORDER_STATUS } from "@/components/panel/labels";
import Notice from "@/components/panel/Notice";
import { PAYMENT_METHOD_SHORT } from "@/components/panel/orders/labels";
import PageHeader from "@/components/panel/PageHeader";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { buttonClass } from "@/components/panel/ui";
import { getCustomerDetail, listGroupOptions, type CustomerDetail } from "@/lib/b2b/queries";
import { formatTryAmount } from "@/lib/panel/format";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Müşteri" };

type Params = Promise<{ id: string }>;

const LANGUAGE: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };
const SUBSCRIPTION_STATUS: Record<string, string> = { active: "Aktif", paused: "Duraklatıldı", cancelled: "İptal", past_due: "Ödeme bekliyor" };
const REVIEW_STATUS: Record<string, string> = { pending: "Onay bekliyor", approved: "Yayında", rejected: "Reddedildi" };

export default function CustomerPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <CustomerView params={params} />
    </Suspense>
  );
}

async function CustomerView({ params }: { params: Params }) {
  const session = await requireStaff();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const [customer, groups] = await Promise.all([getCustomerDetail(id), listGroupOptions()]);
  if (!customer) return <Missing />;
  const isAdmin = hasRole(session.staffRole, "admin");
  const companyApproved = customer.company?.status === "approved";

  return (
    <div className="space-y-6">
      <Link href="/panel/musteriler" className={BACK_LINK_CLASS}>
        <ArrowLeft aria-hidden className="size-4" />
        Müşteriler
      </Link>
      <PageHeader
        eyebrow="Müşteri"
        title={customer.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {customer.anonymized ? <StatusBadge tone="neutral">Silinmiş hesap</StatusBadge> : null}
            {customer.banned && !customer.anonymized ? <StatusBadge tone="danger">Erişimi kapalı</StatusBadge> : null}
            {!customer.anonymized ? (
              <StatusBadge tone={customer.emailVerified ? "success" : "warning"}>{customer.emailVerified ? "E-posta doğrulandı" : "E-posta doğrulanmadı"}</StatusBadge>
            ) : null}
            <span>
              Üyelik: <time dateTime={customer.createdAt}>{formatDateTime(customer.createdAt)}</time>
            </span>
          </span>
        }
        actions={
          isAdmin && !customer.anonymized ? (
            <CustomerActions
              customer={{
                id: customer.id,
                name: customer.name,
                email: customer.email,
                banned: customer.banned,
                customerGroupId: customer.customerGroupId,
                updatedAt: customer.updatedAt,
                orderCount: customer.orderCount,
              }}
              groups={groups}
              groupNeedsApprovedCompany={customer.requireApproval && !companyApproved}
            />
          ) : null
        }
      />

      {customer.anonymized ? (
        <Notice>Bu hesap silinmiş (anonimleştirilmiş). Siparişleri yasal saklama süresi boyunca korunur; hesap üzerinde işlem yapılamaz.</Notice>
      ) : !isAdmin ? (
        <Notice>Grup değiştirme, erişimi kapatma, veri dışa aktarma ve anonimleştirme yönetici yetkisi gerektirir.</Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ProfileCard customer={customer} />
          <OrdersCard customer={customer} />
          <AddressesCard customer={customer} />
          <SubscriptionsAndReviews customer={customer} />
        </div>
        <div className="min-w-0 space-y-6">
          <PricingCard customer={customer} />
          <EmailsCard customer={customer} />
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card title="Profil">
      <dl className="grid gap-4 sm:grid-cols-2">
        <DetailRow label="E-posta" ltr>
          {customer.anonymized ? null : customer.email}
        </DetailRow>
        <DetailRow label="Telefon" ltr>
          {customer.phone}
        </DetailRow>
        <DetailRow label="Tercih edilen dil">{LANGUAGE[customer.locale] ?? customer.locale}</DetailRow>
        <DetailRow label="Ticari ileti izni">
          {customer.newsletter
            ? customer.newsletter.status === "active"
              ? "E-bülten abonesi (onaylı)"
              : customer.newsletter.status === "pending"
                ? "E-bülten onayı bekleniyor"
                : "Abonelikten ayrıldı"
            : customer.marketingConsent
              ? "Verdi"
              : "Vermedi"}
        </DetailRow>
        <DetailRow label="Son giriş">{customer.lastSignInAt ? formatDateTime(customer.lastSignInAt) : null}</DetailRow>
        <DetailRow label="Açık oturum">{formatNumber(customer.activeSessions)}</DetailRow>
        <DetailRow label="Favoriler">{formatNumber(customer.favoriteCount)} ürün</DetailRow>
        <DetailRow label="Toplam harcama">
          {formatTryAmount(customer.spent, { symbol: true })} · {formatNumber(customer.orderCount)} sipariş
        </DetailRow>
      </dl>
    </Card>
  );
}

function PricingCard({ customer }: { customer: CustomerDetail }) {
  const c = customer.company;
  return (
    <Card title="Firma ve fiyat grubu">
      <dl className="space-y-4">
        <DetailRow label="Firma">
          {c ? (
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/panel/kurumsal-hesaplar/${c.id}`} className="underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                {c.name}
              </Link>
              <StatusBadge tone={COMPANY_STATUS[c.status].tone}>{COMPANY_STATUS[c.status].label}</StatusBadge>
              {c.isApplicant ? <span className="text-xs text-text-muted">başvuran</span> : null}
            </span>
          ) : (
            <span className="text-text-muted">Bağlı firma yok</span>
          )}
        </DetailRow>
        {c?.groupName ? <DetailRow label="Firmanın grubu">{groupLabel(c.groupName)}</DetailRow> : null}
        <DetailRow label="Müşterinin kendi grubu">{customer.ownGroup ? groupLabel(customer.ownGroup.name) : <span className="text-text-muted">Yok</span>}</DetailRow>
        <DetailRow label="Uygulanan fiyat">
          {customer.effectiveGroup ? (
            <span>
              {groupLabel(customer.effectiveGroup.name)} <span className="text-xs text-text-muted">({customer.effectiveGroup.source === "own" ? "kendi grubu" : "firmanın grubu"})</span>
            </span>
          ) : (
            "Perakende"
          )}
        </DetailRow>
      </dl>
      {customer.ownGroup && !customer.effectiveGroup && customer.requireApproval ? (
        <p className="mt-4 rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-xs leading-relaxed text-text">
          Kurumsal onay gerekli olduğu için müşterinin kendi grubu, onaylı bir firması olana kadar uygulanmaz.
        </p>
      ) : null}
    </Card>
  );
}

function OrdersCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card title={`Siparişler (${formatNumber(customer.orderCount)})`} description={customer.orderCount > customer.orders.length ? "Son 20 sipariş" : undefined} flush>
      {customer.orders.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">Bu hesapla verilmiş sipariş yok.</p>
      ) : (
        <ul className="divide-y divide-border">
          {customer.orders.map((o) => (
            <li key={o.id}>
              <Link href={`/panel/siparisler/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm transition-colors hover:bg-surface-2/50">
                <span className="font-mono text-xs tracking-wide text-text">{o.orderNumber}</span>
                <StatusBadge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusBadge>
                <span className="flex-1 text-xs text-text-muted">{PAYMENT_METHOD_SHORT[o.paymentMethod]}</span>
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

function AddressesCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card title={`Adresler (${formatNumber(customer.addresses.length)})`}>
      {customer.addresses.length === 0 ? (
        <p className="text-sm text-text-muted">Kayıtlı adres yok.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {customer.addresses.map((a) => (
            <li key={a.id} className="rounded-lg border border-border p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                {a.title}
                {a.isDefaultShipping ? <StatusBadge tone="info">Varsayılan teslimat</StatusBadge> : null}
                {a.isDefaultBilling ? <StatusBadge tone="info">Varsayılan fatura</StatusBadge> : null}
              </p>
              <p className="mt-2 text-text">{a.data.fullName}</p>
              <p className="text-text-muted">{[a.data.neighbourhood, a.data.line1].filter(Boolean).join(", ")}</p>
              <p className="text-text-muted">{[a.data.district, a.data.city, a.data.postalCode].filter(Boolean).join(" / ")}</p>
              {a.data.phone ? (
                <p className="text-text-muted" dir="ltr">
                  {a.data.phone}
                </p>
              ) : null}
              {a.invoice?.type === "corporate" ? (
                <p className="mt-2 text-xs text-text-muted">
                  Kurumsal fatura: {a.invoice.companyName} · {a.invoice.taxOffice} · {a.invoice.taxNumber}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SubscriptionsAndReviews({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card title={`Abonelikler (${formatNumber(customer.subscriptions.length)})`} flush>
        {customer.subscriptions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">Abonelik yok.</p>
        ) : (
          <ul className="divide-y divide-border">
            {customer.subscriptions.map((s) => (
              <li key={s.id} className="px-5 py-3 text-sm">
                <p className="text-text">{groupLabel(s.planName, `Abonelik #${s.id}`)}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {SUBSCRIPTION_STATUS[s.status] ?? s.status} · {PAYMENT_METHOD_SHORT[s.paymentMethod]} · Sonraki: {formatDate(s.nextRunAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Yorumlar (${formatNumber(customer.reviews.length)})`} flush>
        {customer.reviews.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">Yorum yok.</p>
        ) : (
          <ul className="divide-y divide-border">
            {customer.reviews.map((r) => (
              <li key={r.id} className="px-5 py-3 text-sm">
                <p className="flex items-center gap-2 text-text">
                  <span className="min-w-0 truncate">{groupLabel(r.productName, `Ürün #${r.productId}`)}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-text-muted">
                    <Star aria-hidden className="size-3.5 fill-gold text-gold" />
                    {r.rating}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {REVIEW_STATUS[r.status] ?? r.status} · {formatDate(r.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EmailsCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card title="Gönderilen e-postalar" description="Son 20 e-posta" flush>
      {customer.emails.length === 0 ? (
        <p className="px-5 py-4 text-sm text-text-muted">Henüz e-posta gönderilmedi.</p>
      ) : (
        <ul className="divide-y divide-border">
          {customer.emails.map((e) => (
            <li key={e.id} className="px-5 py-3">
              <p className="truncate text-sm text-text">{e.subject}</p>
              <p className="mt-0.5 text-xs text-text-muted">
                {EMAIL_STATUS_LABEL[e.status] ?? e.status} · <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
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
      <Link href="/panel/musteriler" className={BACK_LINK_CLASS}>
        <ArrowLeft aria-hidden className="size-4" />
        Müşteriler
      </Link>
      <Card>
        <EmptyState
          icon={UserRoundX}
          title="Müşteri bulunamadı"
          description="Bu hesap silinmiş ya da bir panel kullanıcısı olabilir (panel kullanıcıları Ekip sayfasındadır)."
          action={
            <Link href="/panel/musteriler" className={buttonClass("secondary", "sm")}>
              Listeye dön
            </Link>
          }
        />
      </Card>
    </div>
  );
}
