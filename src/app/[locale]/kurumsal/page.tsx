// /kurumsal (en/ar: /business): the page-builder page with the reserved slug "kurumsal". Static.
// Ends with the business account band (B2B): a client island that follows the viewer's application.
import type { Metadata } from "next";
import { Suspense } from "react";
import BusinessAccountBand from "@/components/store/b2b/BusinessAccountBand";
import { CmsPageView, cmsPageMetadata } from "@/components/store/CmsPage";
import { SectionsSkeleton } from "@/components/store/ListingSkeleton";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import { getSettings } from "@/lib/settings/get-settings";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return cmsPageMetadata(params, "kurumsal");
}

export default function BusinessPage({ params }: Props) {
  return (
    <>
      <Suspense fallback={<SectionsSkeleton />}>
        <CmsPageView params={params} slug="kurumsal" />
      </Suspense>
      <Suspense fallback={null}>
        <AccountBand params={params} />
      </Suspense>
    </>
  );
}

async function AccountBand({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  const [messages, b2b] = await Promise.all([getMessages(locale), getSettings("b2b")]);
  if (!b2b.enabled) return null;
  return <BusinessAccountBand labels={messages.b2b.band} applyHref={href(locale, "accountBusiness")} productsHref={href(locale, "products")} />;
}
