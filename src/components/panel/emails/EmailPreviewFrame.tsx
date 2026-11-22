"use client";
// A rendered e-mail in a sandboxed iframe, with a desktop / phone width switch and the plain-text part.
// Sandbox: no scripts, no forms, no top navigation; links open in a new tab. allow-same-origin only
// lets the images load (an opaque-origin document is refused local / private-network images by the
// browser) and is safe because scripts stay disabled.
import { useState } from "react";
import { FileText, Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

type View = "desktop" | "mobile" | "text";

export default function EmailPreviewFrame({
  html,
  text,
  title,
  loading,
  className,
  minHeight = 640,
}: {
  html: string;
  text?: string | null;
  /** Accessible name of the iframe. */
  title: string;
  /** Dims the frame while a new preview loads. */
  loading?: boolean;
  className?: string;
  minHeight?: number;
}) {
  const [view, setView] = useState<View>("desktop");
  const options: { value: View; label: string; icon: typeof Monitor }[] = [
    { value: "desktop", label: "Masaüstü", icon: Monitor },
    { value: "mobile", label: "Telefon", icon: Smartphone },
    ...(text != null ? [{ value: "text" as const, label: "Düz metin", icon: FileText }] : []),
  ];
  return (
    <div className={cn("min-w-0", className)}>
      <div role="radiogroup" aria-label="Önizleme görünümü" className="mb-3 inline-flex rounded-lg border border-border bg-surface p-1">
        {options.map((o) => {
          const Icon = o.icon;
          const active = view === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setView(o.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                active ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {o.label}
            </button>
          );
        })}
      </div>
      <div className={cn("overflow-hidden rounded-xl border border-border bg-[#F3F1EC] transition-opacity", loading && "opacity-60")}>
        {view === "text" ? (
          <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap break-words bg-surface p-5 font-mono text-xs leading-relaxed text-text">{text}</pre>
        ) : (
          <div className="flex justify-center overflow-x-auto p-0 sm:p-4">
            <iframe
              title={title}
              srcDoc={html}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="block w-full border-0 bg-white"
              style={{ maxWidth: view === "mobile" ? 375 : 760, height: minHeight }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
