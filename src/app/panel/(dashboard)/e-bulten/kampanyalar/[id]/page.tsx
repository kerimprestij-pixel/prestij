import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import CampaignEmailEditor from "@/components/panel/newsletter/CampaignEmailEditor";
import CampaignReport from "@/components/panel/newsletter/CampaignReport";
import { CAMPAIGN_STATUS_LABELS } from "@/components/panel/newsletter/labels";
import PageHeader from "@/components/panel/PageHeader";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { db } from "@/db";
import { getEmailTemplate, loadEmailEnvironment, newsletterUnsubscribeLinks } from "@/lib/email";
import { renderTemplate } from "@/lib/email/render";
import { campaignContentFor, countCampaignRecipients, defaultCampaignScheduleAt, getCampaign } from "@/lib/newsletter/campaigns";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kampanya · E-bülten" };

type Params = Promise<{ id: string }>;

export default function CampaignPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/e-bulten/kampanyalar"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Kampanyalar
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Campaign params={params} />
      </Suspense>
    </div>
  );
}

async function Campaign({ params }: { params: Params }) {
  const session = await requireStaff("editor");
  const { id } = await params;
  const campaign = /^\d{1,10}$/.test(id) ? await getCampaign(db, Number(id)) : null;
  if (!campaign) notFound();
  const recipients = await countCampaignRecipients(db, campaign.audience);
  const st = CAMPAIGN_STATUS_LABELS[campaign.status];

  if (campaign.status === "sending" || campaign.status === "sent") {
    const template = getEmailTemplate("newsletter_campaign");
    const env = await loadEmailEnvironment(db, "tr");
    const content = campaignContentFor(campaign, "tr");
    const preview = template
      ? renderTemplate(template, { subject: content.subject, html: content.html, preheader: null }, env, { unsubscribeUrl: newsletterUnsubscribeLinks(0, "tr").url })
      : null;
    return (
      <>
        <PageHeader eyebrow={`E-bülten · ${st.label}`} title={campaign.subject.tr} />
        <CampaignReport campaign={campaign} preview={preview} expected={campaign.status === "sending" ? Math.max(recipients, campaign.stats.recipients) : campaign.stats.recipients} />
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={`E-bülten · ${st.label}`} title={campaign.subject.tr || "Kampanya"} />
      <CampaignEmailEditor
        initial={{ id: campaign.id, subject: campaign.subject, body: campaign.body, audience: campaign.audience, updatedAt: campaign.updatedAt }}
        status={campaign.status}
        scheduledAt={campaign.scheduledAt}
        canSend={hasRole(session.staffRole, "admin")}
        testRecipient={session.user.email}
        initialRecipients={recipients}
        defaultScheduleAt={defaultCampaignScheduleAt()}
      />
    </>
  );
}
