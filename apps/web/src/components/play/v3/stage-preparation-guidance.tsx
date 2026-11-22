"use client";

import type { PlayerView } from "@adventure/play-contract";
import { PreparationProgress } from "./preparation-progress";
import { PreparationDialog } from "./preparation-dialog";
import type { QuestStep } from "./quest-steps";
import { QuestSteps } from "./quest-ui";

export type StageGuidance = { type: "character"; characterId: string } | { type: "decision" | "confirm" | "ready" | "timer" | "help" };

const neverActivate = () => false;

export function StagePreparationGuidance({ guidance, view, busy, decisionHint, steps, next = null, onClose, onReview, onDecide }: {
  guidance: StageGuidance;
  view: PlayerView;
  busy: boolean;
  decisionHint?: string;
  /** The quest log; replaces the progress counters when the stage has preparation. */
  steps?: QuestStep[];
  next?: QuestStep | null;
  onClose: () => void;
  onReview: () => void;
  onDecide: () => void;
}) {
  const preparation = view.stage?.preparation;
  const essential = preparation?.essentialConversations ?? [];
  const completed = essential.filter((conversation) => conversation.complete).length;
  const character = guidance.type === "character" ? view.characters.find((candidate) => candidate.id === guidance.characterId) : null;
  const characterPreparation = character?.preparation;
  const titles = {
    character: `Prepare to talk to ${character?.name ?? "this character"}`,
    confirm: "Ready to make your decision?",
    timer: preparation?.ready ? "Time to make your decision" : "Time for the final conversations",
    ready: "You’re ready to decide",
    help: "How to play this stage",
    decision: "There is more to investigate",
  };
  const canReview = (guidance.type === "ready" || guidance.type === "timer" || guidance.type === "help") && preparation?.ready;
  const primary = guidance.type === "confirm"
    ? { label: "Continue to decision", disabled: busy, onClick: onDecide }
    : canReview ? { label: "Make your decision", onClick: onReview } : undefined;
  const checklist = preparation && steps?.length
    ? <QuestSteps steps={steps} next={next} canActivate={neverActivate} onActivate={() => {}} />
    : preparation ? <>
      <PreparationProgress label="Evidence found" completed={preparation.completed} required={preparation.required} />
      <PreparationProgress label="People heard from" completed={completed} required={essential.length} />
    </> : null;
  return (
    <PreparationDialog title={titles[guidance.type]} onClose={onClose} primary={primary}>
      {guidance.type === "character" ? <>
        <PreparationProgress label="Preparation" completed={characterPreparation?.completed ?? 0} required={characterPreparation?.required ?? 0} />
        <p>{characterPreparation?.hint ?? "Read the relevant evidence and complete its reading checks before starting this conversation."}</p>
      </> : guidance.type === "confirm" ? <>
        <p><strong>{view.stage?.centralQuestion}</strong></p>
        <p>{decisionHint ?? "You’ll stop exploring this stage and choose what to do. Your documents and notes stay with you."}</p>
      </> : <>
        {guidance.type === "help" ? <p><strong>{view.stage?.centralQuestion}</strong></p> : null}
        {guidance.type === "help" ? <p>Follow the quest steps: read the sources, answer each source’s question by highlighting the line that proves it, and talk to the people marked with “!”. A lock means you need to read something first.</p>
          : guidance.type === "timer" ? <p>{preparation?.ready ? "Time’s up for exploring. You can make your decision now." : "Time’s up for exploring. Finish the conversations below, then decide."}</p>
          : guidance.type === "ready" ? <p>You’ve found enough to decide. Make your decision now, or keep exploring first.</p>
          : <p>Finish these steps before deciding:</p>}
        {checklist}
        {guidance.type === "help" && preparation?.timerExpired ? <p>Time has run out. You can decide once the conversations are done.</p> : null}
        {guidance.type === "help" ? <p>Your Journal (top right) keeps every document and note. If an answer is marked wrong, try again or read another source.</p> : null}
      </>}
    </PreparationDialog>
  );
}
