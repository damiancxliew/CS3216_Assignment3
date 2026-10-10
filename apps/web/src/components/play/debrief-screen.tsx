"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Debrief } from "@/lib/attempts/debrief";
import { isReflectionComplete } from "@/lib/attempts/reflection";
import { AdventureHeader } from "./adventure-header";
import { DebriefJournal } from "./debrief-journal";
import { ShareButtons } from "@/components/share-buttons";
import styles from "./adventure-chrome.module.css";

export function DebriefScreen({ debrief }: { debrief: Debrief }) {
  const [complete, setComplete] = useState(() => isReflectionComplete(debrief.reflections, debrief));
  const [focusReflectionRequest, setFocusReflectionRequest] = useState(0);

  useEffect(() => {
    if (complete) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [complete]);

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
          {complete ? (
            <Link href={`/play/${debrief.attemptId}`} className={`${styles.chip} inline-flex min-h-11 items-center border px-4 text-sm font-semibold`}>Back to ending</Link>
          ) : (
            <button type="button" disabled aria-disabled="true" className={`${styles.chip} inline-flex min-h-11 items-center border px-4 text-sm font-semibold opacity-60`}>Back to ending</button>
          )}
        </header>
        {!complete ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-surface p-4 text-ink">
            <p>Answer the four reflection questions to finish your debrief.</p>
            <button type="button" onClick={() => setFocusReflectionRequest((request) => request + 1)} className="min-h-11 rounded-control border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-ink">
              Go to reflections
            </button>
          </div>
        ) : null}
        <DebriefJournal debrief={debrief} onCompleteChange={setComplete} focusReflectionRequest={focusReflectionRequest} />
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          {complete ? <details className="max-w-full">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-muted">Share your ending</summary>
              <div className="py-3"><ShareButtons adventure={debrief.adventureTitle} ending={debrief.ending.title} /></div>
            </details> : null}
          <p className="text-xs text-muted">Made with <Link href="/" className="underline underline-offset-4">Historical Adventures</Link></p>
        </footer>
      </div>
    </main>
  );
}
