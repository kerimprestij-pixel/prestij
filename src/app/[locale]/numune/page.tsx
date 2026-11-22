// /numune (en/ar: /samples): the page-builder page with the reserved slug "numune". Static.
import type { Metadata } from "next";
import { Suspense } from "react";
import { CmsPageView, cmsPageMetadata } from "@/components/store/CmsPage";
import { SectionsSkeleton } from "@/components/store/ListingSkeleton";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return cmsPageMetadata(params, "numune");
}

export default function SamplesPage({ params }: Props) {
  return (
    <Suspense fallback={<SectionsSkeleton />}>
      <CmsPageView params={params} slug="numune" />
    </Suspense>
  );
}
