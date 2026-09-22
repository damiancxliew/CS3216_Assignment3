import { Skeleton, Wordmark } from "@/components/ui";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8" aria-busy>
      <Wordmark />
      <div className="flex flex-1 flex-col justify-center gap-5 py-16">
        <p className="text-base text-muted">Finding your adventure…</p>
        <Skeleton className="h-12 w-4/5" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-2 h-12 w-48" />
      </div>
    </main>
  );
}
