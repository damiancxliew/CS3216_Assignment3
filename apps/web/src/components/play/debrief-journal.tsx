"use client";

import { useEffect, useRef, useState } from "react";
import type { Debrief } from "@/lib/attempts/debrief";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { isReflectionAnswerComplete, isReflectionComplete, REFLECTION_PROMPT_KEYS } from "@/lib/attempts/reflection";
import { RecordEntry, WorldEntry } from "@/components/ui";
import { DebriefReflection } from "./debrief-reflection";
import styles from "./debrief-journal.module.css";

const SECTIONS = [
  { id: "overview", label: "At a glance" },
  { id: "path", label: "Your decisions" },
  { id: "evidence", label: "Sources & scrolls" },
  { id: "reflection", label: "Reflect" },
] as const;
type Section = typeof SECTIONS[number]["id"];

export function DebriefJournal({
  debrief,
  onCompleteChange,
  focusReflectionRequest,
}: {
  debrief: Debrief;
  onCompleteChange: (complete: boolean) => void;
  focusReflectionRequest: number;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [answers, setAnswers] = useState(debrief.reflections);
  const complete = isReflectionComplete(answers, debrief);
  const initiallyComplete = useRef(complete);
  const completionTracked = useRef(false);

  useEffect(() => {
    onCompleteChange(complete);
  }, [complete, onCompleteChange]);

  useEffect(() => {
    if (complete && !initiallyComplete.current && !completionTracked.current) {
      track(ANALYTICS_EVENTS.reflectionCompleted, { band: debrief.readingBand });
      completionTracked.current = true;
    }
  }, [complete, debrief.readingBand]);

  useEffect(() => {
    if (!focusReflectionRequest) return;
    setSection("reflection");
    document.getElementById("tab-reflection")?.focus();
  }, [focusReflectionRequest]);

  const answered = REFLECTION_PROMPT_KEYS.filter((key) =>
    isReflectionAnswerComplete(key, answers.find((answer) => answer.promptKey === key), debrief),
  ).length;
  return (
    <div className={styles.journal}>
      <div role="tablist" aria-label="Debrief journal" className={styles.tabs}>
        {SECTIONS.map((item, index) => (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={section === item.id}
            aria-controls={`panel-${item.id}`} tabIndex={section === item.id ? 0 : -1}
            onClick={() => setSection(item.id)}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight" ? (index + 1) % SECTIONS.length
                : event.key === "ArrowLeft" ? (index + SECTIONS.length - 1) % SECTIONS.length
                : event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              setSection(SECTIONS[next].id);
              document.getElementById(`tab-${SECTIONS[next].id}`)?.focus();
            }}>{item.label}</button>
        ))}
      </div>

      <section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={section !== "overview"} tabIndex={0} className={styles.paper}>
        <div className={styles.comparison}>
          <div className={styles.world}>
            <h2>In your simulation</h2>
            <p>{debrief.simulatedOutcome}</p>
            <span className={styles.note}>A fictional outcome shaped by your choices.</span>
          </div>
          <div className={styles.record}>
            <h2>In the historical record</h2>
            <p className="font-serif">{debrief.documentedHistory.text}</p>
            {debrief.documentedHistory.citations.length ? (
              <button type="button" className={styles.sourceLink} onClick={() => { setSection("evidence"); document.getElementById("tab-evidence")?.focus(); }}>
                Read {debrief.documentedHistory.citations.length} source {debrief.documentedHistory.citations.length === 1 ? "excerpt" : "excerpts"} →
              </button>
            ) : <span className={styles.note}>No page citations available. This is a summary, not a source.</span>}
          </div>
        </div>
        <div className={styles.takeaway}>
          <h2>How your story compares</h2>
          <p>{debrief.divergence}</p>
        </div>
      </section>

      <section role="tabpanel" id="panel-path" aria-labelledby="tab-path" hidden={section !== "path"} tabIndex={0} className={styles.paper}>
        <h2 className={styles.sectionTitle}>The choices that brought you here</h2>
        {debrief.path.length ? <ol className={styles.entries}>
          {debrief.path.map((stage) => <li key={stage.stageIndex}>
            <WorldEntry label={`Stage ${stage.stageIndex + 1} · ${stage.stageTitle}`}>
              <p>{stage.chose ?? "The clock ran out; the stage continued without your decision."}</p>
              <details className={styles.details}>
                <summary>What followed</summary>
                {stage.announcement ? <p>{stage.announcement}</p> : null}
                {stage.changes.length ? <ul className="list-disc pl-5">{stage.changes.map((change, i) => <li key={i}>{change}</li>)}</ul> : null}
              </details>
            </WorldEntry>
          </li>)}
        </ol> : <p>No stage decisions were recorded.</p>}
      </section>

      <section role="tabpanel" id="panel-evidence" aria-labelledby="tab-evidence" hidden={section !== "evidence"} tabIndex={0} className={styles.paper}>
        <h2 className={styles.sectionTitle}>The historical sources</h2>
        {debrief.documentedHistory.citations.length ? <ol className={styles.entries}>
          {debrief.documentedHistory.citations.map((citation, index) => <li key={`${citation.sourceId}-${citation.page}-${index}`}>
            <RecordEntry compact quote={citation.quote} source={`${citation.sourceTitle} (${citation.sourceKind}), page ${citation.page}`} />
          </li>)}
        </ol> : <p className="text-muted">No page citations are available for this ending.</p>}
        <h2 className={`${styles.sectionTitle} mt-6`}>Your collected scrolls · {debrief.collectedEvidence.length}</h2>
        {debrief.collectedEvidence.length ? debrief.collectedEvidence.map((entry) => <details key={entry.id} className={styles.scroll}>
          <summary>{entry.name}</summary>
          {entry.stageTitle ? <p className="text-sm text-muted">Collected in {entry.stageTitle}</p> : null}
          <p className="whitespace-pre-line">{entry.text}</p>
          {entry.sourceSpan ? <div className="border-t border-line pt-3 text-record"><h3 className="text-sm font-semibold">Supporting source excerpts</h3><p className="whitespace-pre-line font-serif">{entry.sourceSpan}</p></div> : null}
        </details>) : <p className="text-muted">No scrolls collected. Use the historical sources to consider what information you were missing.</p>}
      </section>

      <section role="tabpanel" id="panel-reflection" aria-labelledby="tab-reflection" hidden={section !== "reflection"} tabIndex={0} className={styles.paper}>
        <p className={styles.reflectionProgress} aria-live="polite">{answered} of 4 answered</p>
        <DebriefReflection debrief={debrief} answers={answers} onAnswersChange={setAnswers} />
        <h2 className={`${styles.sectionTitle} mt-8`}>Questions to discuss in class</h2>
        {debrief.reflectionQuestions.length ? <ol className={styles.questions}>
          {debrief.reflectionQuestions.map((question, index) => <li key={question}><span aria-hidden>{index + 1}</span><p>{question}</p></li>)}
        </ol> : <p>How did your choices compare with the historical outcome?</p>}
        <details className={`${styles.scroll} mt-6`}>
          <summary>What the simulation assumed · {debrief.assumptions.length}</summary>
          {debrief.assumptions.length ? debrief.assumptions.map((assumption) => <div key={assumption.id} className="my-4"><WorldEntry><p>{assumption.text}</p><p className="mt-2 text-muted">{assumption.rationale}</p></WorldEntry></div>) : <p>No assumptions are listed for this attempt.</p>}
        </details>
      </section>
    </div>
  );
}
