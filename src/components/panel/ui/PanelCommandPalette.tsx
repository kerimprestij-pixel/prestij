import { requireStaff } from "@/lib/session";
import CommandPalette from "./CommandPalette";

/** Reads the session (render inside <Suspense fallback={null}>), then mounts the Ctrl/⌘+K palette for that role. */
export default async function PanelCommandPalette() {
  const { staffRole } = await requireStaff();
  return <CommandPalette role={staffRole} />;
}
