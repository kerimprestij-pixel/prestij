import type { Metadata } from "next";
import PaymentReadiness from "@/components/panel/settings/PaymentReadiness";
import PaymentSettingsForm from "@/components/panel/settings/PaymentSettingsForm";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import { getPanelMedia } from "@/lib/panel/media/queries";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { getPaymentReadiness } from "@/lib/payments/readiness";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ödeme yöntemleri · Ayarlar" };

export default function PaymentSettingsPage() {
  return (
    <SettingsPageFrame slug="odeme">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const [row, readiness] = await Promise.all([readSettingsRow("payments"), getPaymentReadiness()]);
  // PayTR-fix IMPL-B (S7): the PayTR logo picker's current image.
  const logoId = row.value.paytrLogoImageId;
  const media = logoId ? await getPanelMedia([logoId]) : [];
  return (
    <div className="space-y-6">
      <PaymentReadiness readiness={readiness} />
      <PaymentSettingsForm
        initial={{ ...row.value, updatedAt: row.updatedAt }}
        media={media}
        gateway={{ simulator: readiness.simulator, ready: readiness.providers.map((p) => ({ provider: p.provider, ready: p.ready })) }}
      />
    </div>
  );
}
