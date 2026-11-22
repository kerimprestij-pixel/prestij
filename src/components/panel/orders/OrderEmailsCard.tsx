// The e-mails of one order (panel order detail): what the customer and the admins were sent, with
// status, linking to the e-mail log. Server component (the page already passed requireStaff()).
import Link from "next/link";
import Card, { CardLink } from "@/components/panel/Card";
import { EMAIL_STATUS_LABELS } from "@/components/panel/emails/labels";
import { formatDateTime } from "@/components/panel/labels";
import StatusBadge from "@/components/panel/StatusBadge";
import { db } from "@/db";
import { getEmailTemplate } from "@/lib/email";
import { emailLogHref } from "@/lib/panel/emails/filter";
import { listOrderEmails } from "@/lib/panel/emails/service";

export default async function OrderEmailsCard({ orderId }: { orderId: number }) {
  const mails = await listOrderEmails(db, orderId);
  return (
    <Card
      title="E-postalar"
      description="Bu sipariş için gönderilen e-postalar"
      action={mails.length > 0 ? <CardLink href={emailLogHref({ related: { type: "order", id: String(orderId) } })}>Kayıtta aç</CardLink> : undefined}
    >
      {mails.length === 0 ? (
        <p className="text-sm text-text-muted">Henüz e-posta gönderilmedi.</p>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {mails.map((m) => {
            const st = EMAIL_STATUS_LABELS[m.status];
            const label = getEmailTemplate(m.template)?.label ?? m.template;
            const admin = m.template.startsWith("admin_");
            return (
              <li key={m.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/panel/e-postalar/${m.id}`}
                    className="min-w-0 text-sm font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {label}
                  </Link>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                </div>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {admin ? "Yönetici · " : ""}
                  {m.toEmail}
                </p>
                <p className="text-xs text-text-muted">
                  <time dateTime={m.createdAt}>{formatDateTime(m.sentAt ?? m.createdAt)}</time>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
