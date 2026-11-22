import { Package } from "lucide-react";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { cn } from "@/lib/utils";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Accent color only when it is a plain hex value (safe for inline styles). */
export function safeHex(value: string | null | undefined): string | null {
  return value && HEX.test(value) ? value : null;
}

type ProductThumbProps = {
  media: MediaLike | null;
  accentColor?: string | null;
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
};

/** Square product thumbnail; falls back to the product color when there is no image. */
export default function ProductThumb({ media, accentColor, size = 40, className }: ProductThumbProps) {
  const accent = safeHex(accentColor);
  return (
    <span
      className={cn("relative block shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2", className)}
      style={{ width: size, height: size }}
    >
      {media ? (
        <Img media={media} alt="" sizes={`${size}px`} fill />
      ) : (
        <span
          aria-hidden
          className="grid size-full place-items-center text-text-muted"
          style={accent ? { backgroundColor: `color-mix(in oklab, ${accent} 22%, transparent)` } : undefined}
        >
          <Package className="size-1/2" strokeWidth={1.25} />
        </span>
      )}
    </span>
  );
}
