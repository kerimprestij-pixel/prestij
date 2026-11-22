// Editors with unsaved changes, shared by every SaveBar, the command palette and sign-out.
//
// With cacheComponents, Next keeps recently visited routes mounted but hidden (React <Activity>).
// An editor left with Back / swipe-back (no prompt is possible there) keeps its draft while hidden,
// but its effects (and so its own beforeunload guard) are cleaned up, and the draft disappears once
// the route is evicted. This registry outlives the hidden editor: it keeps warning on reload/close,
// shows a toast that leads back to the draft, and lets other ways of leaving (palette, sign-out) ask
// first. Plain module state (client only); no React context needed.
import { dismissToast, toast } from "@/components/panel/ui/toast-store";

export const LEAVE_MESSAGE = "Kaydedilmemiş değişiklikleriniz var. Sayfadan ayrılırsanız kaybolacak. Devam edilsin mi?";

type Entry = {
  /** Path + query of the editor page. */
  path: string;
  /** The SaveBar's root element: stays in the document while the route is hidden, removed when evicted. */
  node: HTMLElement | null;
  /** Back to the saved state (SaveBar's onReset). */
  reset?: () => void;
  /** Client-side navigation (keeps the hidden draft). */
  navigate: (path: string) => void;
  hidden: boolean;
  toastId?: number;
};

const entries = new Map<string, Entry>();
let listening = false;

function isShown(node: HTMLElement | null): boolean {
  return Boolean(node?.isConnected && node.getClientRects().length > 0);
}

/** Drops entries whose editor no longer exists (route evicted or unmounted). */
function prune() {
  for (const [key, entry] of entries) {
    if (!entry.node?.isConnected) {
      if (entry.toastId !== undefined) dismissToast(entry.toastId);
      entries.delete(key);
    }
  }
}

function ensureListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Visible editors have their own guard; this one covers drafts in hidden routes.
  window.addEventListener("beforeunload", (event) => {
    prune();
    if ([...entries.values()].some((e) => e.hidden)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

/** The editor `key` has unsaved changes and is on screen. */
export function markDirty(key: string, entry: Omit<Entry, "hidden" | "toastId">): void {
  ensureListeners();
  const previous = entries.get(key);
  if (previous?.toastId !== undefined) dismissToast(previous.toastId);
  entries.set(key, { ...entry, hidden: false });
}

/** The editor `key` was saved, reset or closed for good. */
export function clearDirty(key: string): void {
  const entry = entries.get(key);
  if (entry?.toastId !== undefined) dismissToast(entry.toastId);
  entries.delete(key);
}

/**
 * The editor's guard effect was cleaned up while dirty: either it is about to re-run (dirty changed)
 * or the route was hidden. Checked a moment later: a hidden draft gets a toast with a way back.
 */
export function markMaybeHidden(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.hidden = true;
  setTimeout(() => {
    const current = entries.get(key);
    if (current !== entry || !entry.hidden) return;
    if (!entry.node?.isConnected) {
      entries.delete(key);
      return;
    }
    if (isShown(entry.node)) return;
    entry.toastId = toast.warning("Kaydedilmemiş değişiklikler bekliyor", {
      description: "Ayrıldığınız düzenleme sayfasındaki değişiklikler kaydedilmedi. Sayfayı yenilerseniz veya başka sayfalarda dolaşırsanız kaybolabilir.",
      duration: 0,
      action: { label: "Düzenlemeye dön", onClick: () => entry.navigate(entry.path) },
    });
  }, 60);
}

/** Editors (visible or hidden) that still hold unsaved changes. */
export function pendingDrafts(): number {
  prune();
  return entries.size;
}

/**
 * Before a client navigation the SaveBar cannot intercept (command palette): asks when the editor on
 * screen has unsaved changes; on "yes" it is reset, so the edits do not come back later.
 */
export function confirmLeaveCurrent(): boolean {
  prune();
  const current = [...entries].filter(([, e]) => !e.hidden && isShown(e.node));
  if (current.length === 0) return true;
  if (!window.confirm(LEAVE_MESSAGE)) return false;
  for (const [key, entry] of current) {
    entry.reset?.();
    clearDirty(key);
  }
  return true;
}

/**
 * Before signing out (every draft, also those in hidden routes, is lost): asks when any editor holds
 * unsaved changes. On "yes" the drafts are discarded.
 */
export function confirmLeaveDrafts(): boolean {
  if (pendingDrafts() === 0) return true;
  if (!window.confirm(LEAVE_MESSAGE)) return false;
  discardDrafts();
  return true;
}

/** Resets every editor with unsaved changes (the user agreed to discard them). */
export function discardDrafts(): void {
  for (const [key, entry] of [...entries]) {
    entry.reset?.();
    clearDirty(key);
  }
}
