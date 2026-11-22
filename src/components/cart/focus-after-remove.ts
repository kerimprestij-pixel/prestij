// Keeps keyboard focus inside the cart when a line is removed. The optimistic update unmounts the row
// together with its focused remove button (or quantity field), which drops focus to <body>: outside
// the drawer's modal dialog, and lost for screen-reader users. Pure DOM helper (client code only).

/**
 * Call right before removing `lineId`. Once the row has left the DOM, focus moves to the next line's
 * remove button (else the previous line's), else to `fallback()` (empty-state link, the dialog).
 */
export function keepFocusAfterRemoval(container: HTMLElement | null, lineId: number, fallback: () => HTMLElement | null): void {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-line-id]"));
  const index = rows.findIndex((row) => row.dataset.lineId === String(lineId));
  if (index === -1) return;
  const neighbours = [rows[index + 1], rows[index - 1]].filter((row): row is HTMLElement => Boolean(row)).map((row) => row.dataset.lineId);
  let frames = 0;
  const tick = () => {
    if (!container.isConnected) return;
    // Wait (up to ~1 s) for the optimistic render to drop the row.
    if (container.querySelector(`[data-line-id="${lineId}"]`) && frames++ < 60) {
      window.requestAnimationFrame(tick);
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && container.contains(active)) return;
    for (const id of neighbours) {
      const target = container.querySelector<HTMLElement>(`[data-line-id="${id}"] [data-remove-line]`);
      if (target) {
        target.focus();
        return;
      }
    }
    fallback()?.focus();
  };
  window.requestAnimationFrame(tick);
}
