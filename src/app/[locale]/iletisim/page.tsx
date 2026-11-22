// /iletisim (en/ar: /contact): the page-builder page with the reserved slug "iletisim" (normally the
// contact_info and contact_form sections). Static: `?konu=` is read on the client inside Suspense.
import type { Metadata } from "next";
import { Suspense } from "react";
import { CmsPageView, cmsPageMetadata } from "@/components/store/CmsPage";
import { ListingSkeleton } from "@/components/store/ListingSkeleton";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return cmsPageMetadata(params, "iletisim");
}

export default function ContactPage({ params }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <CmsPageView params={params} slug="iletisim" />
    </Suspense>
  );
}
