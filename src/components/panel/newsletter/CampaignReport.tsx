// A campaign that is sending or sent: progress, delivery counts and the Turkish mail as sent.
import Link from "next/link";
import Card from "@/components/panel/Card";
import EmailPreviewFrame from "@/components/panel/emails/EmailPreviewFrame";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import StatusBadge from "@/components/panel/StatusBadge";
import { emailLogHref } from "@/lib/panel/emails/filter";
import type { CampaignRow } from "@/lib/newsletter/campaigns";
import { CAMPAIGN_AUDIENCE_LABELS, CAMPAIGN_STATUS_LABELS } from "./labels";

export default function CampaignReport({ campaign, preview, expected }: { campaign: CampaignRow; preview: { html: string; text: string } | null; expected: number }) {
  const st = CAMPAIGN_STATUS_LABELS[campaign.status];
  const { recipients, sent, failed, queued } = campaign.stats;
  const total = Math.max(expected, recipients, 1);
  const pct = Math.min(100, Math.round(((sent + failed) / total) * 100));
  const items = [
    { label: "Alıcı", value: recipients, hint: campaign.status === "sending" ? `planlanan ${formatNumber(expected)}` : null },
    { label: "Gönderildi", value: sent, hint: null },
    { label: "Kuyrukta", value: queued, hint: null },
    { label: "Başarısız", value: failed, hint: null },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <span>{CAMPAIGN_AUDIENCE_LABELS[campaign.audience]}</span>
        {campaign.sentAt ? <span>· tamamlandı {formatDateTime(campaign.sentAt)}</span> : campaign.scheduledAt ? <span>· başladı {formatDateTime(campaign.scheduledAt)}</span> : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-border bg-surface px-5 py-4">
            <dt className="text-xs text-text-muted">{item.label}</dt>
            <dd className="mt-1 font-heading text-2xl tabular-nums text-text">{formatNumber(item.value)}</dd>
            {item.hint ? <dd className="text-xs text-text-muted">{item.hint}</dd> : null}
          </div>
        ))}
      </dl>
      {campaign.status === "sending" ? (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Gönderim ilerlemesi">
            <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Gönderim 200’lük gruplar halinde sürüyor; sayfayı yenileyerek ilerlemeyi görebilirsiniz.
          </p>
        </div>
      ) : null}
      <p className="text-sm">
        <Link href={emailLogHref({ related: { type: "campaign", id: String(campaign.id) } })} className="font-medium text-text underline underline-offset-4">
          Bu kampanyanın e-postalarını kayıtta gör
        </Link>
      </p>
      {preview ? (
        <Card title="Gönderilen e-posta" description="Türkçe sürüm, örnek abonelikten çıkma bağlantısıyla">
          <EmailPreviewFrame html={preview.html} text={preview.text} title="Kampanya e-postası" />
        </Card>
      ) : null}
    </div>
  );
}
