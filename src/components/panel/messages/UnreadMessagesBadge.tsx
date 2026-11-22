import { formatNumber } from "@/components/panel/labels";
import { countUnreadMessages } from "@/lib/panel/messages/queries";
import { requireStaff } from "@/lib/session";

/** Sidebar counter next to "Mesajlar": unread contact form messages. Render inside <Suspense>. */
export default async function UnreadMessagesBadge() {
  await requireStaff();
  const unread = await countUnreadMessages();
  if (unread === 0) return null;
  return (
    <span
      title={`${formatNumber(unread)} okunmamış mesaj`}
      className="ms-auto min-w-5 shrink-0 rounded-full bg-gold/20 px-1.5 text-center text-[0.6875rem] font-semibold leading-5 tabular-nums text-text"
    >
      <span aria-hidden>{unread > 99 ? "99+" : formatNumber(unread)}</span>
      <span className="sr-only">, {formatNumber(unread)} okunmamış mesaj</span>
    </span>
  );
}
