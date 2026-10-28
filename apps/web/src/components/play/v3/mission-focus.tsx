"use client";

import type { PlayerView } from "@adventure/play-contract";
import { useState } from "react";
import { documentDisplayTitle } from "@/lib/play/v3/document-labels";

type MissionItem = {
  label: string;
  text: string;
  tab: "notes" | "log" | "documents";
  documentId?: string;
};

/** Documents have no collected-at timestamp, so compare snapshots for new pickups. */
export function recentMissionItem(view: PlayerView, previous?: PlayerView): MissionItem | null {
  const stageIndex = view.stage?.index;
  const knownMessages = new Set(previous?.messages.map((message) => message.id));
  const knownNotes = new Set(previous?.notes.map((note) => note.id));
  const messages = view.messages.filter((message) => message.stageIndex === stageIndex && message.kind !== "player"
    && !knownMessages.has(message.id));
  const notes = view.notes.filter((note) => note.stageIndex === stageIndex
    && !knownNotes.has(note.id));
  const latest = [
    ...messages.map((message) => ({
      at: message.at,
      item: { label: message.kind === "thought" ? "Hint" : "Latest log", text: message.text, tab: "log" } as MissionItem,
    })),
    ...notes.map((note) => ({ at: note.at, item: { label: "Latest note", text: note.text, tab: "notes" } as MissionItem })),
  ].sort((a, b) => a.at - b.at).at(-1);
  if (latest) return latest.item;
  const document = previous ? view.documents.filter((document) => !previous.documents.some((old) => old.id === document.id)).at(-1) : null;
  return document ? { label: "Latest document", text: documentDisplayTitle(document.title), tab: "documents", documentId: document.id } : null;
}

export function MissionFocus({ view, onOpenDocument, onOpenJournal, showNextStep = true }: {
  view: PlayerView;
  /** Authored experiences already supply their own next-step controls. */
  showNextStep?: boolean;
  onOpenDocument: (id: string) => void;
  onOpenJournal: (tab: MissionItem["tab"]) => void;
}) {
  const [focus, setFocus] = useState(() => ({ view, item: recentMissionItem(view) }));
  // Keep the last update visible until something newer arrives; reset at stage boundaries.
  let item = focus.item;
  if (focus.view !== view) {
    item = focus.view.stage?.index !== view.stage?.index
      ? recentMissionItem(view)
      : recentMissionItem(view, focus.view) ?? focus.item;
    setFocus({ view, item });
  }
  const preparation = view.stage?.preparation;
  const moment = view.definingMoment;
  const nextAction = moment
    ? moment.status === "predicting" ? "Predict what happens next." : "Choose your course of action."
    : preparation?.ready ? "You’re ready. Review the stage decision, or keep exploring."
      : preparation?.hint ?? (preparation?.timerExpired
        ? "Hear from the remaining essential people before deciding."
        : "Explore the rooms, read the evidence, and talk to the people you meet.");
  if (moment || (preparation?.ready && showNextStep)) item = null;
  if (!item && !showNextStep) return null;

  return (
    <div aria-label="Current focus" className="rounded-lg border border-[#1f2433]/15 bg-white/65 p-2.5">
      <div role="status" aria-live="polite" aria-atomic="true">
        <h3 className="mb-1 text-[11px] font-black uppercase tracking-wide text-[#5c6472]">{item?.label ?? "Next step"}</h3>
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{item?.text ?? nextAction}</p>
      </div>
      {item ? <button type="button" onClick={() => item.documentId ? onOpenDocument(item.documentId) : onOpenJournal(item.tab)} className="mt-1 min-h-9 text-xs font-bold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3659cf]">
        {item.documentId ? "Read document" : "Open in Journal"}
      </button> : null}
    </div>
  );
}
