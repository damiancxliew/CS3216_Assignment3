import type { PlayerView } from "@adventure/play-contract";

/** What the map should point at for the next quest step. Mirrors `V3Map`'s `guideTarget` prop. */
export type GuideTarget = { kind: "character" | "document" | "room"; id: string } | null;

export type QuestStepKind = "read" | "talk" | "decide";

export type QuestStep = {
  /** Stable across renders, so a step flipping to done can be celebrated once. */
  id: string;
  kind: QuestStepKind;
  text: string;
  /** Where to do it: "here", a room name, or "in your journal". */
  where: string | null;
  done: boolean;
  locked: boolean;
  /** Plain-language prerequisite, e.g. `Read “The harbour letter” first`. */
  lockReason: string | null;
  target: GuideTarget;
  /** A held document the step can open directly. */
  documentId: string | null;
  characterId: string | null;
};

export type QuestPlan = {
  steps: QuestStep[];
  next: QuestStep | null;
  guideTarget: GuideTarget;
  ready: boolean;
};

/** Client-side recollection within one stage, so steps stay named after the player walks away. */
export type QuestMemory = {
  /** Last seen preparation of characters outside the current room. */
  characterPreparation: Record<string, { ready: boolean; hint: string | null }>;
  /** Sources the log has already named, in order, so steps keep their names and tick instead of vanishing. */
  reads: string[];
  /** Where named sources lie, from earlier hints and rooms already visited. */
  readRooms: Record<string, string>;
  /** Documents whose reading check had already passed before this stage began. */
  passedBefore: string[];
};

export function emptyQuestMemory(): QuestMemory {
  return { characterPreparation: {}, reads: [], readRooms: {}, passedBefore: [] };
}

type ParsedHint =
  | { kind: "read"; title: string; roomId: string | null; held: boolean }
  | { kind: "talk"; characterId: string | null; name: string; roomId: string | null; noteFrom: string | null };

