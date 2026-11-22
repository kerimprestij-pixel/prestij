// Class names shared by the order action forms (match the panel login form inputs).
export const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted/70 transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 aria-[invalid=true]:border-[#B3261E] dark:aria-[invalid=true]:border-[#F28B82] motion-reduce:transition-none";

export const labelClass = "block text-sm font-medium text-text";

export const hintClass = "mt-1 text-xs text-text-muted";

export const errorClass = "mt-1 text-xs font-medium text-[#B3261E] dark:text-[#F28B82]";

const buttonBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-[background-color,opacity,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

export const primaryButtonClass = `${buttonBase} bg-brand text-brand-contrast hover:opacity-90`;
export const secondaryButtonClass = `${buttonBase} border border-border bg-surface text-text hover:bg-surface-2`;
export const dangerButtonClass = `${buttonBase} bg-[#B3261E] text-white hover:bg-[#9A1F18]`;
export const dangerOutlineButtonClass = `${buttonBase} border border-[#B3261E]/35 bg-surface text-[#B3261E] hover:bg-[#B3261E]/[0.06] dark:border-[#F28B82]/40 dark:text-[#F28B82] dark:hover:bg-[#F28B82]/10`;
export const ghostButtonClass = `${buttonBase} text-text-muted hover:bg-surface-2 hover:text-text`;
