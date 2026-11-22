// Small inline note: blocking problems in a muted rose, informational ones in the house gold.
import { CircleExclamationPoint, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const noteTone = {
  error: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100",
  info: "border-gold-200 bg-gold-50 text-gold-900 dark:border-gold-800/60 dark:bg-gold-950/50 dark:text-gold-100",
  success: "border-border bg-surface text-text",
} as const;

export default function IssueNote({ blocking, children, className }: { blocking: boolean; children: ReactNode; className?: string }) {
  const Icon = blocking ? CircleExclamationPoint : Info;
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-sm border px-3 py-2 text-xs leading-relaxed",
        blocking ? noteTone.error : noteTone.info,
        className,
      )}
    >
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
