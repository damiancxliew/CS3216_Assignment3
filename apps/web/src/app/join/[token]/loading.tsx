import { Skeleton, Wordmark } from "@/components/ui";

/** The invitation card's frame, so the page settles into place instead of jumping from a bare column. */
export default function Loading() {
  return (
    <main className="game-grid mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-8" aria-busy>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <div className="my-auto flex flex-col gap-5 rounded-[2rem] border-[3px] border-line bg-surface px-7 py-10 sm:px-12 sm:py-14">
        <p className="text-base text-muted" role="status">Finding your adventure…</p>
        <Skeleton className="h-12 w-4/5" />
        <Skeleton className="h-6 w-full max-w-[54ch]" />
        <Skeleton className="h-6 w-2/3 max-w-[40ch]" />
        <Skeleton className="mt-2 h-12 w-52 rounded-full" />
      </div>
    </main>
  );
}