function quoted(hint: string): string | null {
  return hint.match(/[“"]([^”"]+)[”"]/)?.[1] ?? null;
}

/** The engine names places as ` in <Room name>`; take the longest room name that appears. */
function hintRoom(hint: string, view: PlayerView): string | null {
  return [...view.rooms]
    .sort((a, b) => b.name.length - a.name.length)
    .find((room) => hint.includes(` in ${room.name}`))?.id ?? null;
}

function knownPeople(view: PlayerView) {
  const people = new Map<string, string>();
  for (const person of view.stage?.preparation?.essentialConversations ?? []) people.set(person.characterId, person.name);
  for (const person of view.speakers) people.set(person.id, person.name);
  for (const person of view.characters) people.set(person.id, person.name);
  return [...people].map(([id, name]) => ({ id, name })).sort((a, b) => b.name.length - a.name.length);
}

/** Reads the engine's preparation hint ("Read “X” in Room…", "Speak with Y in Room…", "Show your note from “X” to Y…"). */
export function parsePreparationHint(hint: string | null | undefined, view: PlayerView): ParsedHint | null {
  if (!hint) return null;
  const text = hint.trim();
  const roomId = hintRoom(text, view);
  if (/^Read\b/i.test(text)) {
    const title = quoted(text);
    return title ? { kind: "read", title, roomId, held: /in your documents/i.test(text) } : null;
  }
  const show = /^Show your note/i.test(text);
  if (show || /^(Speak|Talk) (with|to)\b/i.test(text)) {
    const person = knownPeople(view).find((candidate) => text.includes(candidate.name));
    const name = person?.name ?? text.match(/^(?:Speak|Talk) (?:with|to) (.+?)(?: in | about |\.|$)/i)?.[1] ?? text.match(/ to (.+?)(?: in |\.|$)/)?.[1];
    if (!name) return null;
    return { kind: "talk", characterId: person?.id ?? null, name, roomId, noteFrom: show ? quoted(text) : null };
  }
  return null;
}

function roomName(view: PlayerView, roomId: string | null) {
  return roomId ? view.rooms.find((room) => room.id === roomId)?.name ?? null : null;
}

function readStep(view: PlayerView, id: string, title: string, roomId: string | null, done: boolean): QuestStep {
  const here = view.documentsHere.find((document) => document.title === title);
  const held = view.documents.find((document) => document.title === title);
  const elsewhere = !here && roomId && roomId !== view.currentRoomId ? roomId : null;
  const retry = held?.readingCheck?.status === "needsReview";
  return {
    id, kind: "read", text: `Read “${title}”`,
    where: done ? null : retry ? "Try its question again" : here ? "Here in this room" : elsewhere ? `In ${roomName(view, elsewhere)}` : held ? "In your journal" : null,
    done, locked: false, lockReason: null,
    target: done ? null : here ? { kind: "document", id: here.id } : elsewhere ? { kind: "room", id: elsewhere } : null,
    documentId: held && !here ? held.id : null,
    characterId: null,
  };
}

function passed(view: PlayerView, title: string) {
  return view.documents.some((document) => document.title === title && document.readingCheck?.status === "passed");
}

/**
 * Turns the stage's preparation into a short quest log: concrete reads, the people to hear from,
 * then the decision. Returns null for stages without preparation, which keep the generic guidance.
 */
export function questPlan(view: PlayerView, memory: QuestMemory = emptyQuestMemory()): QuestPlan | null {
  const preparation = view.stage?.preparation;
  if (!preparation || !view.stage) return null;
  const hint = parsePreparationHint(preparation.hint, view);
  const steps: QuestStep[] = [];

  // Evidence: one step per required find. Name finished ones after sources passed this stage.
  const required = preparation.required;
  const completed = Math.min(preparation.completed, required);
  const before = new Set(memory.passedBefore);
  const passedTitles = view.documents
    .filter((document) => document.readingCheck?.status === "passed" && !before.has(document.id))
    .map((document) => document.title);
  for (let slot = 0; slot < completed; slot++) {
    const title = passedTitles[slot];
    steps.push(title
      ? readStep(view, `evidence-${slot}`, title, null, true)
      : { id: `evidence-${slot}`, kind: "read", text: "Find a clue in a source", where: null, done: true, locked: false, lockReason: null, target: null, documentId: null, characterId: null });
  }
  const usedTitles = new Set(passedTitles.slice(0, completed));
  const candidates = [
    ...memory.reads.filter((title) => !passed(view, title)).map((title) => ({ title, roomId: hint?.kind === "read" && hint.title === title ? hint.roomId : memory.readRooms[title] ?? null })),
    ...(hint?.kind === "read" && !passed(view, hint.title) ? [{ title: hint.title, roomId: hint.roomId }] : []),
    ...view.documentsHere.filter((document) => !passed(view, document.title)).map((document) => ({ title: document.title, roomId: view.currentRoomId })),
    ...view.documents.filter((document) => document.readingCheck && document.readingCheck.status !== "passed").map((document) => ({ title: document.title, roomId: null })),
  ].filter((candidate, index, all) => all.findIndex((other) => other.title === candidate.title) === index && !usedTitles.has(candidate.title));
  if (!preparation.timerExpired) {
    for (let slot = completed; slot < required; slot++) {
      const candidate = candidates.shift();
      steps.push(candidate
        ? readStep(view, `evidence-${slot}`, candidate.title, candidate.roomId, false)
        : { id: `evidence-${slot}`, kind: "read", text: "Find a clue in another source", where: "Look around the rooms", done: false, locked: false, lockReason: null, target: null, documentId: null, characterId: null });
    }
  }

  // People to hear from.
  for (const person of preparation.essentialConversations) {
    const here = view.characters.find((character) => character.id === person.characterId);
    const seen = here?.preparation ?? memory.characterPreparation[person.characterId];
    const prerequisite = seen && !seen.ready ? parsePreparationHint(seen.hint, view) : null;
    const prerequisiteTitle = prerequisite?.kind === "read" ? prerequisite.title : null;
    const locked = !person.complete && Boolean(seen && !seen.ready) && !(prerequisiteTitle && passed(view, prerequisiteTitle));
    const hinted = hint?.kind === "talk" && hint.characterId === person.characterId ? hint : null;
    const roomId = here ? view.currentRoomId : hinted?.roomId ?? null;
    steps.push({
      id: `talk-${person.characterId}`,
      kind: "talk",
      text: hinted?.noteFrom ? `Show ${person.name} your note` : `Talk to ${person.name}`,
      where: person.complete ? null : here ? "Here in this room" : roomId ? `In ${roomName(view, roomId)}` : null,
      done: person.complete,
      locked,
      lockReason: locked ? prerequisiteTitle ? `Read “${prerequisiteTitle}” first` : "Find more evidence first" : null,
      target: person.complete || locked ? null : here ? { kind: "character", id: here.id } : roomId ? { kind: "room", id: roomId } : null,
      documentId: null,
      characterId: person.characterId,
    });
  }

  // Prerequisite reads that are not already a step: the engine's current pointer, plus remembered ones.
  const extraTitles = [...memory.reads];
  if (hint?.kind === "read" && !extraTitles.includes(hint.title)) extraTitles.push(hint.title);
  for (const step of steps) {
    const title = step.lockReason?.match(/“(.+)”/)?.[1];
    if (title && !extraTitles.includes(title)) extraTitles.push(title);
  }
  const listed = new Set(steps.filter((step) => step.kind === "read").map((step) => step.text));
  const firstTalk = steps.findIndex((step) => step.kind === "talk");
  const extras = extraTitles
    .filter((title) => !listed.has(`Read “${title}”`))
    .map((title) => readStep(view, `extra-${title}`, title, hint?.kind === "read" && hint.title === title ? hint.roomId : memory.readRooms[title] ?? null, passed(view, title)));
  steps.splice(firstTalk < 0 ? steps.length : firstTalk, 0, ...extras);

  // A "speak with someone" pointer for a person outside the essential list.
  if (hint?.kind === "talk" && !steps.some((step) => step.characterId && step.characterId === hint.characterId)) {
    const here = hint.characterId ? view.characters.find((character) => character.id === hint.characterId) : null;
    steps.push({
      id: `extra-talk-${hint.characterId ?? hint.name}`,
      kind: "talk",
      text: hint.noteFrom ? `Show ${hint.name} your note` : `Talk to ${hint.name}`,
      where: here ? "Here in this room" : hint.roomId ? `In ${roomName(view, hint.roomId)}` : null,
      done: false, locked: false, lockReason: null,
      target: here ? { kind: "character", id: here.id } : hint.roomId && hint.roomId !== view.currentRoomId ? { kind: "room", id: hint.roomId } : null,
      documentId: null,
      characterId: hint.characterId,
    });
  }

  const decide: QuestStep = {
    id: "decide", kind: "decide", text: "Make your decision",
    where: preparation.ready ? "You’re ready!" : null,
    done: false, locked: !preparation.ready, lockReason: preparation.ready ? null : "Finish the steps above first",
    target: null, documentId: null, characterId: null,
  };

  const pending = steps.filter((step) => !step.done);
  const prerequisiteOf = (step: QuestStep) => {
    const title = step.lockReason?.match(/“(.+)”/)?.[1];
    return title ? pending.find((candidate) => candidate.kind === "read" && candidate.text === `Read “${title}”`) ?? null : null;
  };
  const hinted = hint
    ? pending.find((step) => hint.kind === "read" ? step.text === `Read “${hint.title}”` : step.characterId !== null && step.characterId === hint.characterId) ?? null
    : null;
  let next: QuestStep | null = preparation.ready
    ? decide
    : pending.find((step) => step.kind === "talk" && !step.locked && step.target?.kind === "character")
      ?? (hinted?.locked ? prerequisiteOf(hinted) : hinted)
      ?? pending.find((step) => step.target?.kind === "document")
      ?? pending.find((step) => !step.locked)
      ?? null;
  if (next?.locked) next = prerequisiteOf(next) ?? next;

  // Done first, then the next step, then the rest; the decision always closes the list.
  const ordered = [
    ...steps.filter((step) => step.done),
    ...(next && next !== decide ? [next] : []),
    ...pending.filter((step) => step !== next),
    decide,
  ];
  return { steps: ordered, next, guideTarget: next?.target ?? null, ready: preparation.ready };
}

/** Records what this view shows, so later views can still name and place it. Mutates `memory`. */
export function rememberQuest(memory: QuestMemory, view: PlayerView, steps: QuestStep[] | undefined) {
  for (const character of view.characters) {
    if (character.preparation) memory.characterPreparation[character.id] = { ready: character.preparation.ready, hint: character.preparation.hint };
  }
  for (const hint of [view.stage?.preparation?.hint, ...view.characters.map((character) => character.preparation?.hint)]) {
    const parsed = parsePreparationHint(hint, view);
    if (parsed?.kind === "read" && parsed.roomId) memory.readRooms[parsed.title] = parsed.roomId;
  }
  if (view.currentRoomId) for (const document of view.documentsHere) memory.readRooms[document.title] = view.currentRoomId;
  for (const step of steps ?? []) {
    const title = step.kind === "read" ? step.text.match(/^Read “(.+)”$/)?.[1] : null;
    if (title && !memory.reads.includes(title)) memory.reads.push(title);
  }
}
