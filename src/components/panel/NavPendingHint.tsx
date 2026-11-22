"use client";
import { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Inside a sidebar <Link>: a small spinner while the clicked section loads (slow connections), so the
 * click visibly registered. Always rendered and absolutely placed: no layout shift.
 */
export default function NavPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-surface-2 p-0.5 text-gold-text transition-opacity duration-150 motion-reduce:transition-none",
        pending ? "opacity-100" : "opacity-0",
      )}
    >
      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
    </span>
  );
}
