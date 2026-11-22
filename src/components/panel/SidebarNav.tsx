"use client";
import { Suspense, use } from "react";
import { usePathname } from "next/navigation";
import type { StaffRole } from "@/lib/session";
import NavList, { type NavBadges } from "./NavList";
import { findNavItem } from "./nav-config";

type SidebarNavProps = {
  onNavigate?: () => void;
  badges?: NavBadges;
  /** The viewer's role, streamed from the layout (null = unknown: every item is shown). */
  role?: Promise<StaffRole | null>;
};

function ActiveNavList({ onNavigate, badges, role }: SidebarNavProps) {
  const pathname = usePathname();
  const staffRole = role ? use(role) : null;
  return <NavList activeHref={findNavItem(pathname)?.href ?? null} role={staffRole} onNavigate={onNavigate} badges={badges} />;
}

/**
 * usePathname suspends on dynamic panel routes and the role streams in, so the un-highlighted, unfiltered
 * list is the fallback. Hiding items is cosmetic: pages and actions check the role on the server.
 */
export default function SidebarNav({ onNavigate, badges, role }: SidebarNavProps) {
  return (
    <Suspense fallback={<NavList activeHref={null} onNavigate={onNavigate} badges={badges} />}>
      <ActiveNavList onNavigate={onNavigate} badges={badges} role={role} />
    </Suspense>
  );
}
