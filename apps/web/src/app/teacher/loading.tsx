import { Page, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <Page title="Your adventures" width="wide">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16" aria-busy>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-4">
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </span>
              <Skeleton className="h-7 w-24" />
            </li>
          ))}
        </ul>
        <section className="flex flex-col gap-5 rounded-surface border border-line bg-surface p-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-24 w-3/4 rounded-surface" />
        </section>
      </div>
    </Page>
  );
}
