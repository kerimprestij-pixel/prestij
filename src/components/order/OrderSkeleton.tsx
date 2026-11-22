// Copy-free placeholder for the order page while the order streams in.
export default function OrderSkeleton() {
  return (
    <div aria-hidden className="animate-pulse motion-reduce:animate-none">
      <div className="border-b border-border">
        <div className="container-x grid gap-8 py-12 md:py-16 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <div className="h-3 w-28 rounded bg-surface-2" />
            <div className="mt-6 h-14 w-3/4 max-w-md rounded bg-surface-2" />
            <div className="mt-6 h-4 w-full max-w-lg rounded bg-surface-2" />
            <div className="mt-2 h-4 w-2/3 max-w-sm rounded bg-surface-2" />
          </div>
          <div className="h-40 rounded-md bg-surface-2 lg:col-span-5" />
        </div>
      </div>
      <div className="container-x grid gap-6 py-10 md:py-14 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-7">
          <div className="h-72 rounded-md bg-surface-2" />
          <div className="h-96 rounded-md bg-surface-2" />
        </div>
        <div className="space-y-6 lg:col-span-5">
          <div className="h-64 rounded-md bg-surface-2" />
          <div className="h-48 rounded-md bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
