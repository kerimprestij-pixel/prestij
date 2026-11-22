import { formatNumber } from "@/components/panel/labels";
import { getPanelActor } from "@/lib/panel/action";
import { hasRole } from "@/lib/panel/roles";
import { countPendingReviews } from "@/lib/reviews/panel-queries";

/** Sidebar counter next to "Yorumlar": reviews waiting for moderation (editor+). Render inside <Suspense>. */
export default async function PendingReviewsBadge() {
  const actor = await getPanelActor();
  if (!actor || !hasRole(actor.staffRole, "editor")) return null;
  const pending = await countPendingReviews();
  if (pending === 0) return null;
  return (
    <span
      title={`${formatNumber(pending)} yorum onay bekliyor`}
      className="ms-auto min-w-5 shrink-0 rounded-full bg-gold/20 px-1.5 text-center text-[0.6875rem] font-semibold leading-5 tabular-nums text-text"
    >
      <span aria-hidden>{pending > 99 ? "99+" : formatNumber(pending)}</span>
      <span className="sr-only">, {formatNumber(pending)} yorum onay bekliyor</span>
    </span>
  );
}
