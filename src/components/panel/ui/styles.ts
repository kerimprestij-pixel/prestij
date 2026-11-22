// Class recipes for the panel kit (same look as the login form and the order forms). Pure.
import { cn } from "@/lib/utils";

/** Error red that reads on light and dark surfaces. */
export const errorTextClass = "text-[#B3261E] dark:text-[#F28B82]";

/** Text inputs, selects and textareas (height comes from the component). */
export const controlClass =
  "w-full rounded-lg border border-border bg-surface text-sm text-text placeholder:text-text-muted/70 shadow-[0_1px_0_rgb(3_38_95/0.02)] transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted aria-[invalid=true]:border-[#B3261E] aria-[invalid=true]:focus:ring-[#B3261E]/15 dark:aria-[invalid=true]:border-[#F28B82] motion-reduce:transition-none";

/** Wrapper for inputs with a prefix/suffix: the ring moves to the wrapper. */
export const controlGroupClass =
  "flex w-full items-stretch overflow-hidden rounded-lg border border-border bg-surface text-sm text-text transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-4 focus-within:ring-gold/20 has-[[aria-invalid=true]]:border-[#B3261E] dark:has-[[aria-invalid=true]]:border-[#F28B82] has-disabled:bg-surface-2 motion-reduce:transition-none";

/** The bare input inside a control group. */
export const groupInputClass =
  "min-w-0 flex-1 bg-transparent px-3 text-sm text-text placeholder:text-text-muted/70 focus:outline-none disabled:cursor-not-allowed disabled:text-text-muted";

/** Prefix/suffix cell inside a control group. */
export const affixClass = "flex shrink-0 items-center bg-surface-2/70 px-3 text-xs font-medium text-text-muted select-none";

export const labelClass = "block text-sm font-medium text-text";
export const helpClass = "text-xs leading-relaxed text-text-muted";
export const errorClass = cn("text-xs font-medium", errorTextClass);

export const focusRingClass = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "gold";
export type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,opacity,border-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-contrast shadow-[0_1px_2px_rgb(3_38_95/0.18)] hover:opacity-90",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-[#B3261E] text-white hover:bg-[#9A1F18]",
  "danger-outline":
    "border border-[#B3261E]/35 bg-surface text-[#B3261E] hover:bg-[#B3261E]/[0.06] dark:border-[#F28B82]/40 dark:text-[#F28B82] dark:hover:bg-[#F28B82]/10",
  gold: "bg-gold text-gold-contrast hover:brightness-95",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 py-1 text-xs",
  md: "min-h-10 px-3.5 py-2 text-sm",
  lg: "min-h-11 px-5 py-2.5 text-sm",
};

/** Panel button recipe (use on <button>, <Link> or <a>). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

/** Square icon-only button (always pair with an sr-only label or aria-label). */
export function iconButtonClass(size: "sm" | "md" = "md", className?: string): string {
  return cn(
    "inline-grid shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none",
    size === "sm" ? "size-8" : "size-9",
    className,
  );
}
