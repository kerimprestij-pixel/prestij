import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Send } from "lucide-react";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import { CAMPAIGN_AUDIENCE_LABELS, CAMPAIGN_STATUS_LABELS } from "@/components/panel/newsletter/labels";
import NewsletterTabs from "@/components/panel/newsletter/NewsletterTabs";
import PageHeader from "@/components/panel/PageHeader";
import { TableSkeleton } from "@/components/panel/Skeleton";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { buttonClass } from "@/components/panel/ui";
import { db } from "@/db";
import { listCampaigns, type CampaignRow } from "@/lib/newsletter/campaigns";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "E-bülten kampanyaları" };

export default function CampaignListPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pazarlama"
        title="E-bülten"
        description="Onaylı abonelere kampanya e-postaları: üç dilde yazın, önizleyin, kendinize test gönderin; hemen gönderin veya planlayın."
        actions={
          <Link href="/panel/e-bulten/kampanyalar/yeni" className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" />
            Yeni kampanya
          </Link>
        }
      />
      <NewsletterTabs active="campaigns" />
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <CampaignList />
      </Suspense>
    </div>
  );
}

function when(c: CampaignRow): string {
  if (c.status === "sent" && c.sentAt) return formatDateTime(c.sentAt);
  if ((c.status === "scheduled" || c.status === "sending") && c.scheduledAt) return formatDateTime(c.scheduledAt);
  return `Oluşturuldu ${formatDateTime(c.createdAt)}`;
}

async function CampaignList() {
  await requireStaff("editor");
  const campaigns = await listCampaigns(db);
  return (
    <Card title={`${formatNumber(campaigns.length)} kampanya`} description="En yeni en üstte · saatler Türkiye saatiyle" flush>
      {campaigns.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Henüz kampanya yok"
          description="İlk kampanyanızı oluşturun; aboneliğini onaylamış herkes kendi dilinde alır."
          action={
            <Link href="/panel/e-bulten/kampanyalar/yeni" className={buttonClass("primary")}>
              Yeni kampanya
            </Link>
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {campaigns.map((c) => {
              const st = CAMPAIGN_STATUS_LABELS[c.status];
              return (
                <li key={c.id} className="px-4 py-3.5">
                  <Link href={`/panel/e-bulten/kampanyalar/${c.id}`} className="block">
                    <p className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-text">{c.subject.tr}</span>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      {CAMPAIGN_AUDIENCE_LABELS[c.audience]} · {when(c)}
                    </p>
                    {c.stats.recipients > 0 ? (
                      <p className="mt-0.5 text-xs text-text-muted">
                        {formatNumber(c.stats.sent)} / {formatNumber(c.stats.recipients)} gönderildi
                        {c.stats.failed ? ` · ${formatNumber(c.stats.failed)} başarısız` : ""}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="relative hidden overflow-x-auto md:block">
            <table className={cn(tableClass, "min-w-[48rem]")}>
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Konu</th>
                  <th scope="col" className={thClass}>Kitle</th>
                  <th scope="col" className={thClass}>Durum</th>
                  <th scope="col" className={thClass}>Zaman</th>
                  <th scope="col" className={cn(thClass, "text-end")}>Alıcı</th>
                  <th scope="col" className={cn(thClass, "text-end")}>Gönderildi</th>
                  <th scope="col" className={cn(thClass, "text-end")}>Başarısız</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const st = CAMPAIGN_STATUS_LABELS[c.status];
                  return (
                    <tr key={c.id} className={trClass}>
                      <td className={cn(tdClass, "max-w-80")}>
                        <Link href={`/panel/e-bulten/kampanyalar/${c.id}`} className="line-clamp-2 font-medium text-text underline-offset-4 hover:underline">
                          {c.subject.tr}
                        </Link>
                      </td>
                      <td className={cn(tdClass, "text-text-muted")}>{CAMPAIGN_AUDIENCE_LABELS[c.audience]}</td>
                      <td className={tdClass}>
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      </td>
                      <td className={cn(tdClass, "whitespace-nowrap text-text-muted")}>{when(c)}</td>
                      <td className={cn(tdClass, "text-end tabular-nums")}>{c.stats.recipients ? formatNumber(c.stats.recipients) : "—"}</td>
                      <td className={cn(tdClass, "text-end tabular-nums")}>{c.stats.recipients ? formatNumber(c.stats.sent) : "—"}</td>
                      <td className={cn(tdClass, "text-end tabular-nums")}>{c.stats.recipients ? formatNumber(c.stats.failed) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
