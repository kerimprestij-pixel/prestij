import type { Metadata } from "next";
import { Suspense } from "react";
import CouponEditor, { NEW_COUPON } from "@/components/panel/marketing/CouponEditor";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { customerGroupOptions } from "@/lib/panel/marketing/queries";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni kupon" };

export default function NewCouponPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <NewCoupon />
    </Suspense>
  );
}

async function NewCoupon() {
  await requireStaff("editor");
  const groups = await customerGroupOptions();
  return <CouponEditor initial={NEW_COUPON} groups={groups} usage={null} status={null} />;
}
