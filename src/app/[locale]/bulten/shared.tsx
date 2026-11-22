// Shared frame of the newsletter link pages (/bulten/onay, /bulten/ayril): a centered card on the soft
// gold wash used by the account pages.

export function NewsletterLinkCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[50vh] bg-linear-to-b from-gold/10 to-transparent" />
      <div className="container-x flex justify-center py-16 md:py-24">
        <div className="w-full max-w-lg">
          <div className="rounded-md border border-border bg-surface p-6 text-center shadow-[0_24px_60px_-40px_rgb(3_38_95/0.35)] sm:p-10">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function NewsletterLinkSkeleton() {
  return (
    <div aria-hidden className="animate-pulse motion-reduce:animate-none">
      <div className="mx-auto size-14 rounded-full bg-surface-2" />
      <div className="mx-auto mt-6 h-3 w-32 rounded bg-surface-2" />
      <div className="mx-auto mt-4 h-9 w-3/4 rounded bg-surface-2" />
      <div className="mx-auto mt-4 h-4 w-full rounded bg-surface-2" />
      <div className="mt-8 h-12 w-full rounded bg-surface-2" />
    </div>
  );
}
