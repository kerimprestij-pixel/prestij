// Copy-free placeholders: the /sepet Suspense fallback and the drawer's first load.
import { cn } from "@/lib/utils";

export function CartLinesSkeleton({ count = 2, large = false }: { count?: number; large?: boolean }) {
  return (
    <ul className="divide-y divide-border" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={cn("flex gap-4", large ? "py-6 sm:gap-6" : "py-5")}>
          <div className={cn("aspect-[4/5] shrink-0 rounded-sm bg-surface-2", large ? "w-24 sm:w-28" : "w-[4.5rem]")} />
          <div className="flex flex-1 flex-col gap-2.5 pt-1">
            <div className="flex justify-between gap-4">
              <div className="h-5 w-2/5 rounded bg-surface-2" />
              <div className="h-4 w-16 rounded bg-surface-2" />
            </div>
            <div className="h-3 w-1/4 rounded bg-surface-2" />
            <div className="mt-2 h-9 w-28 rounded-control bg-surface-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CartPageSkeleton() {
  return (
    <div className="container-x animate-pulse pb-20 motion-reduce:animate-none" aria-hidden>
      <div className="h-4 w-20 rounded bg-surface-2" />
      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7 xl:col-span-8">
          <div className="h-16 rounded-md bg-surface-2" />
          <div className="mt-6">
            <CartLinesSkeleton count={3} large />
          </div>
        </div>
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="rounded-md border border-border bg-surface p-6 md:p-8">
            <div className="h-7 w-1/2 rounded bg-surface-2" />
            <div className="mt-8 h-11 rounded-control bg-surface-2" />
            <div className="mt-8 flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex justify-between">
                  <div className="h-4 w-24 rounded bg-surface-2" />
                  <div className="h-4 w-16 rounded bg-surface-2" />
                </div>
              ))}
            </div>
            <div className="mt-8 h-12 rounded-control bg-surface-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
