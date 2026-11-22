import { Suspense } from "react";
import UnreadMessagesBadge from "@/components/panel/messages/UnreadMessagesBadge";
import PendingOrdersBadge from "@/components/panel/orders/PendingOrdersBadge";
import PanelShell from "@/components/panel/PanelShell";
import PendingReviewsBadge from "@/components/panel/reviews/PendingReviewsBadge";
import PanelCommandPalette from "@/components/panel/ui/PanelCommandPalette";
import UserMenu, { UserMenuSkeleton } from "@/components/panel/UserMenu";
import { getPanelActor } from "@/lib/panel/action";

/** Chrome for every signed-in panel page (the login page sits outside this group). */
export default function PanelChromeLayout({ children }: { children: React.ReactNode }) {
  // Not awaited: the sidebar reads it inside its own Suspense boundary, so the shell stays static.
  const navRole = getPanelActor().then(
    (actor) => actor?.staffRole ?? null,
    () => null,
  );
  return (
    <PanelShell
      userMenu={
        <Suspense fallback={<UserMenuSkeleton />}>
          <UserMenu />
        </Suspense>
      }
      commandPalette={
        <Suspense fallback={null}>
          <PanelCommandPalette />
        </Suspense>
      }
      navRole={navRole}
      navBadges={{
        "/panel/siparisler": (
          <Suspense fallback={null}>
            <PendingOrdersBadge />
          </Suspense>
        ),
        "/panel/mesajlar": (
          <Suspense fallback={null}>
            <UnreadMessagesBadge />
          </Suspense>
        ),
        "/panel/yorumlar": (
          <Suspense fallback={null}>
            <PendingReviewsBadge />
          </Suspense>
        ),
      }}
    >
      {children}
    </PanelShell>
  );
}
