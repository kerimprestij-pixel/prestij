"use client";
import { useId, useRef } from "react";
import { FileText, X } from "lucide-react";

const proseClass =
  "text-base leading-relaxed text-text [&_li]:[unicode-bidi:plaintext] [&_p]:[unicode-bidi:plaintext] [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-6 [&_h2]:font-heading [&_h2]:text-2xl [&_h3]:mt-5 [&_h3]:font-heading [&_h3]:text-lg [&_h4]:mt-4 [&_h4]:font-semibold [&_hr]:my-6 [&_hr]:border-border [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mt-3 [&_strong]:font-semibold [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:ps-5";

type LegalTextDialogProps = {
  title: string;
  /** e.g. "Sürüm 1.0 · onay: 6 Kas 2026 14:32" */
  meta: string;
  /** Sanitized HTML stored with the order (re-sanitized on the server before it reaches here). */
  html: string;
  /** Language of the stored text (the order locale). */
  lang: string;
  dir: "ltr" | "rtl";
};

/** "Metni görüntüle": the legal text exactly as the buyer accepted it, in a modal dialog. */
export default function LegalTextDialog({ title, meta, html, lang, dir }: LegalTextDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <FileText aria-hidden className="size-3.5 text-text-muted" />
        Metni görüntüle
        <span className="sr-only">: {title}</span>
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => {
          // A click on the backdrop lands on the <dialog> element itself.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-auto w-[min(48rem,calc(100vw-2rem))] max-h-[min(85dvh,56rem)] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-text shadow-[0_24px_64px_-24px_rgb(3_38_95/0.45)] backdrop:bg-[#03265F]/40 backdrop:backdrop-blur-[2px] open:flex open:flex-col"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-heading text-xl text-text">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{meta}</p>
          </div>
          <form method="dialog">
            <button
              type="submit"
              autoFocus
              className="grid size-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-5" />
              <span className="sr-only">Kapat</span>
            </button>
          </form>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {html ? (
            <div lang={lang} dir={dir} className={proseClass} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="text-sm text-text-muted">Bu sipariş için saklanmış metin bulunamadı.</p>
          )}
        </div>
      </dialog>
    </>
  );
}
