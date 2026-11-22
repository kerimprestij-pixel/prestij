import { cn } from "@/lib/utils";
import type { Tone } from "./labels";

// Dot colors are fixed hues that read on light and dark surfaces; the label uses the text token.
const DOT: Record<Tone, string> = {
  neutral: "bg-text-muted",
  success: "bg-[#2F8F5B]",
  warning: "bg-[#D68A12]",
  danger: "bg-[#C2413A]",
  info: "bg-[#3A7BC8]",
  gold: "bg-gold",
};

export default function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-text",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}
