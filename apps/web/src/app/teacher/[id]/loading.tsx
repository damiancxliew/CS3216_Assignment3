import { Skeleton, Wordmark } from "@/components/ui";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-5 py-8 sm:gap-10 sm:px-6 sm:py-14" aria-busy>
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Wordmark />
        <span className="text-base text-muted">All adventures</span>
      </div>
      <header className="flex flex-col gap-3">
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </header>
      <Skeleton className="h-12 w-full" />
      <section className="flex flex-col gap-5 border-t border-line pt-8">
        <Skeleton className="h-8 w-44" />
        <div className="flex flex-col gap-3 rounded-surface border border-line bg-surface p-5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </section>
    </main>
  );
}
