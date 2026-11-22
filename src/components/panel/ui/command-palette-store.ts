// Lets the shell's search button open the command palette, which mounts separately (it needs the
// user's role from a server component). Client-only module.

const listeners = new Set<() => void>();

export function openCommandPalette(): void {
  for (const listener of listeners) listener();
}

export function onOpenCommandPalette(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True on Apple platforms (for "⌘K" hints). Server snapshot: false. */
export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}
