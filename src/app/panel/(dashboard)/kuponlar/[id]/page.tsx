import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CouponEditor, { type CouponState } from "@/components/panel/marketing/CouponEditor";
import { maskEmail } from "@/components/panel/marketing/labels";
import WheelCouponDetail from "@/components/panel/marketing/WheelCouponDetail";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { customerGroupOptions, getPanelCoupon, getWheelCouponDetail } from "@/lib/panel/marketing/queries";
import { hasRole } from "@/lib/panel/roles";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Kupon" };

type Params = Promise<{ id: string }>;

export default function CouponPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Coupon params={params} />
    </Suspense>
  );
}

async function Coupon({ params }: { params: Params }) {
  const session = await requireStaff("editor");
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) notFound();
  const [row, groups] = await Promise.all([getPanelCoupon(numeric), customerGroupOptions()]);
  if (!row) notFound();
  // Day 6: a gift wheel prize is read-only (deactivate only); its page shows the winner, spin and orders.
  if (row.source === "wheel") {
    const detail = await getWheelCouponDetail(numeric);
    if (!detail) notFound();
    // Masked here on the server for editors (admins see it in full): a client component's props are part
    // of the page's RSC payload, so masking only while rendering would still ship the full address.
    const owner = detail.owner && { ...detail.owner, email: hasRole(session.staffRole, "admin") ? detail.owner.email : maskEmail(detail.owner.email) };
    return <WheelCouponDetail key={detail.id} coupon={{ ...detail, owner }} />;
  }
  const initial: CouponState = {
    id: row.id,
    code: row.code,
    description: row.description,
    type: row.type,
    value: row.type === "free_shipping" ? null : row.value,
    minOrderTotal: row.minOrderTotal || null,
    maxUses: row.maxUses,
    perCustomerLimit: row.perCustomerLimit,
    productIds: row.productIds,
    categoryIds: row.categoryIds,
    customerGroupIds: row.customerGroupIds,
    schedule: row.schedule,
    isActive: row.isActive,
    updatedAt: row.updatedAt,
  };
  return <CouponEditor key={row.id} initial={initial} groups={groups} usage={{ usedCount: row.usedCount, orderCount: row.orderCount }} status={row.status} />;
}
