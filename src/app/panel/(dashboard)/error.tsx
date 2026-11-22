"use client";
import { useEffect } from "react";
import { CircleExclamationPoint, RotateCcw } from "lucide-react";

export default function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-border bg-surface px-6 py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full border border-border bg-surface-2 text-[#C2413A]">
        <CircleExclamationPoint aria-hidden className="size-5" />
      </span>
      <h1 className="mt-4 font-heading text-2xl text-text">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-text-muted">Sayfa yüklenirken beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.</p>
      {digest ? <p className="mt-2 font-mono text-xs text-text-muted">Hata kodu: {digest}</p> : null}
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <RotateCcw aria-hidden className="size-4" />
        Tekrar dene
      </button>
    </div>
  );
}
