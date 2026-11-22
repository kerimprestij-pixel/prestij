import { cn } from "@/lib/utils";

type WordmarkProps = {
  /** Small caption under the mark, e.g. "Yönetim Paneli". */
  caption?: string;
  size?: "sm" | "lg";
  /** Ivory lettering for use on the fixed navy brand panel. */
  inverted?: boolean;
  className?: string;
};

/** Typographic PRESTİJ mark: letter-spaced serif with a gold hairline. */
export default function Wordmark({ caption, size = "sm", inverted = false, className }: WordmarkProps) {
  return (
    <span lang="tr" className={cn("inline-flex flex-col items-start leading-none", className)}>
      <span
        className={cn(
          "font-heading font-semibold uppercase",
          inverted ? "text-[#F9F8F5]" : "text-text",
          size === "lg" ? "text-4xl tracking-[0.32em]" : "text-xl tracking-[0.28em]",
        )}
      >
        PRESTİJ
      </span>
      <span aria-hidden className={cn("block h-px bg-gold", size === "lg" ? "mt-3 w-16" : "mt-2 w-8")} />
      {caption ? (
        <span
          className={cn(
            "mt-2 font-body font-medium uppercase",
            inverted ? "text-[#DDA82A]" : "text-gold-text",
            size === "lg" ? "text-xs tracking-[0.3em]" : "text-[0.625rem] tracking-[0.24em]",
          )}
        >
          {caption}
        </span>
      ) : null}
    </span>
  );
}
