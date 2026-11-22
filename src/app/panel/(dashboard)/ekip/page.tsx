import type { Metadata } from "next";
import { Suspense } from "react";
import { db } from "@/db";
import PageHeader from "@/components/panel/PageHeader";
import { ListSkeleton, TableSkeleton } from "@/components/panel/Skeleton";
import TeamManager from "@/components/panel/team/TeamManager";
import { TEAM_PAGE_DESCRIPTION } from "@/lib/panel/team/rules";
import { listStaffMembers } from "@/lib/panel/team/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Ekip" };

/** Staff accounts and roles (admin only; every action re-checks the role on the server). */
export default function TeamPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<TeamSkeleton />}>
        <Team />
      </Suspense>
    </div>
  );
}

async function Team() {
  const actor = await requireStaff("admin");
  const members = await listStaffMembers(db);
  return <TeamManager members={members} currentUserId={actor.user.id} />;
}

function TeamSkeleton() {
  return (
    <>
      <PageHeader eyebrow="Sistem" title="Ekip" description={TEAM_PAGE_DESCRIPTION} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <TableSkeleton rows={4} />
        </div>
        <ListSkeleton rows={3} />
      </div>
    </>
  );
}
