import { Page, Skeleton } from "@/components/ui";

/** The console's shape: the library of adventure cards beside the new-quest card. */
export default function Loading() {
  return (
    <Page
      title="Choose your next adventure"
      lede="Build a new historical world or jump back into one you already started."
      width="wide"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:items-start" aria-busy>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-7 w-28 rounded-full" />
          </div>
          <ul className="grid gap-6 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <li key={i} className="flex flex-col overflow-hidden rounded-surface border-2 border-line bg-surface">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="flex flex-col gap-3 p-5">
                  <Skeleton className="h-7 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-3 h-5 w-full" />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <section className="flex flex-col gap-5 overflow-hidden rounded-surface border-2 border-line bg-surface p-6 lg:mt-[58px]">
          <Skeleton className="-mx-6 -mt-6 h-40 rounded-none" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-12 w-40 rounded-full" />
        </section>
      </div>
    </Page>
  );
}
