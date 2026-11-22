import { getOrderWorkload } from "@/app/panel/_lib/orders";
import { formatNumber } from "@/components/panel/labels";
import { requireStaff } from "@/lib/session";

/** Sidebar counter next to "Siparişler": havale to confirm + orders to prepare/ship. Render inside <Suspense>. */
export default async function PendingOrdersBadge() {
  await requireStaff();
  const { total, awaitingTransfer, toPrepare } = await getOrderWorkload();
  if (total === 0) return null;
  const title = [awaitingTransfer > 0 ? `${formatNumber(awaitingTransfer)} havale onayı` : null, toPrepare > 0 ? `${formatNumber(toPrepare)} hazırlanacak` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <span title={title} className="ms-auto min-w-5 shrink-0 rounded-full bg-gold/20 px-1.5 text-center text-[0.6875rem] font-semibold leading-5 tabular-nums text-text">
      <span aria-hidden>{total > 99 ? "99+" : formatNumber(total)}</span>
      <span className="sr-only">, işlem bekleyen {formatNumber(total)} sipariş</span>
    </span>
  );
}
