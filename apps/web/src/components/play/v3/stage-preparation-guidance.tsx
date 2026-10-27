"use client";

import type { PlayerView } from "@adventure/play-contract";
import { PreparationDialog } from "./preparation-dialog";

export type StageGuidance = { type: "character"; characterId: string } | { type: "decision" | "confirm" | "ready" | "timer" | "help" };

export function StagePreparationGuidance({ guidance, view, busy, decisionHint, onClose, onReview, onDecide }: {
  guidance: StageGuidance;
  view: PlayerView;
  busy: boolean;
  decisionHint?: string;
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
    confirm: "Finish exploring and decide?",
    timer: !preparation ? "Time’s up" : "Time to review the decision",
    ready: "You can make the stage decision",
    help: "How to prepare for this stage",
    decision: "There is more to investigate",
  };
  const canReview = (guidance.type === "ready" || guidance.type === "timer" || guidance.type === "help") && preparation?.ready;
  const decideNow = guidance.type === "confirm" || (guidance.type === "timer" && !preparation);
  const primary = decideNow
    ? { label: "Continue to decision", disabled: busy, onClick: onDecide }
    : canReview ? { label: "Review decision", onClick: onReview } : undefined;
  return (
    <PreparationDialog title={titles[guidance.type]} onClose={onClose} primary={primary}>
      {guidance.type === "character" ? <>
        <p>Preparation: {characterPreparation?.completed ?? 0} of {characterPreparation?.required ?? 0} tasks complete.</p>
        <p>{characterPreparation?.hint ?? "Read the relevant evidence and complete its reading checks before starting this conversation."}</p>
      </> : guidance.type === "confirm" ? <>
        <p>{view.stage?.centralQuestion}</p>
        <p>{decisionHint ?? "Continuing ends exploration for this stage. You can review your collected documents during the decision."}</p>
      </> : <>
        {guidance.type === "help" ? <p><strong>{view.stage?.centralQuestion}</strong></p> : null}
        {guidance.type === "help" ? <p>Read the evidence and answer each reading check with a short supporting passage. Complete the preparation shown beside a character before talking to them.</p>
          : guidance.type === "timer" ? <p>{!preparation ? "The investigation time has ended. Look over your notes and documents if you need to, then continue to the decision." : "The investigation time has ended. You can decide now with the evidence you have, or keep exploring first."}</p>
          : guidance.type === "ready" ? <p>You have heard from every essential person and can now review the decision. You can also keep exploring.</p>
          : <p>Complete the required evidence and hear from every essential person before deciding.</p>}
        {preparation ? <p>Evidence preparation: {preparation.completed} of {preparation.required}. Essential conversations: {completed} of {essential.length}.</p> : null}
        {guidance.type === "help" && preparation?.timerExpired ? <p>Time has run out. You can decide now, even if some evidence or conversations are unfinished.</p> : null}
        {essential.length ? <ul>{essential.map((conversation) => <li key={conversation.characterId}>{conversation.name}: {conversation.complete ? "conversation complete" : "conversation still needed"}</li>)}</ul> : null}
        {preparation?.hint ? <p>{preparation.hint}</p> : null}
        {guidance.type === "help" ? <p>Use the Journal to revisit documents and notes. If an answer needs review, complete its correction or investigate another relevant source before retrying.</p> : null}
      </>}
    </PreparationDialog>
  );
}
