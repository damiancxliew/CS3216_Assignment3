import { Skeleton, Spinner } from "@/components/ui";

/** The play page's shape, so the map and panel appear where they will be while the first state is read. */
export default function Loading() {
  return (
    <main className="flex h-screen flex-col" aria-busy>
      <header className="flex items-baseline gap-6 border-b border-line bg-surface px-5 py-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-40" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative flex min-h-[55vh] flex-1 items-center justify-center bg-world-wash lg:min-h-0" aria-label="Map">
          <span className="inline-flex items-center gap-2 rounded-control bg-surface px-4 py-2.5 text-base font-semibold text-ink" role="status">
            <Spinner /> Opening your attempt…
          </span>
        </section>
        <aside className="flex w-full flex-col gap-4 border-t border-line bg-paper px-5 py-4 lg:w-[30rem] lg:border-l lg:border-t-0">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-28" />
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-32" />
          </div>
          <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        </aside>
      </div>
    </main>
  );
}
