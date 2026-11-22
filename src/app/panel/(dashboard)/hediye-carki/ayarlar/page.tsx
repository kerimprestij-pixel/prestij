import type { Metadata } from "next";
import { Suspense } from "react";
import WheelPageHeader from "@/components/panel/gift-wheel/WheelPageHeader";
import WheelSettingsForm from "@/components/panel/gift-wheel/WheelSettingsForm";
import WheelTabs from "@/components/panel/gift-wheel/WheelTabs";
import type { WheelPreviewCopy } from "@/components/panel/gift-wheel/WheelPreview";
import { SettingsFormSkeleton } from "@/components/panel/settings/SettingsPageFrame";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { db } from "@/db";
import { databaseNow } from "@/lib/panel/gift-wheel/queries";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Hediye Çarkı · Ayarlar" };

export default function GiftWheelSettingsPage() {
  return (
    <div className="space-y-6">
      <WheelPageHeader />
      <WheelTabs active="settings" />
      <Suspense fallback={<SettingsFormSkeleton cards={4} />}>
        <Editor />
      </Suspense>
    </div>
  );
}

/** The storefront's default wheel texts in one language (UI-string overrides from Arayüz Metinleri included). */
function previewCopy(m: Messages): WheelPreviewCopy {
  return {
    texts: {
      title: m.wheel.dialog.title,
      subtitle: m.wheel.dialog.subtitle,
      teaser: m.wheel.teaser.label,
      claimCta: m.wheel.claim.claimCta,
      registerCta: m.wheel.claim.registerCta,
      signInCta: m.wheel.claim.signInCta,
    },
    spin: m.wheel.dialog.spin,
    everySliceWins: m.wheel.dialog.everySliceWins,
    prize: m.wheel.prize,
  };
}

async function Editor() {
  await requireStaff("editor");
  const [row, now, tr, en, ar] = await Promise.all([
    readSettingsRow("giftWheel"),
    databaseNow(db),
    getMessages("tr"),
    getMessages("en"),
    getMessages("ar"),
  ]);
  return (
    <WheelSettingsForm
      initial={{ ...row.value, updatedAt: row.updatedAt }}
      copy={{ tr: previewCopy(tr), en: previewCopy(en), ar: previewCopy(ar) }}
      now={now}
    />
  );
}
