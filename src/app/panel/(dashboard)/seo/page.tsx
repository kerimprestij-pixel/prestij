import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Settings } from "lucide-react";
import PageHeader from "@/components/panel/PageHeader";
import { KpiGridSkeleton, TableSkeleton } from "@/components/panel/Skeleton";
import { buttonClass } from "@/components/panel/ui/styles";
import { siteOrigin } from "@/i18n/paths";
import { emailDriverStatus } from "@/lib/email";
import { loadCheckoutLegalDocs } from "@/lib/orders/legal-docs";
import { getLegalEditorData } from "@/lib/panel/legal/service";
import {
  adminRecipientsState,
  cronSecretState,
  indexNowKeyState,
  isLocalOrigin,
  launchChecklist,
  mediaStorageState,
  WHEEL_TERMS_LEGAL_KEY,
} from "@/lib/panel/seo/launch";
import { loadPriceCheckRows, loadSeoReport } from "@/lib/panel/seo/queries";
import { placeholderPriceCheck } from "@/lib/pricing/placeholder-prices";
import { isUsableBankAccount } from "@/lib/validation/tr";
import { SEO_LIMITS } from "@/lib/panel/seo/rules";
import { readAllSettings } from "@/lib/panel/settings/service";
import { missingSellerFields } from "@/lib/settings/seller";
import { requireStaff } from "@/lib/session";
import LaunchChecklist from "./_components/LaunchChecklist";
import SeoReportView from "./_components/SeoReportView";

export const metadata: Metadata = { title: "SEO Kontrol" };

/** /panel/seo: read-only SEO check of every storefront page in every language, plus the launch checklist (admin). */
export default function SeoCheckPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pazarlama"
        title="SEO Kontrol"
        description="Sitedeki her sayfanın her dildeki başlığı, açıklaması, ana başlığı, metin uzunluğu, görsel alternatif metinleri ve barkodları. Bu sayfa yalnızca gösterir; düzeltmek için satırdaki Düzenle bağlantısını kullanın."
        actions={
          <Link href="/panel/ayarlar/seo" className={buttonClass("secondary")}>
            <Settings aria-hidden className="size-4" />
            SEO ayarları
          </Link>
        }
      />
      <Suspense fallback={<ReportSkeleton />}>
        <Report />
      </Suspense>
    </div>
  );
}

async function Report() {
  await requireStaff("admin");
  const [report, settings, wheelTerms, contracts, priceRows] = await Promise.all([
    loadSeoReport(),
    readAllSettings(),
    getLegalEditorData(WHEEL_TERMS_LEGAL_KEY),
    loadCheckoutLegalDocs(),
    loadPriceCheckRows(),
  ]);
  const origin = siteOrigin();
  const { general, seo, locales, giftWheel, emails, payments, shipping } = settings;
  const mail = emailDriverStatus();
  const steps = launchChecklist({
    origin,
    verification: seo.verification,
    socialLinks: Object.values(general.social).filter((v) => typeof v === "string" && v.trim() !== "").length,
    // Only whether the key is set, never the key itself.
    indexNow: indexNowKeyState(process.env.INDEXNOW_KEY),
    address: [general.address.line, [general.address.district, general.address.city].filter(Boolean).join(" / ")].filter(Boolean).join(", "),
    // Only whether the storage variables are set, never their values.
    mediaStorage: mediaStorageState({
      STORAGE_DRIVER: process.env.STORAGE_DRIVER,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    giftWheelEnabled: giftWheel.enabled,
    wheelTermsVersion: wheelTerms?.current?.version ?? null,
    // Go-live: what is still empty in Firma bilgileri, and only whether mail, cron and admin mails are set up.
    sellerMissing: missingSellerFields(general),
    // The same rule as the checkout (checkoutLegalReady): both contracts current, neither labelled "taslak…".
    checkoutContracts: { preInformation: contracts.preInformation?.version ?? null, distanceSales: contracts.distanceSales?.version ?? null },
    emailDriver: { driver: mail.driver, ready: mail.ready, problem: mail.problem },
    cronSecret: cronSecretState(process.env.CRON_SECRET),
    adminRecipients: adminRecipientsState(emails.adminRecipients, general.email),
    // Sales-ready (SR-6): the go-live sales profile's price rule; havale as counts only (never an IBAN); shipping fees.
    prices: placeholderPriceCheck(priceRows),
    bankTransfer: {
      enabled: payments.bankTransfer.enabled,
      accounts: payments.bankTransfer.accounts.length,
      usableAccounts: payments.bankTransfer.accounts.filter(isUsableBankAccount).length,
      paymentDays: payments.bankTransfer.paymentDays,
    },
    shipping: { flatFee: shipping.flatFee, freeThreshold: shipping.freeThreshold, heavy: shipping.heavy, estimatedDays: shipping.estimatedDays },
  });
  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-xs leading-relaxed text-text-muted">
        Ölçüler: başlık {SEO_LIMITS.title.min}–{SEO_LIMITS.title.max} karakter (site adı eki hariç), açıklama {SEO_LIMITS.description.min}–
        {SEO_LIMITS.description.max} karakter, kategori metni en az {SEO_LIMITS.words.category}, ürün açıklaması en az {SEO_LIMITS.words.product},
        blog yazısı en az {SEO_LIMITS.words.post} kelime. Yasal metinlerde uzunluklar yalnızca not olarak gösterilir. Numune ürünleri bilerek
        arama motorlarından gizlidir ve listede yer almaz. Liste kaydettiğiniz anda güncellenir; sayfayı yenilemeniz yeterli.
      </p>
      <SeoReportView report={report} locales={locales.enabled} />
      <LaunchChecklist steps={steps} siteIsLocal={isLocalOrigin(origin)} origin={origin} />
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton count={3} />
      <TableSkeleton rows={8} />
    </div>
  );
}
