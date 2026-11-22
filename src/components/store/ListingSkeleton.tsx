// Copy-free placeholders streamed in the static shell while listing/product content loads.

export function ListingSkeleton() {
  return (
    <div className="container-x animate-pulse py-16 motion-reduce:animate-none md:py-24" aria-hidden>
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="mt-6 h-12 w-2/3 max-w-lg rounded bg-surface-2" />
      <div className="mt-10 flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 w-28 rounded-full bg-surface-2" />
        ))}
      </div>
      <div className="mt-12 grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 md:gap-x-8 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <div className="aspect-[4/5] rounded bg-surface-2" />
            <div className="mt-5 h-6 w-3/4 rounded bg-surface-2" />
            <div className="mt-3 h-4 w-1/3 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductSkeleton() {
  return (
    <div className="container-x grid animate-pulse gap-10 py-10 motion-reduce:animate-none lg:grid-cols-12 lg:gap-16 lg:py-14" aria-hidden>
      <div className="aspect-[4/5] rounded bg-surface-2 lg:col-span-7" />
      <div className="lg:col-span-5">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="mt-6 h-14 w-3/4 rounded bg-surface-2" />
        <div className="mt-6 h-4 w-full rounded bg-surface-2" />
        <div className="mt-2 h-4 w-5/6 rounded bg-surface-2" />
        <div className="mt-10 h-10 w-40 rounded bg-surface-2" />
        <div className="mt-10 h-12 w-full rounded bg-surface-2" />
      </div>
    </div>
  );
}

export function SectionsSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" aria-hidden>
      <div className="h-[88svh] bg-surface-2 md:h-[86svh]" />
    </div>
  );
}
