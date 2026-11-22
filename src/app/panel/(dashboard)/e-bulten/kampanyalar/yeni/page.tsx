import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import CampaignEmailEditor from "@/components/panel/newsletter/CampaignEmailEditor";
import PageHeader from "@/components/panel/PageHeader";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { db } from "@/db";
import { countCampaignRecipients, defaultCampaignScheduleAt } from "@/lib/newsletter/campaigns";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni kampanya · E-bülten" };

export default function NewCampaignPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/e-bulten/kampanyalar"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Kampanyalar
      </Link>
      <PageHeader eyebrow="E-bülten" title="Yeni kampanya" description="Önce taslağı kaydedin; ardından test gönderebilir, hemen gönderebilir veya planlayabilirsiniz." />
      <Suspense fallback={<DetailSkeleton />}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  const session = await requireStaff("editor");
  const recipients = await countCampaignRecipients(db, "all");
  return (
    <CampaignEmailEditor
      initial={{ id: null, subject: { tr: "" }, body: { tr: "" }, audience: "all", updatedAt: null }}
      status="draft"
      scheduledAt={null}
      canSend={hasRole(session.staffRole, "admin")}
      testRecipient={session.user.email}
      initialRecipients={recipients}
      defaultScheduleAt={defaultCampaignScheduleAt()}
    />
  );
}
