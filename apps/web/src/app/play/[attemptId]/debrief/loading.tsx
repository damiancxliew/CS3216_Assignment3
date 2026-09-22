import { Skeleton, Wordmark } from "@/components/ui";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-14 px-6 py-8 sm:py-10" aria-busy>
      <Wordmark />
      <header className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="mt-2 h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </header>
      <section className="flex flex-col gap-6 border-t border-line pt-8">
        <Skeleton className="h-7 w-52" />
        <div className="flex flex-col gap-2 border-l-[3px] border-world pl-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      </section>
      <section className="flex flex-col gap-6 border-t border-line pt-8">
        <Skeleton className="h-7 w-60" />
        <div className="flex flex-col gap-2 border-l-[3px] border-record pl-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </section>
    </main>
  );
}
