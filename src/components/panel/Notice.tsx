import { CircleExclamationPoint, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inline message strip. `warning` uses an alert role so it is announced. */
export default function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning";
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "warning" ? CircleExclamationPoint : Info;
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm text-text",
        tone === "warning" ? "border-[#D68A12]/40 bg-[#D68A12]/10" : "border-gold/30 bg-gold/10",
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-[#B5730C]" : "text-gold-text")} />
      <div className={cn("min-w-0", className)}>{children}</div>
    </div>
  );
}
