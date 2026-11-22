"use client";

import { Printer } from "lucide-react";
import { secondaryButton } from "@/components/store/shell-styles";
import { cn } from "@/lib/utils";

/** Opens the browser's print dialog (the order page has print styles). */
export default function PrintButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={cn(secondaryButton, "print:hidden", className)}>
      <Printer aria-hidden className="size-4" strokeWidth={1.5} />
      {label}
    </button>
  );
}
