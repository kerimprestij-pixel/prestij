// Copy-free placeholder streamed in the static shell while the visitor's cart loads.
export default function CheckoutSkeleton() {
  return (
    <div className="container-x grid animate-pulse gap-8 pb-20 motion-reduce:animate-none lg:grid-cols-12 lg:gap-14" aria-hidden>
      <div className="h-14 rounded-md bg-surface-2 lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:h-96" />
      <div className="space-y-10 lg:col-span-7 lg:col-start-1 lg:row-start-1">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i}>
            <div className="h-8 w-56 rounded bg-surface-2" />
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="h-12 rounded bg-surface-2" />
              <div className="h-12 rounded bg-surface-2" />
              <div className="h-12 rounded bg-surface-2 sm:col-span-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
