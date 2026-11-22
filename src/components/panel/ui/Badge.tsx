import type { Tone } from "@/components/panel/labels";
import { cn } from "@/lib/utils";

export type BadgeTone = Tone;

// Fixed hues that read on light and dark surfaces (same as StatusBadge).
const DOT: Record<Tone, string> = {
  neutral: "bg-text-muted",
  success: "bg-[#2F8F5B]",
  warning: "bg-[#D68A12]",
  danger: "bg-[#C2413A]",
  info: "bg-[#3A7BC8]",
  gold: "bg-gold",
};

const SOFT: Record<Tone, string> = {
  neutral: "border-border bg-surface-2 text-text",
  success: "border-[#2F8F5B]/30 bg-[#2F8F5B]/10 text-text",
  warning: "border-[#D68A12]/35 bg-[#D68A12]/10 text-text",
  danger: "border-[#C2413A]/30 bg-[#C2413A]/10 text-text",
  info: "border-[#3A7BC8]/30 bg-[#3A7BC8]/10 text-text",
  gold: "border-gold/40 bg-gold/10 text-text",
};

type BadgeProps = {
  tone?: Tone;
  /** "dot" (default): neutral pill with a colored dot. "soft": tinted pill without a dot. */
  variant?: "dot" | "soft";
  size?: "sm" | "md";
  className?: string;
  title?: string;
  children: React.ReactNode;
};

/** Small status pill. Server- and client-safe. */
export default function Badge({ tone = "neutral", variant = "dot", size = "md", className, title, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "px-2 py-px text-[0.6875rem]" : "px-2.5 py-0.5 text-xs",
        variant === "dot" ? "border-border bg-surface-2 text-text" : SOFT[tone],
        className,
      )}
    >
      {variant === "dot" ? <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} /> : null}
      {children}
    </span>
  );
}
