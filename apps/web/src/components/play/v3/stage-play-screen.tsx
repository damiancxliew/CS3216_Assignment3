"use client";
import type { ReactNode } from "react";
import type { Point } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import { ChevronDown, CircleHelp, Lock, ScrollText, Star, Timer } from "lucide-react";
import type { Action, PlayerView, DocumentView } from "@adventure/play-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import { DialogueBox } from "@/components/play/v3/dialogue-box";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { NOTE_PICKUP_MS, useNotePickups } from "@/components/play/v3/note-pickup";
import { documentDisplayTitle } from "@/lib/play/v3/document-labels";
import { NotesPanel } from "@/components/play/v3/notes-panel";
import { StoryToast, talkLines, useStanceShifts, useStoryToasts } from "@/components/play/v3/story-lines";
import { MissionFocus } from "./mission-focus";
import { StageIsland } from "@/components/play/v3/stage-island";
import { V3CardDialog } from "./card-dialog";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import { V3Map } from "@/components/play/v3/v3-map";
import { guidanceWasSeen, rememberGuidance } from "./preparation-dialog";
import { StagePreparationGuidance, type StageGuidance } from "./stage-preparation-guidance";
import { pixelFont } from "./pixel-font";
import { NotesGlyph, PocketToast, StagePill, ToastStack, useArrivals } from "./pocket-ui";
import questStyles from "./quest-ui.module.css";
import { emptyQuestMemory, parsePreparationHint, questPlan, rememberQuest, type GuideTarget, type QuestMemory, type QuestStep } from "./quest-steps";
import { ControlsCoachMark, DecisionCallToAction, QuestPeek, QuestSteps, QuestToast, useQuestToasts } from "./quest-ui";

export function v3InsertNoteAction(characterId: string, noteId: string, text?: string): Action {
  return { type: "insertNote", characterId, noteId, ...(text ? { text } : {}) };
}

export function v3SelectPassageAction(documentId: string, start: number, end: number): Action {
  return { type: "selectPassage", documentId, start, end };
}

export function firstV3CollectedDocumentId(documents: Pick<PlayerView["documents"][number], "id">[]): string | null {
  return documents[0]?.id ?? null;
}

