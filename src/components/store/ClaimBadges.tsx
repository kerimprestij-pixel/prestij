import { Droplet, Leaf, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  effective_cleaning: Sparkles,
  skin_caring: ShieldCheck,
  fresh_scent: Leaf,
  soft_feel: Droplet,
};

/** The four label claims (Etkili Temizlik, Cildi Koruyan, Ferah Koku, Yumuşak His) as icon badges. */
export default function ClaimBadges({
  claims,
  labels,
  className,
}: {
  claims: string[];
  /** messages.product.claims */
  labels: Record<string, string>;
  className?: string;
}) {
  const items = claims.filter((key) => labels[key]);
  if (items.length === 0) return null;
  return (
    <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {items.map((key) => {
        const Icon = ICONS[key] ?? Sparkles;
        return (
          <li
            key={key}
            className="flex flex-col items-center gap-3 rounded-md border border-border px-3 py-4 text-center"
          >
            <span className="grid size-10 place-items-center rounded-full bg-product-soft text-product-strong transition-colors duration-700">
              <Icon aria-hidden className="size-[1.15rem]" strokeWidth={1.5} />
            </span>
            <span className="text-[0.7rem] font-medium uppercase leading-snug tracking-[0.14em] text-text">{labels[key]}</span>
          </li>
        );
      })}
    </ul>
  );
}
