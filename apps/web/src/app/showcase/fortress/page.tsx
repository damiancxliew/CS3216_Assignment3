import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Action } from "@adventure/play-contract";

import { v3AdventureScenery } from "@/lib/play/v3/scenery";
import { FortressPlay } from "./fortress-play";
import { fortressSpec, startFortress, stepFortress } from "./engine";

export const metadata: Metadata = { title: "Showcase: The Fortress That Fell", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ART = "/showcase/fortress/art";
/** Real people use their archival photographs; fictional characters fall back to initials until portraits exist. */
const PHOTOS: Record<string, string> = { percival: `${ART}/portrait-percival.jpg`, bennett: `${ART}/portrait-bennett.jpg` };

/** `?steps=continue,continue,message:percival=Why?` replays actions through the real engine first. */
function parseStep(step: string): Action {
  const [type, ...rest] = step.split(":");
  const arg = rest.join(":");
  const [left, right] = arg.split("=");
  switch (type) {
    case "enterRoom": return { type, roomId: arg };
    case "message": return { type, characterId: left!, text: right ?? "Tell me more." };
    case "openDocument": case "closeDocument": return { type, documentId: arg };
    case "act": return { type, actId: arg };
    case "predict": return { type, outcomeId: arg };
    case "insertNote": return { type, characterId: left!, noteId: right! };
    default: return { type } as Action;
  }
}

export default async function FortressShowcasePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const spec = fortressSpec();
  let snapshot = startFortress();
  for (const raw of (params.steps ?? "").split(",").filter(Boolean)) {
    // `note:<characterId>=<discoveryId>` shows the student's note for that discovery.
    if (raw.startsWith("note:")) {
      const [characterId, discoveryId] = raw.slice(5).split("=");
      const note = snapshot.state.notes.find((candidate) => candidate.discoveryId === discoveryId);
      if (note) snapshot = await stepFortress(snapshot, { type: "insertNote", characterId: characterId!, noteId: note.id });
      continue;
    }
    if (raw.startsWith("read:")) {
      // `read:<documentId>` opens it, highlights its key passage and passes its reading check.
      const documentId = raw.slice(5);
      const document = spec.documents.find((candidate) => candidate.id === documentId);
      snapshot = await stepFortress(snapshot, { type: "openDocument", documentId });
      const question = snapshot.view.documents.find((candidate) => candidate.id === documentId)?.readingCheck?.question;
      const variant = document?.readingCheck?.variants.find((candidate) => candidate.id === question?.id);
      if (variant) snapshot = await stepFortress(snapshot, { type: "submitReadingCheck", documentId, questionId: variant.id, choiceId: variant.correctOptionId, start: variant.support[0]!.start, end: variant.support[0]!.end });
      snapshot = await stepFortress(snapshot, { type: "closeDocument", documentId });
      continue;
    }
    try { snapshot = await stepFortress(snapshot, parseStep(raw)); }
    catch (error) { console.warn("showcase step failed", raw, error); }
  }
  const portraits = Object.fromEntries(spec.characters.flatMap((character) => {
    const url = PHOTOS[character.id] ?? null;
    return [[character.id, { url }], ...character.stances.map((stance) => [`${character.id}:${stance.id}`, { url }])];
  }));
  const stageImages = spec.stages.map((stage, index) => ({ url: `${ART}/stage-${index + 1}-${stage.id}.jpg`, version: 1, selection: "default" as const }));
  return (
    <FortressPlay
      initial={snapshot}
      scenery={v3AdventureScenery(spec)}
      portraitBase={{ selected: portraits }}
      stageImages={stageImages}
    />
  );
}