export function submitV3NoteInsert(
  characterId: string,
  noteId: string,
  text: string | undefined,
  send: (action: Action) => void,
  onClose: () => void,
) {
  send(v3InsertNoteAction(characterId, noteId, text));
  onClose();
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type StageExperience = {
  /** Optional host-controlled reader, used by authored walk-up exhibits. */
  activeDocumentId?: string | null;
  documentSupplement?: (document: DocumentView) => ReactNode;
  documentHint?: string;
  scenery?: V3StageScenery;
  mission?: ReactNode;
  overlay?: ReactNode;
  hideDecision?: boolean;
  decisionHint?: string;
  movementLocked?: boolean;
  destination?: Point | null;
  onArrive?: (point: Point) => void;
  onInspect?: (id: string, walkTo: (point: Point) => void) => boolean;
};

export function StagePlayScreen({ view, busy, send, portraitBase = null, attemptId, scenery, movementLocked: externalMovementLock = false, ambient = { id: "clear", intensity: 1 }, audio = { muted: true, cues: [] }, onOpenRoleBrief, experience, hud }: {
  experience?: StageExperience;
  /** Extra square HUD buttons, shown left of the Journal in the top-right cluster. */
  hud?: ReactNode;
  view: PlayerView;
  busy: boolean;
  send: (action: Action, onSettled?: (succeeded: boolean) => void) => void;
  portraitBase?: PortraitBase;
  attemptId: string;
  scenery?: V3StageScenery;
  movementLocked?: boolean;
  ambient?: NonNullable<PlaygroundSnapshot["ambient"]>;
  audio?: NonNullable<PlaygroundSnapshot["audio"]>;
  onOpenRoleBrief?: () => void;
}) {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  const [nearbyId, setNearbyId] = useState<string | null>(null);
  const [confirmEndStage, setConfirmEndStage] = useState(false);
  const [guidance, setGuidance] = useState<StageGuidance | null>(null);
  const seenGuidance = useRef(new Set<string>());
  const [walkTo, setWalkTo] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [missionCollapsed, setMissionCollapsed] = useState(false);
  const [touch, setTouch] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [islandRequest, setIslandRequest] = useState<{
    tab: "notes" | "documents" | "log";
    key: number;
  } | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(
    () => view.documents.find((document) => document.open)?.id ?? null,
  );
  const [now, setNow] = useState<number | null>(null);
  const mapSection = useRef<HTMLElement>(null);
  const pickup = useNotePickups(view.notes);
  const sourceArrival = useArrivals(view.documents, NOTE_PICKUP_MS);
  const talkingRoomId = useRef<string | null>(null);
  const seenAtTalkOpen = useRef<ReadonlySet<string>>(new Set());
  const acknowledgeIslandRequest = useCallback((key: number) => {
    setIslandRequest((current) => current?.key === key ? null : current);
  }, []);
  const stage = view.stage;
  const stageIndex = stage?.index ?? 0;
  const stageId = `stage-${stageIndex}`;
  const isMoment = view.definingMoment !== null;
  const openCharacter = talkingTo !== null &&
    !isMoment &&
    view.currentRoomId === talkingRoomId.current
    ? view.characters.find((character) => character.id === talkingTo) ?? null
    : null;
  const isTalkOpen = openCharacter !== null;
  const activeDocumentId = experience?.activeDocumentId === undefined ? documentId : experience.activeDocumentId;
  const openedDocument = view.documents.find((document) => document.id === activeDocumentId) ?? null;
  const movementLocked = externalMovementLock || isTalkOpen || isMoment || Boolean(experience?.movementLocked) || Boolean(openedDocument) || notesOpen || guidance !== null;
  const preparation = stage?.preparation;
  const essential = preparation?.essentialConversations ?? [];
  // "!" over everyone still to hear from: unfinished essential conversations, and people not yet met.
  const attentionKey = [...new Set([
    ...essential.filter((conversation) => !conversation.complete).map((conversation) => conversation.characterId),
    ...view.characters.filter((character) => !view.speakers.some((speaker) => speaker.id === character.id)).map((character) => character.id),
  ])].join("|");
  // A stable array, so the map only re-renders when the set of people still to hear from changes.
  const attentionIds = useMemo(() => attentionKey ? attentionKey.split("|") : [], [attentionKey]);
  // The quest log: concrete steps from the stage's preparation, and the one to do next.
  const questKey = `${attemptId}:${stageIndex}`;
  const questMemory = useRef<{ key: string; memory: QuestMemory } | null>(null);
  if (questMemory.current?.key !== questKey) {
    questMemory.current = {
      key: questKey,
      memory: { ...emptyQuestMemory(), passedBefore: stageIndex === 0 ? [] : view.documents.filter((document) => document.readingCheck?.status === "passed").map((document) => document.id) },
    };
  }
  const quest = questPlan(view, questMemory.current.memory);
  rememberQuest(questMemory.current.memory, view, quest?.steps);
  const rawGuide = !isMoment && !isTalkOpen && !experience?.mission ? quest?.guideTarget ?? null : null;
  const guideKey = rawGuide ? `${rawGuide.kind}:${rawGuide.id}` : "";
  // A stable object, so the map only re-renders when the target itself changes.
  const guideTarget = useMemo<GuideTarget>(() => {
    if (!guideKey) return null;
    const [kind, ...id] = guideKey.split(":");
    return { kind: kind as NonNullable<GuideTarget>["kind"], id: id.join(":") };
  }, [guideKey]);
  const decisionAvailable = view.phase === "stage" && !isMoment && !experience?.hideDecision && (quest ? quest.ready : !preparation);
  // Talking folds the quest card to its one-line peek, so it never sits on the dialogue box.
  // During a defining moment it shows just the stage question, one line, under the Decision ribbon.
  const questFolded = missionCollapsed || isTalkOpen || isMoment;
  const peekable = isMoment ? Boolean(stage?.centralQuestion) : quest && !experience?.mission ? quest.next !== null : !experience?.mission;
  // Keep the next step in view inside the (scrollable) quest card, e.g. "Make your decision" below done steps.
  const questBody = useRef<HTMLDivElement>(null);
  const nextStepId = quest?.next?.id ?? null;
  useEffect(() => {
    const body = questBody.current;
    const next = body?.querySelector<HTMLElement>('[data-state="next"]');
    if (!body || !next || questFolded) return;
    const offset = next.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom;
    if (offset > -8) body.scrollTop += offset + 16;
  }, [nextStepId, questFolded]);
  const onJournalExpanded = useCallback((open: boolean) => { if (open) setMissionCollapsed(true); }, []);
  const questToasts = useQuestToasts(quest?.steps ?? null, questKey, Boolean(openedDocument) || notesOpen || guidance !== null);
  const guidanceKey = `v3.guidance:${attemptId}:${stageIndex}`;
  const spawnRoomId = view.rooms[0]?.id ?? "";
  const requestRoomEntry = useCallback((roomId: string) => new Promise<boolean>((resolve) => {
    send({ type: "enterRoom", roomId }, resolve);
  }), [send]);
  const onMapReadyChange = useCallback((ready: boolean) => {
    setMapReady(ready);
    if (!ready) setNearbyId(null);
  }, []);
  const messages = useMemo(
    () => openCharacter ? talkLines(view.messages, view.currentRoomId, openCharacter.id, seenAtTalkOpen.current) : [],
    [openCharacter, view.currentRoomId, view.messages],
  );
  const storyToasts = useStoryToasts(view.messages, view.phase === "stage" && !isMoment && !isTalkOpen);
  const stanceShifts = useStanceShifts(view.characters);
  const dialogueMessages = useMemo(() => messages.map((item) => ({
    ...item,
    speaker: item.kind === "player"
      ? "You"
      : item.kind === "thought"
        ? "Your thought"
        : item.kind === "narration"
          ? "Meanwhile"
          : item.kind === "notice"
            ? ""
            : item.characterId === null
        ? "Story"
        : view.characters.find((character) => character.id === item.characterId)?.name ?? "Character",
    insertedNoteText: item.insertedNoteId
      ? view.notes.find((note) => note.id === item.insertedNoteId)?.text ?? "Note shared"
      : null,
  })), [messages, view.characters, view.notes]);
  const nearbyCharacter = nearbyId
    ? view.characters.find((character) => character.id === nearbyId) ?? null
    : null;

  const openTalk = useCallback((id: string) => {
    const character = view.characters.find((character) => character.id === id);
    if (view.definingMoment !== null || !character) return;
    if (character.preparation && !character.preparation.ready) {
      setGuidance({ type: "character", characterId: id });
      return;
    }
    talkingRoomId.current = view.currentRoomId;
    seenAtTalkOpen.current = new Set(view.messages.map((message) => message.id));
    setCharacterId(id);
    setTalkingTo(id);
  }, [view.characters, view.currentRoomId, view.definingMoment, view.messages]);

  const closeTalk = useCallback(() => {
    setTalkingTo(null);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => mapSection.current?.querySelector("canvas")?.focus());
    }
  }, []);

  useEffect(() => {
    if (talkingTo === null) return;
    if (
      view.definingMoment !== null ||
      view.currentRoomId !== talkingRoomId.current ||
      !view.characters.some((character) => character.id === talkingTo)
    ) {
      setTalkingTo(null);
    }
  }, [talkingTo, view.characters, view.currentRoomId, view.definingMoment]);

  useEffect(() => {
    setNow(Date.now());
    // Phones have no E key, and the mission panel would cover a third of the map: start it folded.
    setTouch(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false);
    if (window.innerWidth < 640) setMissionCollapsed(true);
  }, []);

  useEffect(() => {
    if (!view.timer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [view.timer]);

  const remaining = preparation?.timerExpired ? 0 : view.timer && now !== null ? new Date(view.timer.endsAt).getTime() - now : null;

  const closeGuidance = useCallback(() => {
    if (guidance?.type === "timer" || guidance?.type === "ready") {
      const types = guidance.type === "timer" && preparation?.ready ? ["timer", "ready"] : [guidance.type];
      for (const type of types) {
        const key = `${guidanceKey}:${type}`;
        seenGuidance.current.add(key);
        rememberGuidance(key);
      }
    }
    setGuidance(null);
  }, [guidance, guidanceKey, preparation?.ready]);

  useEffect(() => {
    if (!preparation || isMoment || isTalkOpen || openedDocument || notesOpen || guidance || externalMovementLock || experience?.movementLocked || experience?.hideDecision || busy) return;
    const candidates = [preparation.timerExpired ? "timer" : null, preparation.ready ? "ready" : null] as const;
    const type = candidates.find((candidate) => candidate && !seenGuidance.current.has(`${guidanceKey}:${candidate}`) && !guidanceWasSeen(`${guidanceKey}:${candidate}`));
    if (!type) return;
    // A map landmark can own a dialog too. Wait for it without stealing focus.
    const showWhenClear = () => {
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return false;
      setGuidance({ type });
      return true;
    };
    if (showWhenClear()) return;
    const pending = window.setInterval(() => { if (showWhenClear()) window.clearInterval(pending); }, 250);
    return () => window.clearInterval(pending);
  }, [busy, experience?.hideDecision, experience?.movementLocked, externalMovementLock, guidance, guidanceKey, isMoment, isTalkOpen, notesOpen, openedDocument, preparation]);
  const openDocument = useCallback((id: string) => {
    setDocumentId(id);
    send({ type: "openDocument", documentId: id });
  }, [send]);

  const canActivateStep = (step: QuestStep) => step.kind === "decide"
    ? decisionAvailable
    : step.target !== null || step.documentId !== null;
  const activateStep = (step: QuestStep) => {
    if (step.kind === "decide") { if (decisionAvailable) setGuidance({ type: "confirm" }); return; }
    if (step.target?.kind === "character") openTalk(step.target.id);
    else if (step.target?.kind === "document") openDocument(step.target.id);
    else if (step.documentId) openDocument(step.documentId);
    else if (step.target?.kind === "room") setWalkTo(step.target.id);
  };

  function openJournalTab(tab: "notes" | "documents" | "log") {
    if (isTalkOpen && tab === "notes") setNotesOpen(true);
    else {
      if (isTalkOpen) closeTalk();
      setIslandRequest({ tab, key: Date.now() });
    }
  }

  function closeDocument() {
    if (openedDocument) send({ type: "closeDocument", documentId: openedDocument.id });
    setDocumentId(null);
  }

  return (
    <>
      {experience?.overlay}
      <div className={`${styles.game} flex min-h-0 min-w-0 flex-1 flex-col`}>
        <section
          ref={mapSection}
          className="relative min-h-0 min-w-0 flex-1 bg-sunken"
          aria-label="Map"
        >
          {stage && view.rooms.length > 0 ? (
            <V3Map
              key={`${attemptId}:${stageId}:${experience?.scenery?.authored?.map.id ?? "default"}`}
              attemptId={attemptId}
              crowdContext={`${stage.timePlace} ${stage.title} ${stage.centralQuestion}`}
              stageId={stageId}
              stageIndex={stageIndex}
              scenery={experience?.scenery ?? scenery}
              destination={experience?.destination}
              onArrive={experience?.onArrive}
              onInspectLandmark={experience?.onInspect}
              rooms={view.rooms}
              spawnRoomId={spawnRoomId}
              currentRoomId={view.currentRoomId}
              characters={view.characters}
              documents={view.documentsHere}
              walkTo={walkTo}
              movementLocked={movementLocked}
              onWalkDone={() => setWalkTo(null)}
              onEnterRoom={requestRoomEntry}
              onSelectCharacter={isMoment ? () => {} : openTalk}
              onTalk={openTalk}
              onNearbyCharacterChange={setNearbyId}
              onOpenDocument={openDocument}
              ambient={ambient}
              audio={audio}
              onReadyChange={onMapReadyChange}
              attentionIds={attentionIds}
              guideTarget={guideTarget}
            />
          ) : null}

          {/* Bottom centre: first-time controls hint above the talk prompt, or the decision call to action. */}
          <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 flex w-max max-w-[calc(100%_-_1rem)] -translate-x-1/2 flex-col items-center gap-2 sm:bottom-24">
            {stageIndex === 0 && !isMoment ? (
              <ControlsCoachMark
                storageKey={`v3.coach:${attemptId}`}
                touch={touch}
                active={mapReady && !movementLocked && view.phase === "stage"}
                mapRoot={mapSection}
                roomId={view.currentRoomId}
              />
            ) : null}
            {!isMoment && !isTalkOpen && mapReady && nearbyCharacter && !notesOpen && !openedDocument && !guidance ? (
              <button
                type="button"
                onClick={() => openTalk(nearbyCharacter.id)}
                className={`${pixelFont.className} pointer-events-auto w-max max-w-[min(24rem,calc(100vw_-_1rem))] rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] px-5 py-2.5 text-base font-bold text-[#1f2433] shadow-[0_5px_0_rgb(31_36_51/0.55)] hover:bg-white active:translate-y-[2px] sm:text-lg`}
              >
                <span className="mr-2 inline-grid min-w-7 place-items-center rounded-md border-2 border-[#1f2433] bg-[#ffe66d] px-1.5 text-sm" aria-hidden>{touch ? "Tap" : "E"}</span>
                <span className="sr-only">{touch ? "Tap to talk to" : "Press E to talk to"} </span>
                <span aria-hidden>Talk to </span>{nearbyCharacter.name}
                {nearbyCharacter.preparation && !nearbyCharacter.preparation.ready ? (() => {
                  const prerequisite = parsePreparationHint(nearbyCharacter.preparation.hint, view);
                  const reason = prerequisite?.kind === "read" ? `Read “${prerequisite.title}” first` : nearbyCharacter.preparation.hint ?? "Find more evidence first";
                  return <span className="mt-1 flex items-center justify-center gap-1.5 font-sans text-xs font-semibold text-[#5f5545]"><Lock size={12} aria-hidden /><span className="sr-only">Locked: </span>{reason}</span>;
                })() : null}
              </button>
            ) : decisionAvailable && !isTalkOpen && mapReady && !notesOpen && !openedDocument && !guidance ? (
              <DecisionCallToAction
                label={preparation ? "You’re ready — make your decision" : "Ready? Make your decision"}
                disabled={busy}
                onClick={() => setGuidance({ type: "confirm" })}
              />
            ) : null}
          </div>

          {view.definingMoment ? (
            <DialogueBox
              mode="moment"
              moment={view.definingMoment}
              decider={view.characters.find((character) => character.id === view.definingMoment?.deciderId)}
              portraitBase={portraitBase}
              busy={busy}
              onAct={(actId) => send({ type: "act", actId })}
              onPredict={(outcomeId) => send({ type: "predict", outcomeId })}
            />
          ) : openCharacter ? (
            <DialogueBox
              key={openCharacter.id}
              mode="talk"
              character={openCharacter}
              portraitBase={portraitBase}
              messages={dialogueMessages}
              busy={busy}
              stanceShift={stanceShifts.get(openCharacter.id) ?? null}
              onSend={(text, onSettled) => {
                if (characterId) send({ type: "message", characterId, text }, onSettled);
                else onSettled(false);
              }}
              onOpenNotes={() => setNotesOpen(true)}
              onClose={closeTalk}
            />
          ) : null}

          {/* Top left: where and when. */}
          {stage ? (
            <div className={`pointer-events-none absolute left-2 top-2 z-10 sm:left-4 sm:right-auto sm:top-4 sm:max-w-[min(26rem,calc(100%-24rem))] ${isMoment ? "right-[11.5rem]" : "right-2"}`}>
              <div data-map-chrome className="pointer-events-auto max-w-full"><StagePill index={stage.index} timePlace={stage.timePlace} title={stage.title} /></div>
            </div>
          ) : null}

          {/* Top right: the main quest. Folded to one line on phones, while talking, and when the Journal opens. */}
          {stage ? (
            <section
              aria-label="Mission"
              data-folded={questFolded || undefined}
              className={`${questStyles.card} pointer-events-auto absolute left-2 right-2 top-[3.1rem] z-10 sm:left-auto sm:right-4 sm:w-[min(20rem,calc(100vw-2rem))] ${isMoment ? "sm:top-[6.5rem]" : "sm:top-4"}`}
              data-moment={isMoment || undefined}
            >
              <header className="flex items-center gap-1.5">
                {questFolded && peekable && !isMoment ? null : <span className={questStyles.cardStar} aria-hidden><Star size={13} strokeWidth={2.5} fill="currentColor" /></span>}
                <h2 className={`${pixelFont.className} ${questStyles.cardTitle} ${questFolded && peekable ? "sr-only" : "mr-auto"}`}>Main quest</h2>
                {questFolded && peekable ? (
                  <div className="min-w-0 flex-1">
                    {isMoment
                      ? <p className="line-clamp-2 text-[14px] font-bold leading-snug">{stage.centralQuestion}</p>
                      : quest && !experience?.mission
                      ? <QuestPeek next={quest.next} canActivate={canActivateStep} onActivate={activateStep} disabled={busy || isTalkOpen} />
                      : <MissionFocus key={`${attemptId}:${stageIndex}`} view={view} collapsed showNextStep={!experience?.mission} onOpenDocument={openDocument} onOpenJournal={openJournalTab} />}
                  </div>
                ) : null}
                {preparation && !questFolded ? <button type="button" disabled={isTalkOpen || externalMovementLock} aria-label="Help with this stage" aria-haspopup="dialog" onClick={() => setGuidance({ type: "help" })} className="grid min-h-9 min-w-9 place-items-center rounded-md hover:bg-[#1f2433]/10 disabled:opacity-50"><CircleHelp size={18} aria-hidden /></button> : null}
                {view.timer ? (
                  <span aria-label="Time remaining" className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#1f2433]/35 bg-white/70 px-2 py-1 font-mono text-xs font-bold">
                    <Timer size={14} aria-hidden />
                    {remaining === null ? "--:--" : formatTime(remaining)}
                  </span>
                ) : null}
                {isMoment ? null : <button
                  type="button"
                  aria-expanded={!questFolded}
                  aria-label={questFolded ? "Show mission" : "Hide mission"}
                  disabled={isTalkOpen}
                  onClick={() => setMissionCollapsed(!questFolded)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-[#1f2433]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf] disabled:opacity-40"
                >
                  <ChevronDown size={18} aria-hidden className={`transition-transform motion-reduce:transition-none ${questFolded ? "" : "rotate-180"}`} />
                </button>}
              </header>
              {quest && !experience?.mission && !isMoment ? <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{quest.next ? `Next step: ${quest.next.text}${quest.next.where ? `. ${quest.next.where}` : ""}` : ""}</p> : null}

              <div ref={questBody} hidden={questFolded} className={questStyles.cardBody}>
                {experience?.mission}
                {stage?.centralQuestion && !experience?.mission ? (
                  <p className={questStyles.question}>{stage.centralQuestion}</p>
                ) : null}
                {isMoment ? null : quest && !experience?.mission ? (
                  <div className="mt-2 border-t-2 border-dashed border-[#d9c7a0] pt-2">
                    <QuestSteps steps={quest.steps} next={quest.next} canActivate={canActivateStep} onActivate={activateStep} disabled={busy || isTalkOpen} />
                  </div>
                ) : (
                  <div className="mt-2">
                    <MissionFocus key={`${attemptId}:${stageIndex}`} view={view} collapsed={false} showNextStep={!experience?.mission} onOpenDocument={openDocument} onOpenJournal={openJournalTab} />
                  </div>
                )}
                {isMoment ? null : <div className="mt-2 space-y-2 empty:hidden">
                  {experience?.hideDecision || (quest && !experience?.mission) ? null : preparation ? (
                    <button type="button" disabled={busy || isTalkOpen} onClick={() => setGuidance({ type: preparation.ready ? "confirm" : "decision" })} aria-haspopup="dialog" className={`${styles.primary} min-h-11 px-3 text-xs font-black disabled:opacity-50`}>Make your decision</button>
                  ) : confirmEndStage ? (
                    <div role="alert" className="space-y-2">
                      <p className="text-xs font-bold">{experience?.decisionHint ?? "You won’t be able to explore after this."}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmEndStage(false)}
                          className="min-h-9 rounded-md border border-[#101522] bg-[#1f2433] px-3 text-xs font-bold text-[#fffaf0] shadow-[0_2px_0_#101522] hover:bg-[#343c50] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf] disabled:opacity-50"
                        >
                          Keep exploring
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setConfirmEndStage(false);
                            send({ type: "endStage" });
                          }}
                          className={`${styles.primary} min-h-8 px-2 text-xs font-black disabled:opacity-50`}
                        >
                          Continue to decision
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmEndStage(true)}
                      className={`${styles.primary} min-h-8 px-3 text-xs font-black disabled:opacity-50`}
                    >
                      I&apos;m ready to decide
                    </button>
                  )}
                  {!mapReady ? (
                    <label className="flex flex-col gap-1 border-t border-[#1f2433]/20 pt-2 text-[11px] font-black uppercase tracking-wide">
                      Walk to
                      <select
                        aria-label="Walk to"
                        value={view.currentRoomId ?? ""}
                        disabled={busy || movementLocked || view.rooms.length < 2}
                        onChange={(event) => {
                          if (event.target.value) send({ type: "enterRoom", roomId: event.target.value });
                        }}
                        className="min-h-9 w-full rounded-md border border-[#1f2433]/35 bg-white px-2 text-sm font-medium normal-case tracking-normal text-[#1f2433]"
                      >
                        {view.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>}
              </div>
            </section>
          ) : null}

          {/* Bottom right: role brief, sound and the Journal. During a decision they move to the top right. */}
          {!isTalkOpen ? (
            <div data-map-chrome className={`absolute z-30 flex gap-2 ${isMoment ? "right-2 top-2 items-start sm:right-4 sm:top-4" : "bottom-2 right-2 items-end sm:bottom-4 sm:right-4"}`}>
              {hud}
              <StageIsland
                view={view}
                opens={isMoment ? "down" : "up"}
                onExpandedChange={onJournalExpanded}
                onOpenDocument={openDocument}
                onOpenRoleBrief={onOpenRoleBrief}
                definingMoment={isMoment}
                pulseKey={view.notes.at(-1)?.id ?? null}
                openRequest={islandRequest}
                onOpenRequestHandled={acknowledgeIslandRequest}
                shortcutsLocked={externalMovementLock || guidance !== null || Boolean(experience?.movementLocked)}
              />
            </div>
          ) : null}
        </section>
      </div>

      {guidance ? <StagePreparationGuidance
        guidance={guidance}
        view={view}
        busy={busy}
        decisionHint={experience?.decisionHint}
        steps={quest?.steps}
        next={quest?.next ?? null}
        onClose={closeGuidance}
        onReview={() => { closeGuidance(); setGuidance({ type: "confirm" }); }}
        onDecide={() => { closeGuidance(); send({ type: "endStage" }); }}
      /> : null}

      {notesOpen ? (
        <V3CardDialog
          kind="notes"
          title="Your notes"
          eyebrow="From your travels"
          footerText="A record of your discoveries"
          closeLabel="Close notes"
          onClose={() => setNotesOpen(false)}
        >
          <NotesPanel
            notes={view.notes}
            busy={busy}
            selectedCharacterName={isTalkOpen ? openCharacter.name : null}
            onInsert={(noteId) => {
              if (!isTalkOpen || !openCharacter || characterId !== openCharacter.id) return;
              submitV3NoteInsert(characterId, noteId, undefined, send, () => setNotesOpen(false));
            }}
          />
        </V3CardDialog>
      ) : null}

      {questToasts.current || storyToasts.current || pickup.current || (sourceArrival.current && !openedDocument) ? (
        <ToastStack
          placement={isTalkOpen || isMoment ? "top" : "bottom"}
          stamp={[questToasts.current?.id, storyToasts.current?.id, pickup.current?.id, sourceArrival.current?.id].join("|")}
        >
          {questToasts.current ? <QuestToast inline key={questToasts.current.id} text={questToasts.current.text} /> : null}
          {storyToasts.current ? (
            <StoryToast
              inline
              key={storyToasts.current.id}
              message={storyToasts.current}
              characters={view.characters}
              shift={storyToasts.current.characterId ? stanceShifts.get(storyToasts.current.characterId) ?? null : null}
              onDismiss={storyToasts.dismiss}
            />
          ) : null}
          {pickup.current ? (
            <PocketToast
              inline
              key={pickup.current.id}
              tone="note"
              kicker={`New note · ${pickup.current.source === "document" ? "from a source" : "from a conversation"}`}
              text={pickup.current.text}
              icon={<NotesGlyph size={26} />}
              actionLabel="Open notes"
              onActivate={() => {
                pickup.dismiss();
                if (openedDocument) closeDocument();
                if (isTalkOpen) setNotesOpen(true);
                else setIslandRequest({ tab: "notes", key: Date.now() });
              }}
            />
          ) : sourceArrival.current && !openedDocument ? (
            <PocketToast
              inline
              key={sourceArrival.current.id}
              tone="source"
              kicker="New source collected"
              text={documentDisplayTitle(sourceArrival.current.title)}
              icon={<ScrollText size={22} aria-hidden />}
              actionLabel="Read it"
              onActivate={() => {
                const id = sourceArrival.current?.id;
                sourceArrival.dismiss();
                if (id) openDocument(id);
              }}
            />
          ) : null}
        </ToastStack>
      ) : null}

      {openedDocument ? (
        <DocumentReader
          supplement={experience?.documentSupplement?.(openedDocument)}
          readingHint={experience?.documentHint}
          document={openedDocument}
          documents={view.documents}
          onSelectDocument={openDocument}
          onClose={closeDocument}
          noteCount={view.notes.length}
          hasDocumentNote={view.notes.some((note) => note.source === "document")}
          busy={busy}
          onContinueReadingCheck={!isMoment ? (questionId, onSettled) => send({ type: "continueReadingCheck", documentId: openedDocument.id, questionId }, onSettled) : undefined}
          {...(!isMoment ? { onSubmitReadingCheck: (submission: import("./reading-check").ReadingCheckSubmission, onSettled: (succeeded: boolean) => void) => send({ type: "submitReadingCheck", documentId: openedDocument.id, ...submission }, onSettled) } : {})}
          {...(openedDocument && !isMoment
            ? {
                onSelectPassage: (start: number, end: number, onSettled: (succeeded: boolean) => void) =>
                  send(v3SelectPassageAction(openedDocument.id, start, end), onSettled),
              }
            : {})}
        />
      ) : null}
    </>
  );
}
