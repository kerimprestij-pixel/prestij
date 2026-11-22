import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/panel/Skeleton";
import { formatTryAmount } from "@/lib/panel/format";
import type { Settings, SettingsKey } from "@/lib/settings/types";
import { cn } from "@/lib/utils";
import { SETTINGS_PAGES, settingsHref } from "./settings-pages";

type AllSettings = { [K in SettingsKey]: Settings<K> };
type Summary = { lines: string[]; attention?: string };

const tl = (kurus: number) => formatTryAmount(kurus, { symbol: true });
const LANGUAGE_NAMES = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" } as const;

function summarize(all: AllSettings): Record<SettingsKey, Summary> {
  const { general, shipping, payments, seo, locales, b2b, samples, newsletter, whatsapp, emails, reviews, subscriptions, giftWheel } = all;
  const missingSeller = [general.mersisNo, general.taxOffice, general.taxNumber, general.kep, general.email].filter((v) => !v.trim()).length;
  const methods = [
    payments.card.enabled ? "Kart" : null,
    payments.bankTransfer.enabled && payments.bankTransfer.accounts.length > 0
      ? `Havale (${payments.bankTransfer.accounts.length} hesap${payments.bankTransfer.discountPercent ? `, %${payments.bankTransfer.discountPercent} indirim` : ""})`
      : null,
    payments.cashOnDelivery.enabled ? `Kapıda ödeme (+${tl(payments.cashOnDelivery.fee)})` : null,
  ].filter(Boolean) as string[];
  return {
    general: {
      lines: [general.siteName, [general.phone, general.email].filter(Boolean).join(" · ")],
      attention: missingSeller > 0 ? `Yasal metinler için ${missingSeller} satıcı bilgisi eksik` : undefined,
    },
    shipping: {
      lines: [
        `Kargo ${tl(shipping.flatFee)}${shipping.freeThreshold > 0 ? ` · ${tl(shipping.freeThreshold)} ve üzeri ücretsiz` : ""}`,
        `${shipping.carriers.length} kargo firması · ${shipping.estimatedDays.min}–${shipping.estimatedDays.max} iş günü`,
      ],
      attention: shipping.carriers.length === 0 ? "Kargo firması yok" : undefined,
    },
    payments: {
      lines: [methods.length ? methods.join(", ") : "Açık ödeme yöntemi yok"],
      attention:
        methods.length === 0
          ? "Müşteriler sipariş veremez"
          : payments.bankTransfer.enabled && payments.bankTransfer.accounts.length === 0
            ? "Havale açık ama banka hesabı yok"
            : undefined,
    },
    seo: { lines: [seo.defaultTitle.tr, `Şablon: ${seo.titleTemplate}`] },
    locales: { lines: [locales.enabled.map((l) => LANGUAGE_NAMES[l]).join(", ")] },
    b2b: { lines: [b2b.enabled ? (b2b.requireApproval ? "Açık · firma onayı gerekli" : "Açık · onaysız") : "Kapalı"] },
    samples: {
      lines: [
        samples.cartSampleEnabled
          ? `Sepette en fazla ${samples.maxPerOrder} numune${samples.minOrderTotal > 0 ? ` · ${tl(samples.minOrderTotal)} üzeri` : ""}`
          : "Sepette numune kapalı",
      ],
    },
    newsletter: { lines: [newsletter.enabled ? "Abonelik formu açık" : "Abonelik formu kapalı"] },
    whatsapp: {
      lines: [whatsapp.enabled ? `Açık · ${whatsapp.phone.replace(/^90(\d{3})(\d{3})(\d{2})(\d{2})$/, "+90 $1 $2 $3 $4")}` : "Kapalı"],
    },
    emails: {
      lines: [
        `Gönderen: ${emails.fromName}`,
        emails.adminRecipients.length ? `${emails.adminRecipients.length} yönetici alıcısı` : "Yönetici bildirimleri firma e-postasına",
      ],
      attention: !emails.adminRecipients.length && !general.email.trim() ? "Yönetici bildirimleri için e-posta adresi yok" : undefined,
    },
    reviews: {
      lines: [reviews.enabled ? `Açık · teslimattan ${reviews.requestDaysAfterDelivery} gün sonra değerlendirme isteği` : "Kapalı"],
    },
    subscriptions: {
      lines: [subscriptions.enabled ? `Açık · yenilemeden ${subscriptions.reminderDaysBefore} gün önce hatırlatma` : "Kapalı"],
      attention: subscriptions.enabled && subscriptions.allowedMethods.length === 0 ? "Ödeme yöntemi seçilmemiş" : undefined,
    },
    // Day 6: edited on Pazarlama → Hediye Çarkı (not a card on this page today; the Record needs every key).
    giftWheel: {
      lines: [
        giftWheel.enabled
          ? `Açık · ${giftWheel.slices.length} dilim · ödül ${giftWheel.validityHours} saat geçerli · ${giftWheel.round}. tur`
          : "Kapalı",
      ],
    },
  };
}

/** /panel/ayarlar: every settings screen as a card with its current values at a glance. */
export default function SettingsOverview({ settings }: { settings: AllSettings }) {
  const summaries = summarize(settings);
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {SETTINGS_PAGES.map((page) => {
        const summary = summaries[page.key];
        const Icon = page.icon;
        return (
          <li key={page.slug} className="min-w-0">
            <Link
              href={settingsHref(page.slug)}
              className="group flex h-full items-start gap-4 rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(3_38_95/0.04)] transition-[border-color,box-shadow] hover:border-gold/50 hover:shadow-[0_6px_20px_-12px_rgb(3_38_95/0.25)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-gold/35 bg-gold/10 text-gold-text">
                <Icon aria-hidden className="size-[1.125rem]" strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{page.label}</span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none rtl:rotate-180"
                  />
                </span>
                {summary.lines.filter(Boolean).map((line) => (
                  <span key={line} className="mt-1 block truncate text-sm text-text-muted">
                    {line}
                  </span>
                ))}
                {summary.attention ? (
                  <span className={cn("mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#9A5F07] dark:text-[#E9B45C]")}>
                    <TriangleAlert aria-hidden className="size-3.5" />
                    {summary.attention}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SettingsOverviewSkeleton() {
  return (
    <div role="status" aria-live="polite" className="grid gap-4 sm:grid-cols-2">
      <span className="sr-only">Yükleniyor…</span>
      {SETTINGS_PAGES.map((page) => (
        <div key={page.slug} className="flex items-start gap-4 rounded-xl border border-border bg-surface p-5">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
