"use client";

import { ArrowRight, Check, CornerDownRight, Flag, HelpCircle, Lock, ScrollText } from "lucide-react";

import type { PlayState } from "@/lib/play/session";
import { Spinner } from "@/components/ui";
import { AdventureDialog } from "./adventure-dialog";
import styles from "./adventure-chrome.module.css";

export type BoardTab = "goals" | "evidence" | "decision";
type Goal = PlayState["stage"]["objectives"][number];

const primary = `${styles.primary} inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-4 py-2 text-base font-semibold leading-snug text-paper hover:bg-record disabled:opacity-60`;
const subtle = "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-strong px-3 py-2 text-sm font-semibold text-ink hover:border-ink disabled:opacity-60";

/** The full case stays available without taking height from the conversation. */
export function CaseBoard({ state, tab, onTab, hintLevels, onHint, onGuide, onRead, onAccounts, onDecide, decidingOption, busy, onClose }: {
  state: PlayState;
  tab: BoardTab;
  onTab: (tab: BoardTab) => void;
  hintLevels: Record<string, number>;
  onHint: (key: string, level: number) => void;
  onGuide: (goal: Goal) => void;
  onRead: (id: string) => void;
  onAccounts: () => void;
  onDecide: (id: string) => void;
  decidingOption: string | null;
  busy: boolean;
  onClose: () => void;
}) {
  const met = state.stage.objectives.filter((goal) => goal.met).length;
  const ready = state.options.some((option) => option.available);
  const documents = state.journal.map((entry) => ({
    ...entry,
    name: state.props.find((prop) => prop.id === entry.id)?.name ?? entry.text.split(": ")[0] ?? "Document",
  }));

  return (
    <AdventureDialog kind="board" titleId="case-board-title" onClose={onClose}>
      <div>
        <p className={styles.modalKicker}><Flag size={14} aria-hidden /> Stage {state.stage.index + 1} of {state.stageCount}</p>
        <h2 id="case-board-title" className={styles.modalTitle}>{state.stage.title}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{state.decisionPrompt}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line pb-3" role="tablist" aria-label="Case board sections" onKeyDown={(event) => {
        const sections: BoardTab[] = ["goals", "evidence", "decision"];
        const current = sections.indexOf(tab);
        const next = event.key === "ArrowRight" ? sections[(current + 1) % sections.length]
          : event.key === "ArrowLeft" ? sections[(current + sections.length - 1) % sections.length]
            : event.key === "Home" ? sections[0] : event.key === "End" ? sections.at(-1) : null;
        if (!next) return;
        event.preventDefault();
        onTab(next);
        window.requestAnimationFrame(() => document.getElementById(`case-tab-${next}`)?.focus());
      }}>
        {(["goals", "evidence", "decision"] as const).map((section) => (
          <button key={section} id={`case-tab-${section}`} type="button" role="tab" tabIndex={tab === section ? 0 : -1} aria-selected={tab === section} aria-controls={`case-panel-${section}`} aria-label={section === "goals" ? `Goals ${met} of ${state.stage.objectives.length}` : section === "evidence" ? `Evidence ${documents.length}` : ready ? "Decision ready" : "Decision locked"} className={`inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 py-2 text-sm font-semibold ${tab === section ? "bg-world text-paper" : "border border-line-strong bg-surface text-ink"}`} onClick={() => onTab(section)}>
            {section === "goals" ? "Goals" : section === "evidence" ? "Evidence" : <>{!ready ? <Lock size={14} aria-hidden /> : null}Decision</>}
          </button>
        ))}
      </div>

      <section id="case-panel-goals" role="tabpanel" aria-labelledby="case-tab-goals" hidden={tab !== "goals"} className={`${tab === "goals" ? "flex" : "hidden"} flex-col gap-3`}>
          <p className="text-sm text-muted">Yellow = available now · Green = done · Grey = finish prerequisites first</p>
          <div className={styles.progress} aria-hidden="true">{state.stage.objectives.map((goal) => <span key={goal.id} data-complete={goal.met} />)}</div>
          <ol className="flex flex-col gap-2">
            {state.stage.objectives.map((goal) => {
              const missing = goal.requires.filter((id) => !state.stage.objectives.find((candidate) => candidate.id === id)?.met)
                .map((id) => state.stage.objectives.find((candidate) => candidate.id === id)?.title ?? id);
              const locked = !goal.met && missing.length > 0;
              const hintKey = `${state.stage.id}:${goal.id}`;
              const hintLevel = hintLevels[hintKey] ?? 0;
              const maxHints = state.objectiveClues[goal.id] ? 2 : 1;
              return (
                <li key={goal.id} className={`rounded-control border px-3 py-3 ${goal.met ? "border-world/30 bg-world-wash/50" : locked ? "border-line bg-surface/50 text-muted" : styles.goalAvailable}`}>
                  <div className="flex items-start gap-2.5">
                    <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${goal.met ? "border-world bg-world text-paper" : locked ? "border-line-strong bg-sunken text-muted" : styles.goalDot}`}>
                      {goal.met ? <Check size={13} strokeWidth={3} aria-hidden /> : locked ? <Lock size={11} aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold uppercase tracking-wide">{goal.met ? "Done" : locked ? "Locked" : "Available now"}</p>
                      <p className={`text-base font-semibold ${goal.met ? "line-through" : ""}`}>{goal.title}</p>
                      {locked ? <p className="mt-1 flex items-start gap-1 text-sm"><CornerDownRight size={14} className="mt-0.5 shrink-0" aria-hidden /> Finish first: {missing.join("; ")}</p> : null}
                      {!goal.met && !locked ? (
                        <>
                          {goal.conversation ? <p className="mt-1 text-sm">Replies {goal.conversation.exchanges} of {goal.conversation.required}; follow up for a substantive answer.</p> : null}
                          {hintLevel > 0 ? <p className="mt-1 text-sm text-muted">{hintLevel === 1 ? state.objectiveClues[goal.id] ?? state.objectiveHints[goal.id] : state.objectiveHints[goal.id]}</p> : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" className={subtle} onClick={() => onGuide(goal)}>{goal.target.kind === "agent" ? `Talk to ${goal.target.name}` : `Read ${goal.target.name}`} <ArrowRight size={15} aria-hidden /></button>
                            {hintLevel < maxHints ? <button type="button" className={subtle} onClick={() => onHint(hintKey, hintLevel + 1)}><HelpCircle size={15} aria-hidden /> {hintLevel ? "Clearer hint" : "Show hint"}</button> : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
      </section>

      <section id="case-panel-evidence" role="tabpanel" aria-labelledby="case-tab-evidence" hidden={tab !== "evidence"} className={`${tab === "evidence" ? "flex" : "hidden"} flex-col gap-3`}>
          <h3 className="font-serif text-xl text-ink">What you have found</h3>
          {documents.length ? <ul className="flex flex-col gap-2">{documents.map((document) => <li key={document.id}><button type="button" className={`${subtle} w-full justify-between text-left`} onClick={() => onRead(document.id)}><span>{document.name}</span><ScrollText size={17} aria-hidden /></button></li>)}</ul> : <p className="text-sm text-muted">No documents collected yet. Follow a yellow goal to find one.</p>}
          {state.accountClues.length ? (
            <div className="rounded-control border border-line bg-surface p-3">
              <p className="font-semibold text-ink">Accounts to compare</p>
              <p className="mt-1 text-sm text-muted">Ask both witnesses the same question and check their claims against a document.</p>
              <button type="button" className={`${subtle} mt-3`} onClick={onAccounts}>Compare witness accounts <ArrowRight size={15} aria-hidden /></button>
            </div>
          ) : null}
          {state.previousDecision ? <p className="text-sm text-muted">Earlier choice: {state.previousDecision.choice ?? "Time ran out"}. {state.previousDecision.outcome}</p> : null}
      </section>

      <section id="case-panel-decision" role="tabpanel" aria-labelledby="case-tab-decision" hidden={tab !== "decision"} className={`${tab === "decision" ? "flex" : "hidden"} flex-col gap-3`}>
          <h3 className="font-serif text-xl text-ink">{ready ? "You can decide now" : "Decision locked"}</h3>
          <p className="text-sm text-muted">{ready ? "This ends the stage. Review the evidence before choosing." : "Finish the available goals and their prerequisites first."}</p>
          <ul className="flex flex-col gap-2">
            {state.options.map((option) => <li key={option.id}>
              <button type="button" className={`${option.available ? primary : subtle} w-full flex-col items-start text-left`} disabled={!option.available || busy} onClick={() => onDecide(option.id)}>
                <span className="flex items-start gap-2">{decidingOption === option.id ? <Spinner className="mt-0.5 h-4 w-4" /> : null}{option.label}</span>
                {!option.available ? <span className="text-sm font-normal text-muted"><Lock size={13} className="inline" aria-hidden /> {option.unavailableReason}</span> : null}
              </button>
            </li>)}</ul>
          {decidingOption ? <p role="status" className="text-sm text-muted">Deciding… writing what happens next.</p> : null}
          {state.announcements.length ? <div className="border-t border-line pt-3"><p className="text-sm font-semibold text-ink">Earlier outcomes</p>{state.announcements.map((entry) => <p key={entry.id} className="mt-2 text-sm text-muted">{entry.body}</p>)}</div> : null}
      </section>

      <button type="button" className={`${subtle} self-start`} onClick={onClose}>Return to the scene</button>
    </AdventureDialog>
  );
}
