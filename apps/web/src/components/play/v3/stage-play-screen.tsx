"use client";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import { ChevronDown, Timer } from "lucide-react";
import type { Action, PlayerView } from "@adventure/play-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import { DialogueBox } from "@/components/play/v3/dialogue-box";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { NotePickup, useNotePickups } from "@/components/play/v3/note-pickup";
import { NotesPanel } from "@/components/play/v3/notes-panel";
import { StageIsland } from "@/components/play/v3/stage-island";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import { V3Map } from "@/components/play/v3/v3-map";

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

export function StagePlayScreen({ view, busy, send, portraitBase = null, attemptId, scenery, movementLocked: externalMovementLock = false, ambient = { id: "clear", intensity: 1 }, audio = { muted: true, cues: [] }, onOpenRoleBrief }: {
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
  const [walkTo, setWalkTo] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [missionCollapsed, setMissionCollapsed] = useState(false);
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
  const movementLocked = externalMovementLock || isTalkOpen || isMoment;
  const openedDocument = view.documents.find((document) => document.id === documentId) ?? null;
  const spawnRoomId = view.rooms[0]?.id ?? "";
  const requestRoomEntry = useCallback((roomId: string) => new Promise<boolean>((resolve) => {
    send({ type: "enterRoom", roomId }, resolve);
  }), [send]);
  const onMapReadyChange = useCallback((ready: boolean) => {
    setMapReady(ready);
    if (!ready) setNearbyId(null);
  }, []);
  const messages = useMemo(
    // The talk box shows the room's conversation only; story lines (narration, notices, thoughts) stay out of it.
    () => view.messages.filter((item) =>
      item.roomId === view.currentRoomId && (item.kind === "player" || item.kind === "character"),
    ),
    [view.currentRoomId, view.messages],
  );
  const dialogueMessages = useMemo(() => messages.map((item) => ({
    ...item,
    speaker: item.kind === "player"
      ? "You"
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
    if (view.definingMoment !== null || !view.characters.some((character) => character.id === id)) return;
    talkingRoomId.current = view.currentRoomId;
    setCharacterId(id);
    setTalkingTo(id);
  }, [view.characters, view.currentRoomId, view.definingMoment]);

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
  }, []);

  useEffect(() => {
    if (!view.timer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [view.timer]);

  const remaining = view.timer && now !== null ? new Date(view.timer.endsAt).getTime() - now : null;
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
      <div className={`${styles.game} flex min-h-0 min-w-0 flex-1 flex-col`}>
        <section
          ref={mapSection}
          className="relative min-h-0 min-w-0 flex-1 bg-sunken"
          aria-label="Map"
        >
          {stage && view.rooms.length > 0 ? (
            <V3Map
              key={`${attemptId}:${stageId}`}
              attemptId={attemptId}
              crowdContext={`${stage.timePlace} ${stage.title} ${stage.centralQuestion}`}
              stageId={stageId}
              stageIndex={stageIndex}
              scenery={scenery}
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
              pulseKey={pickup.current?.id ?? null}
              openRequest={islandRequest}
              onOpenRequestHandled={acknowledgeIslandRequest}
            />
          ) : null}

          {!isMoment && !isTalkOpen && mapReady && nearbyCharacter && !notesOpen && !openedDocument ? (
            <button
              type="button"
              onClick={() => openTalk(nearbyCharacter.id)}
              className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 sm:bottom-3 rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] px-4 py-2 text-sm font-black text-[#1f2433] shadow-[3px_3px_0_#1f2433]"
            >
              Press E to talk to {nearbyCharacter.name}
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
              onSend={(text) => {
                if (characterId) send({ type: "message", characterId, text });
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

          {!missionCollapsed ? (
            <div className="mt-2 space-y-2">
              {stage?.centralQuestion ? (
                <p className="text-sm font-semibold leading-snug">{stage.centralQuestion}</p>
              ) : null}
              {!isMoment ? (
                <>
                  <p className="text-xs text-[#5c6472]">
                    You are in {view.rooms.find((room) => room.id === view.currentRoomId)?.name ?? "an unknown room"}
                  </p>
                  {confirmEndStage ? (
                    <div role="alert" className="space-y-2">
                      <p className="text-xs font-bold">You won&apos;t be able to explore after this.</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmEndStage(false)}
                          className={`${styles.chip} min-h-8 border px-2 text-xs font-bold`}
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
          ) : null}
        </section>
        </section>
      </div>

      {notesOpen ? (
        <V3ScrollDialog
          eyebrow="Your notes"
          title="Your notes"
          kicker="From your travels"
          footerText="A record of your discoveries"
          closeLabel="Close notes"
          onClose={() => setNotesOpen(false)}
        >
          <NotesPanel
            notes={view.notes}
            busy={busy}
            selectedCharacterName={isTalkOpen ? openCharacter.name : null}
            onInsert={(noteId, text) => {
              if (!isTalkOpen || !openCharacter || characterId !== openCharacter.id) return;
              submitV3NoteInsert(characterId, noteId, text, send, () => setNotesOpen(false));
            }}
          />
        </V3ScrollDialog>
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
          document={openedDocument}
          documents={view.documents}
          onSelectDocument={openDocument}
          onClose={closeDocument}
          noteCount={view.notes.length}
          hasDocumentNote={view.notes.some((note) => note.source === "document")}
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
