"use client";
import type { ReactNode } from "react";
import type { Point } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import { Check, ChevronDown, Circle, CircleHelp, Timer } from "lucide-react";
import type { Action, PlayerView, DocumentView } from "@adventure/play-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import { DialogueBox } from "@/components/play/v3/dialogue-box";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { NotePickup, useNotePickups } from "@/components/play/v3/note-pickup";
import { NotesPanel } from "@/components/play/v3/notes-panel";
import { StoryToast, talkLines, useStanceShifts, useStoryToasts } from "@/components/play/v3/story-lines";
import { MissionFocus } from "./mission-focus";
import { StageIsland } from "@/components/play/v3/stage-island";
import { V3CardDialog } from "./card-dialog";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import { V3Map } from "@/components/play/v3/v3-map";
import { guidanceWasSeen, rememberGuidance } from "./preparation-dialog";
import { PreparationProgress } from "./preparation-progress";
import { StagePreparationGuidance, type StageGuidance } from "./stage-preparation-guidance";

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

export function StagePlayScreen({ view, busy, send, portraitBase = null, attemptId, scenery, movementLocked: externalMovementLock = false, ambient = { id: "clear", intensity: 1 }, audio = { muted: true, cues: [] }, onOpenRoleBrief, experience }: {
  experience?: StageExperience;
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
  const completedConversations = essential.filter((conversation) => conversation.complete).length;
  const stepsLeft = preparation ? (preparation.timerExpired ? 0 : Math.max(0, preparation.required - preparation.completed)) + essential.length - completedConversations : 0;
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
  const timerExpired = preparation ? preparation.timerExpired : remaining !== null && remaining <= 0;

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
    if (isMoment || isTalkOpen || openedDocument || notesOpen || guidance || externalMovementLock || experience?.movementLocked || experience?.hideDecision || busy) return;
    const candidates = [timerExpired ? "timer" : null, preparation?.ready ? "ready" : null] as const;
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
  }, [busy, experience?.hideDecision, experience?.movementLocked, externalMovementLock, guidance, guidanceKey, isMoment, isTalkOpen, notesOpen, openedDocument, preparation, timerExpired]);
  const openDocument = useCallback((id: string) => {
    setDocumentId(id);
    send({ type: "openDocument", documentId: id });
  }, [send]);

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
            />
          ) : null}

          {!isTalkOpen ? (
            <StageIsland
              view={view}
              onOpenDocument={openDocument}
              onOpenRoleBrief={onOpenRoleBrief}
              definingMoment={isMoment}
              pulseKey={view.notes.at(-1)?.id ?? null}
              openRequest={islandRequest}
              onOpenRequestHandled={acknowledgeIslandRequest}
              shortcutsLocked={externalMovementLock || guidance !== null || Boolean(experience?.movementLocked)}
            />
          ) : null}

          {!isMoment && !isTalkOpen && mapReady && nearbyCharacter && !notesOpen && !openedDocument && !guidance ? (
            <button
              type="button"
              onClick={() => openTalk(nearbyCharacter.id)}
              className="absolute bottom-24 left-1/2 z-10 w-max max-w-[min(22rem,calc(100%_-_1rem))] -translate-x-1/2 sm:bottom-3 rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] px-4 py-2 text-sm font-black text-[#1f2433] shadow-[3px_3px_0_#1f2433]"
            >
              {touch ? "Tap to talk to" : "Press E to talk to"} {nearbyCharacter.name}
              {nearbyCharacter.preparation && !nearbyCharacter.preparation.ready ? <PreparationProgress label="Preparation" completed={nearbyCharacter.preparation.completed} required={nearbyCharacter.preparation.required} /> : null}
              {nearbyCharacter.preparation && !nearbyCharacter.preparation.ready && nearbyCharacter.preparation.hint ? <span className="mt-1 block text-xs font-semibold">{nearbyCharacter.preparation.hint}</span> : null}
            </button>
          ) : null}

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

        <section
          aria-label="Mission"
          className="absolute right-2 top-2 z-10 w-[min(20rem,calc(100%_-_1rem))] rounded-xl border-[3px] border-[#1f2433] bg-[#fffaf0] p-3 text-[#1f2433] shadow-[3px_3px_0_#1f2433] sm:right-4 sm:top-4"
        >
          <header className="flex items-center gap-2">
            <h2 className="mr-auto text-xs font-black uppercase tracking-[0.14em]">Mission</h2>
            {preparation && !isMoment ? <button type="button" disabled={isTalkOpen || externalMovementLock} aria-label="Help with this stage" aria-haspopup="dialog" onClick={() => setGuidance({ type: "help" })} className="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-[#1f2433]/10 disabled:opacity-50"><CircleHelp size={19} aria-hidden /></button> : null}
            {view.timer ? (
              <span aria-label="Time remaining" className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#1f2433]/35 bg-white/70 px-2 py-1 font-mono text-xs font-bold">
                <Timer size={14} aria-hidden />
                {remaining === null ? "--:--" : formatTime(remaining)}
              </span>
            ) : null}
            <button
              type="button"
              aria-expanded={!missionCollapsed}
              aria-label={missionCollapsed ? "Show mission" : "Hide mission"}
              onClick={() => setMissionCollapsed((collapsed) => !collapsed)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-[#1f2433]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf]"
            >
              <ChevronDown
                size={16}
                aria-hidden
                className={`transition-transform ${missionCollapsed ? "-rotate-90" : "rotate-180"}`}
              />
            </button>
          </header>

          <div className={`${missionCollapsed ? "mt-1" : "mt-2"} flex flex-col gap-2`}>
            <div hidden={missionCollapsed}>
              {experience?.mission}
              {stage?.centralQuestion && !experience?.mission ? (
                <p className="text-sm font-semibold leading-snug">{stage.centralQuestion}</p>
              ) : null}
            </div>
            <MissionFocus key={`${attemptId}:${stageIndex}`} view={view} collapsed={missionCollapsed} showNextStep={!experience?.mission} onOpenDocument={openDocument} onOpenJournal={(tab) => {
              if (isTalkOpen && tab === "notes") setNotesOpen(true);
              else {
                if (isTalkOpen) closeTalk();
                setIslandRequest({ tab, key: Date.now() });
              }
            }} />
            <div hidden={missionCollapsed} className="space-y-2">
              {!isMoment ? (
                <>
                  <p className="text-xs text-[#5c6472]">
                    You are in {view.rooms.find((room) => room.id === view.currentRoomId)?.name ?? "an unknown room"}
                  </p>
                  {preparation ? <div className="space-y-1 text-xs" role="status" aria-live="polite">
                    <PreparationProgress label="Evidence preparation" completed={preparation.completed} required={preparation.required} />
                    <PreparationProgress label="Essential conversations" completed={completedConversations} required={essential.length} />
                    {essential.length ? <ul aria-label="Essential conversations" className="space-y-0.5">{essential.map((conversation) => <li key={conversation.characterId} className="flex items-center gap-1.5">{conversation.complete ? <Check size={13} aria-hidden /> : <Circle size={11} aria-hidden />}<span className={conversation.complete ? "text-[#5c6472] line-through" : ""}>Speak with {conversation.name}</span><span className="sr-only">{conversation.complete ? ": conversation complete" : ": conversation still needed"}</span></li>)}</ul> : null}
                  </div> : null}
                  {experience?.hideDecision ? null : preparation ? (
                    <button type="button" disabled={busy || isTalkOpen} onClick={() => setGuidance({ type: preparation.ready ? "confirm" : "decision" })} aria-haspopup="dialog" className={preparation.ready ? `${styles.primary} min-h-11 px-3 text-xs font-black disabled:opacity-50` : "min-h-11 rounded-md border-2 border-dashed border-[#1f2433]/45 bg-[#1f2433]/5 px-3 text-xs font-black text-[#5c6472] disabled:opacity-50"}>Review stage decision{preparation.ready ? null : ` (${stepsLeft} ${stepsLeft === 1 ? "step" : "steps"} left)`}</button>
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
                </>
              ) : null}
            </div>
          </div>
        </section>
        </section>
      </div>

      {guidance ? <StagePreparationGuidance
        guidance={guidance}
        view={view}
        busy={busy}
        decisionHint={experience?.decisionHint}
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

      {storyToasts.current ? (
        <StoryToast
          key={storyToasts.current.id}
          message={storyToasts.current}
          characters={view.characters}
          shift={storyToasts.current.characterId ? stanceShifts.get(storyToasts.current.characterId) ?? null : null}
          onDismiss={storyToasts.dismiss}
        />
      ) : null}
      {pickup.current ? (
        <NotePickup
          key={pickup.current.id}
          note={pickup.current}
          onOpen={() => {
            pickup.dismiss();
            if (openedDocument) closeDocument();
            if (isTalkOpen) setNotesOpen(true);
            else setIslandRequest({ tab: "notes", key: Date.now() });
          }}
        />
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
