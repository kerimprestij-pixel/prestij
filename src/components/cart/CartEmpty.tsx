// Empty cart: a calm invitation back to the collection.
import { ArrowRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/sections/button-styles";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  text: string;
  cta: string;
  href: string;
  variant: "drawer" | "page";
  onNavigate?: () => void;
  className?: string;
};

export default function CartEmpty({ title, text, cta, href, variant, onNavigate, className }: Props) {
  const page = variant === "page";
  return (
    <div className={cn("flex flex-col items-center text-center", page ? "py-16 md:py-24" : "py-14", className)}>
      <span className="relative grid size-20 place-items-center rounded-full border border-border bg-surface">
        <span aria-hidden className="absolute inset-1.5 rounded-full border border-gold/30" />
        <ShoppingBag aria-hidden className="size-7 text-gold-text dark:text-gold" strokeWidth={1.25} />
      </span>
      {page ? (
        <h2 className="mt-8 font-heading text-3xl text-text md:text-4xl">{title}</h2>
      ) : (
        <p className="mt-7 font-heading text-2xl text-text">{title}</p>
      )}
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-muted">{text}</p>
      <Link href={href} onClick={onNavigate} data-cart-empty-cta className={buttonClass("primary", "group/empty mt-8")}>
        {cta}
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-300 group-hover/empty:translate-x-0.5 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover/empty:-translate-x-0.5"
          strokeWidth={1.5}
        />
      </Link>
    </div>
  );
}
