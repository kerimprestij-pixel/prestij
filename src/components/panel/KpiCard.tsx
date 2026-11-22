import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  href: string;
  /** Draw attention (gold accent) when the number needs action. */
  attention?: boolean;
};

export default function KpiCard({ label, value, hint, icon: Icon, href, attention = false }: KpiCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-surface p-5 transition-[border-color,box-shadow] duration-200 hover:shadow-[0_6px_24px_-12px_rgb(3_38_95/0.25)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
        attention ? "border-gold/60" : "border-border hover:border-gold/40",
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-muted">{label}</span>
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg border",
            attention ? "border-gold/40 bg-gold/10 text-gold-text" : "border-border bg-surface-2 text-text-muted",
          )}
        >
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
      </span>
      <span className="mt-3 font-heading text-4xl font-medium tabular-nums leading-none text-text">{value}</span>
      <span className="mt-3 flex items-center gap-1 text-xs text-text-muted">
        {hint}
        <ArrowUpRight
          aria-hidden
          className="ms-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}
