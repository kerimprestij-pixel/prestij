import type { Metadata } from "next";
import SettingsPageFrame from "@/components/panel/settings/SettingsPageFrame";
import SubscriptionSettingsForm, { type MethodAvailability } from "@/components/panel/settings/SubscriptionSettingsForm";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";
import { loadActivePlans } from "@/lib/subscriptions/plans";

export const metadata: Metadata = { title: "Abonelik · Ayarlar" };

export default function SubscriptionSettingsPage() {
  return (
    <SettingsPageFrame slug="abonelik">
      <Editor />
    </SettingsPageFrame>
  );
}

async function Editor() {
  await requireStaff("admin");
  const [row, payments, plans] = await Promise.all([readSettingsRow("subscriptions"), readSettingsRow("payments"), loadActivePlans()]);
  const p = payments.value;
  const availability: MethodAvailability = {
    card: { available: p.card.enabled, reason: p.card.enabled ? null : "Kartla ödeme, ödeme ayarlarında kapalı." },
    bank_transfer: {
      available: p.bankTransfer.enabled && p.bankTransfer.accounts.length > 0,
      reason: !p.bankTransfer.enabled ? "Havale/EFT, ödeme ayarlarında kapalı." : p.bankTransfer.accounts.length === 0 ? "Henüz banka hesabı eklenmedi." : null,
    },
    cash_on_delivery: { available: p.cashOnDelivery.enabled, reason: p.cashOnDelivery.enabled ? null : "Kapıda ödeme, ödeme ayarlarında kapalı." },
  };
  return <SubscriptionSettingsForm initial={{ ...row.value, updatedAt: row.updatedAt }} availability={availability} plans={plans.length} />;
}
