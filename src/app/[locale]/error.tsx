"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { primaryButton, secondaryButton, spacedCaps } from "@/components/store/shell-styles";
import { useShellMessages } from "@/components/store/ShellMessages";
import { cn } from "@/lib/utils";

/** Error boundary for storefront pages (the header and footer stay usable around it). */
export default function StorefrontError({ error, retry }: { error: unknown; retry: () => void }) {
  const shell = useShellMessages();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <section
      role="alert"
      className="container-x flex min-h-[60vh] flex-col items-center justify-center py-24 text-center md:py-32"
    >
      <span aria-hidden className="block h-px w-12 bg-gold/60" />
      {shell ? (
        <>
          <h1 className="mt-8 max-w-2xl text-balance font-heading text-4xl leading-tight md:text-5xl">
            {shell.errors.generic}
          </h1>
          <p className="mt-6 max-w-md text-pretty leading-relaxed text-text-muted">{shell.errors.genericDescription}</p>
        </>
      ) : null}
      <div className="mt-12 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className={primaryButton}>
          <RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />
          {shell?.errors.retry}
        </button>
        {shell ? (
          <Link href={shell.homeHref} className={secondaryButton}>
            {shell.errors.goHome}
          </Link>
        ) : null}
      </div>
      {digest ? (
        <p className={cn("mt-10 text-[0.6875rem] text-text-muted", spacedCaps)} dir="ltr">
          #{digest}
        </p>
      ) : null}
    </section>
  );
}
