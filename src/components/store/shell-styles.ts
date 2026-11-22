// Shared class strings for the storefront shell (header, menus, footer).

/** Round 40px icon button (header actions, menu triggers). */
export const iconButton =
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-text transition-colors duration-200 hover:bg-surface-2 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none dark:hover:text-text";

/** Small uppercase, letter-spaced label. Arabic must never be letter-spaced (it breaks joining). */
export const spacedCaps = "uppercase tracking-[0.16em] rtl:tracking-normal";

/** Solid primary call-to-action. */
export const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-brand px-7 text-sm font-medium text-brand-contrast transition-colors duration-200 hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none dark:hover:bg-brand-600";

/** Hairline secondary call-to-action. */
export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-7 text-sm font-medium text-text transition-colors duration-200 hover:border-gold hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none dark:hover:text-text";
