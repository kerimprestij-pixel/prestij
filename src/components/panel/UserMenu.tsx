import { requireStaff } from "@/lib/session";
import { ROLE_LABELS } from "./labels";
import { Skeleton } from "./Skeleton";
import UserMenuButton from "./UserMenuButton";

/** Reads the session, so render it inside <Suspense fallback={<UserMenuSkeleton />}>. */
export default async function UserMenu() {
  const { user, staffRole } = await requireStaff();
  return <UserMenuButton name={user.name} email={user.email} roleLabel={ROLE_LABELS[staffRole] ?? staffRole} />;
}

export function UserMenuSkeleton() {
  return (
    <span className="flex items-center gap-2.5 py-1 ps-1 pe-2">
      <Skeleton className="size-8 rounded-full" />
      <span className="hidden flex-col gap-1.5 sm:flex">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-14" />
      </span>
    </span>
  );
}
