import { Skeleton, Spinner } from "@/components/ui";
import styles from "@/components/play/adventure-chrome.module.css";

/** Keep the loading view in the same frame as the playable page. */
export default function Loading() {
  return (
    <main className={`${styles.shell} flex h-dvh min-h-0 flex-col`} aria-busy>
      <header className={`${styles.header} shrink-0`}>
        <div className={styles.adventureTitle}>
          <span className={styles.headerEmblem} aria-hidden />
          <Skeleton className="h-6 w-48 max-w-[45vw] bg-white/30" />
        </div>
        <div className={`${styles.chapter} flex flex-wrap items-center gap-3`}>
          <Skeleton className="h-6 w-24 bg-white/30" />
          <Skeleton className="h-5 w-40 bg-white/30" />
        </div>
        <div className={styles.headerActions}>
          <Skeleton className="h-9 w-20 bg-white/30" />
          <Skeleton className="h-9 w-16 bg-white/30" />
        </div>
      </header>

      <div className={`${styles.game} flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row`}>
        <section className="relative h-[32dvh] min-h-[11rem] shrink-0 bg-sunken lg:h-auto lg:min-h-0 lg:flex-1" aria-label="Map">
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-base font-semibold text-ink" role="status">
            <Spinner /> Opening your attempt…
          </span>
          <div className="absolute inset-x-3 bottom-3 flex justify-between gap-2" aria-hidden>
            <Skeleton className="h-11 w-28 bg-ink/20" />
            <div className="flex gap-2">
              <Skeleton className="h-11 w-11 bg-ink/20" />
              <Skeleton className="h-11 w-28 bg-ink/20" />
            </div>
          </div>
        </section>

        <aside className={`${styles.panel} flex min-h-0 w-full min-w-0 shrink-0 flex-col text-base lg:w-[min(42rem,48vw)]`}>
          <section className={`${styles.where} flex shrink-0 flex-col gap-3 px-5 py-4`} aria-label="Location loading">
            <Skeleton className="h-5 w-2/3" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-40" />
              </div>
              <Skeleton className="h-9 w-20" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </section>

          <section className={`${styles.conversation} flex min-h-0 flex-1 flex-col gap-3 px-5 py-4`} aria-label="Conversation loading">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-12 flex-1" />
              <Skeleton className="h-12 w-20" />
            </div>
          </section>

          <section className={`${styles.quests} flex flex-col gap-3 px-5 py-4 lg:min-h-0 lg:max-h-[34%]`} aria-label="Goals loading">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-5/6" />
          </section>
        </aside>
      </div>
    </main>
  );
}
