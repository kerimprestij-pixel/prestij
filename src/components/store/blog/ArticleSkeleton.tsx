/** Copy-free placeholder for a blog article (streamed in the static shell while the post loads). */
export default function ArticleSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" aria-hidden>
      <div className="container-x pt-8 md:pt-10">
        <div className="h-3 w-40 rounded bg-surface-2" />
        <div className="mx-auto flex max-w-3xl flex-col items-center pt-12 md:pt-20">
          <div className="h-3 w-28 rounded bg-surface-2" />
          <div className="mt-6 h-12 w-full rounded bg-surface-2 md:h-16" />
          <div className="mt-3 h-12 w-2/3 rounded bg-surface-2 md:h-16" />
          <div className="mt-8 h-5 w-3/4 rounded bg-surface-2" />
        </div>
      </div>
      <div className="container-x mt-12 md:mt-16">
        <div className="mx-auto aspect-[3/2] max-w-6xl rounded-md bg-surface-2 md:aspect-[16/9]" />
      </div>
      <div className="container-x py-14">
        <div className="mx-auto max-w-2xl space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-4 rounded bg-surface-2" style={{ width: `${92 - (i % 3) * 9}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
