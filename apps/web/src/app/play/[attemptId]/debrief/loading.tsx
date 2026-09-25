import { Skeleton } from "@/components/ui";
import { AdventureHeader } from "@/components/play/adventure-header";
import styles from "@/components/play/adventure-chrome.module.css";

export default function Loading() {
  return (
    <main className={`${styles.shell} min-h-dvh`} aria-busy="true">
      <AdventureHeader title="Your debrief" active={null} recap={[]} />
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-80 w-full" />
      </div>
    </main>
  );
}
