import { Skeleton, Wordmark } from "@/components/ui";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 px-6 py-10 sm:py-14" aria-busy>
      <div className="flex items-center justify-between gap-4">
        <Wordmark />
        <span className="text-base text-muted">All adventures</span>
      </div>
      <header className="flex flex-col gap-3">
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </header>
      {["Brief", "Sources", "Content"].map((title) => (
        <section key={title} className="flex flex-col gap-5 border-t border-line pt-8">
          <h2 className="font-serif text-2xl text-ink">{title}</h2>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </section>
      ))}
    </main>
  );
}
