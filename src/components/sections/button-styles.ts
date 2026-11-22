// Button/link class recipes shared by sections and store components (dependency-free).
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "product" | "light" | "outline-light" | "link";

const base =
  "inline-flex items-center justify-center gap-2 text-sm font-medium uppercase tracking-[0.14em] transition-[background-color,color,border-color,filter] duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "min-h-12 px-8 py-3.5 bg-brand text-brand-contrast hover:bg-brand-800",
  secondary: "min-h-12 px-8 py-3.5 border border-text/25 text-text hover:border-gold",
  // Product colors vary, so hover darkens slightly instead of switching to a shade that could break contrast.
  product: "min-h-12 px-8 py-3.5 bg-product text-product-contrast hover:brightness-[0.93] disabled:hover:brightness-100",
  light: "min-h-12 px-8 py-3.5 bg-white text-brand-950 hover:bg-gold-100",
  "outline-light": "min-h-12 px-8 py-3.5 border border-white/60 text-white hover:border-white hover:bg-white/10",
  link: "group/link gap-3 border-b border-current pb-1 text-text hover:text-gold-700 dark:hover:text-gold-300",
};

export function buttonClass(variant: ButtonVariant = "primary", className?: string): string {
  return cn(base, variant === "link" ? "rounded-none" : "rounded-control", variants[variant], className);
}
