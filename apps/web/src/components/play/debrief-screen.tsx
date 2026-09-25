import Link from "next/link";
import type { Debrief } from "@/lib/attempts/debrief";
import { AdventureHeader } from "./adventure-header";
import { DebriefJournal } from "./debrief-journal";
import { ShareButtons } from "@/components/share-buttons";
import styles from "./adventure-chrome.module.css";

export function DebriefScreen({ debrief }: { debrief: Debrief }) {
  return (
    <main className={`${styles.shell} min-h-dvh`}>
      <AdventureHeader title={debrief.adventureTitle} active={null} recap={[]} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80">
            <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-muted">Adventure complete · Your debrief</p>
            <h2 className="font-serif text-3xl leading-tight text-ink sm:text-4xl">{debrief.ending.title}</h2>
            <p className="mt-3 text-sm text-muted">{debrief.path.length} {debrief.path.length === 1 ? "stage" : "stages"} · {debrief.collectedEvidence.length} {debrief.collectedEvidence.length === 1 ? "scroll" : "scrolls"} collected</p>
          </div>
          <Link href={`/play/${debrief.attemptId}`} className={`${styles.chip} inline-flex min-h-11 items-center border px-4 text-sm font-semibold`}>Back to ending</Link>
        </header>
        <DebriefJournal debrief={debrief} />
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <details className="max-w-full">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-muted">Share your ending</summary>
            <div className="py-3"><ShareButtons adventure={debrief.adventureTitle} ending={debrief.ending.title} /></div>
          </details>
          <p className="text-xs text-muted">Made with <Link href="/" className="underline underline-offset-4">Historical Adventures</Link></p>
        </footer>
      </div>
    </main>
  );
}
