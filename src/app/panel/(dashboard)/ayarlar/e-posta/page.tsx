import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CircleCheck, MailSearch, TriangleAlert } from "lucide-react";
import StatusBadge from "@/components/panel/StatusBadge";
import EmailSettingsForm from "@/components/panel/settings/EmailSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { emailDriverStatus, listEmailTemplates } from "@/lib/email";
import { REQUIRED_EMAIL_TEMPLATES } from "@/lib/panel/emails/templates";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "E-posta · Ayarlar" };

export default function EmailSettingsPage() {
  return (
    <SettingsPageFrame slug="e-posta">
      <Editor />
    </SettingsPageFrame>
  );
}

const DRIVER_TEXT = {
  outbox: "Yerel test kutusu: e-postalar gönderilmez, sunucudaki storage/mail-outbox klasörüne dosya olarak yazılır.",
  smtp: "SMTP sunucusu üzerinden gerçek e-posta gönderiliyor.",
  none: "E-posta sunucusu tanımlı değil: e-postalar kuyrukta bekliyor.",
} as const;

async function Editor() {
  await requireStaff("admin");
  const [row, general] = await Promise.all([readSettingsRow("emails"), readSettingsRow("general")]);
  const driver = emailDriverStatus();
  const templates = listEmailTemplates();
  const overrides = row.value.templates;

  const groups = [
    { title: "Müşteri e-postaları", items: templates.filter((t) => t.audience === "customer" && !t.marketing) },
    { title: "Yönetici bildirimleri", items: templates.filter((t) => t.audience === "admin") },
    { title: "Pazarlama", items: templates.filter((t) => t.marketing) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-text">
              {driver.ready ? (
                <CircleCheck aria-hidden className="size-4 text-[#2F8F5B]" />
              ) : (
                <TriangleAlert aria-hidden className="size-4 text-[#B5730C]" />
              )}
              Gönderim
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{driver.problem ?? DRIVER_TEXT[driver.driver]}</p>
            <p className="mt-1 text-xs text-text-muted">
              Gönderen adresi: <span className="font-medium text-text">{driver.fromAddress ?? "tanımlı değil"}</span>
              {driver.driver === "smtp" ? " · SMTP: tanımlı" : ""}
            </p>
          </div>
          <Link href="/panel/e-postalar" className="inline-flex items-center gap-1.5 text-sm font-medium text-text underline-offset-4 hover:underline">
            <MailSearch aria-hidden className="size-4" />
            Gönderilen e-postalar
          </Link>
        </div>
      </section>

      <EmailSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} generalEmail={general.value.email.trim()} />

      <section className="min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
        <header className="border-b border-border px-5 py-4 sm:px-6">
          <h3 className="text-[0.9375rem] font-semibold text-text">Şablonlar</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
            Her e-postanın konusunu ve giriş paragrafını üç dilde değiştirebilir, önizleyebilir ve kendinize test e-postası gönderebilirsiniz. Diğer metinler Arayüz Metinleri’nde
            (E-posta metinleri) düzenlenir.
          </p>
        </header>
        <div className="divide-y divide-border">
          {groups.map((group) => (
            <div key={group.title} className="px-5 py-4 sm:px-6">
              <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">{group.title}</h4>
              <ul className="mt-2 -mx-2">
                {group.items.map((t) => {
                  const o = overrides[t.key];
                  const off = o?.enabled === false;
                  const custom = Boolean(o?.subject || o?.intro);
                  return (
                    <li key={t.key}>
                      <Link
                        href={`/panel/ayarlar/e-posta/${t.key}`}
                        className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm font-medium", off ? "text-text-muted" : "text-text")}>{t.label}</p>
                          {t.description ? <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{t.description}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {off ? <StatusBadge tone="warning">Kapalı</StatusBadge> : null}
                          {custom ? <StatusBadge tone="gold">Özel metin</StatusBadge> : null}
                          {REQUIRED_EMAIL_TEMPLATES.includes(t.key) ? <span className="hidden text-xs text-text-muted sm:inline">Zorunlu</span> : null}
                          <ChevronRight aria-hidden className="size-4 text-text-muted transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

