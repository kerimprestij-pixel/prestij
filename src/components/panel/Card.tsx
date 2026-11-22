import Link from "next/link";
import { cn } from "@/lib/utils";

type CardProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Link or button shown at the end of the card header. */
  action?: React.ReactNode;
  /** Remove body padding (for edge-to-edge tables). */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
};

export default function Card({ title, description, action, flush, className, children }: CardProps) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]", className)}>
      {title || action ? (
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-text">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0 text-sm">{action}</div> : null}
        </header>
      ) : null}
      <div className={flush ? undefined : "p-5"}>{children}</div>
    </section>
  );
}

/** Small text link used in card headers ("Tümünü gör →"). */
export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded font-medium text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </Link>
  );
}
