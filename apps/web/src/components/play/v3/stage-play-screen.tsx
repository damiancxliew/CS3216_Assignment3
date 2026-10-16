"use client";

import { MapPin, Timer } from "lucide-react";
import type { Action, PlayerView } from "@adventure/play-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import { CharacterPortrait } from "@/components/play/v3/character-portrait";
import { DialogueBox } from "@/components/play/v3/dialogue-box";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { NotesPanel } from "@/components/play/v3/notes-panel";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
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

export function StagePlayScreen({ view, busy, send, portraitBase = null, attemptId }: {
  view: PlayerView;
  busy: boolean;
  send: (action: Action, onSettled?: (succeeded: boolean) => void) => void;
  portraitBase?: string | null;
  attemptId: string;
}) {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  const [nearbyId, setNearbyId] = useState<string | null>(null);
  const [confirmEndStage, setConfirmEndStage] = useState(false);
  const [walkTo, setWalkTo] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [emptyDocumentsOpen, setEmptyDocumentsOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(
    () => view.documents.find((document) => document.open)?.id ?? null,
  );
  const [now, setNow] = useState<number | null>(null);
  const mapSection = useRef<HTMLElement>(null);
  const talkingRoomId = useRef<string | null>(null);
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
  const movementLocked = isTalkOpen || isMoment;
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
    // Conversation is per room; story lines (narration, notices, the role's own thoughts) follow the student.
    () => view.messages.filter((item) =>
      item.roomId === view.currentRoomId || item.kind === "notice" || item.kind === "narration" || item.kind === "thought",
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
    setEmptyDocumentsOpen(false);
    send({ type: "openDocument", documentId: id });
  }, [send]);

  function openCollectedDocuments() {
    const firstDocumentId = firstV3CollectedDocumentId(view.documents);
    if (firstDocumentId) {
      openDocument(firstDocumentId);
    } else {
      setDocumentId(null);
      setEmptyDocumentsOpen(true);
    }
  }

  function closeDocument() {
    if (openedDocument) send({ type: "closeDocument", documentId: openedDocument.id });
    setDocumentId(null);
    setEmptyDocumentsOpen(false);
  }

  const chipClass = `${styles.chip} flex min-h-10 min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold`;
  const controlClass = "w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-ink outline-none";

  return (
    <>
      <div className={`${styles.game} flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row`}>
        <section
          ref={mapSection}
          className="relative h-[32dvh] min-h-[11rem] min-w-0 shrink-0 bg-sunken lg:h-auto lg:min-h-0 lg:flex-1"
          aria-label="Map"
        >
          {stage && view.rooms.length > 0 ? (
            <V3Map
              key={`${attemptId}:${stageId}`}
              attemptId={attemptId}
              stageId={stageId}
              stageIndex={stageIndex}
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
              onReadyChange={onMapReadyChange}
            />
          ) : null}

          {isMoment ? (
            <div className="absolute left-3 top-3 z-30 flex gap-2">
              <button
                type="button"
                className={`${styles.tool} flex min-h-10 items-center gap-2 px-3 text-sm font-bold`}
                onClick={openCollectedDocuments}
              >
                Documents ({view.documents.length})
              </button>
            </div>
          ) : !isTalkOpen ? (
            <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2">
              <button
                type="button"
                className={`${styles.tool} flex min-h-10 items-center gap-2 px-3 text-sm font-bold`}
                onClick={() => setNotesOpen(true)}
              >
                Notes ({view.notes.length})
              </button>
              <button
                type="button"
                className={`${styles.tool} flex min-h-10 items-center gap-2 px-3 text-sm font-bold`}
                onClick={openCollectedDocuments}
              >
                Documents ({view.documents.length})
              </button>
            </div>
          ) : null}

          {!isMoment && !isTalkOpen && mapReady && nearbyCharacter && !notesOpen && !openedDocument && !emptyDocumentsOpen ? (
            <button
              type="button"
              onClick={() => openTalk(nearbyCharacter.id)}
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] px-4 py-2 text-sm font-black text-[#1f2433] shadow-[3px_3px_0_#1f2433]"
            >
              Press E to talk to {nearbyCharacter.name}
            </button>
          ) : null}

          {view.definingMoment ? (
            <DialogueBox
              mode="moment"
              moment={view.definingMoment}
              busy={busy}
              onAct={(actId) => send({ type: "act", actId })}
              onPredict={(outcomeId) => send({ type: "predict", outcomeId })}
            />
          ) : openCharacter ? (
            <DialogueBox
              key={openCharacter.id}
              mode="talk"
              character={openCharacter}
              messages={dialogueMessages}
              busy={busy}
              onSend={(text) => {
                if (characterId) send({ type: "message", characterId, text });
              }}
              onOpenNotes={() => setNotesOpen(true)}
              onClose={closeTalk}
            />
          ) : null}
        </section>

        <aside className={`${styles.panel} flex min-h-0 w-full min-w-0 shrink-0 flex-col text-base lg:w-[min(42rem,48vw)] lg:[zoom:0.75]`}>
          <section className={`${styles.where} order-1 flex shrink-0 flex-col gap-2 px-4 py-3 sm:px-5`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 text-sm font-semibold">
                You are playing <strong>{view.briefing.name}</strong>
              </p>
              {view.pendingCheck ? (
                <span role="status" className="rounded-full bg-sunshine px-3 py-1 text-xs font-black text-ink">
                  Adding to your notes…
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={styles.locationLabel}><MapPin size={14} aria-hidden /> You are here</p>
                <h2 className="truncate text-lg font-bold">{view.rooms.find((room) => room.id === view.currentRoomId)?.name ?? "Exploring"}</h2>
              </div>
              {view.timer ? (
                <span aria-label="Time remaining" className={`${styles.chip} flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-sm font-bold`}>
                  <Timer size={16} aria-hidden />
                  {remaining === null ? "--:--" : formatTime(remaining)}
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={`${chipClass} flex-col items-start`}>
                <span className={styles.locationLabel}>Look around</span>
                <select
                  aria-label="Look around"
                  value=""
                  disabled={busy || view.documentsHere.length === 0}
                  onChange={(event) => {
                    if (event.target.value) openDocument(event.target.value);
                  }}
                  className={controlClass}
                >
                  <option value="">{view.documentsHere.length ? "Choose a document" : "No documents here"}</option>
                  {view.documentsHere.map((document) => (
                    <option key={document.id} value={document.id}>{document.title}</option>
                  ))}
                </select>
              </label>
              <label className={`${chipClass} flex-col items-start`}>
                <span className={styles.locationLabel}>Walk to</span>
                <select
                  aria-label="Walk to"
                  value={walkTo ?? view.currentRoomId ?? ""}
                  disabled={busy || movementLocked || view.rooms.length < 2}
                  onChange={(event) => {
                    const roomId = event.target.value;
                    if (mapReady) setWalkTo(roomId);
                    else send({ type: "enterRoom", roomId });
                  }}
                  className={controlClass}
                >
                  {view.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </label>
            </div>
          </section>

          {!isMoment ? (
            <section aria-labelledby="people-heading" className={`${styles.conversation} order-2 shrink-0 px-4 py-2.5 sm:px-5`}>
              <h2 id="people-heading" className="font-black">People here</h2>
              {view.characters.length ? (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {view.characters.map((character) => (
                    <CharacterPortrait
                      key={character.id}
                      name={character.name}
                      portraitKey={character.portraitKey}
                      portraitBase={portraitBase}
                      selected={character.id === characterId}
                      onSelect={() => openTalk(character.id)}
                    />
                  ))}
                </div>
              ) : <p className="mt-1 text-sm text-muted">No one is here just now. Try another room.</p>}
            </section>
          ) : null}

          {!isMoment ? (
            <section className={`${styles.quests} order-3 flex shrink-0 flex-col gap-2 px-4 py-2.5 sm:px-5`}>
              <h2 className={styles.questHeading}>Central question</h2>
              <p className="text-sm font-semibold leading-relaxed">{stage?.centralQuestion}</p>
              {confirmEndStage ? (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">You won&apos;t be able to explore after this.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => setConfirmEndStage(false)} className={`${styles.chip} min-h-10 border px-3 text-sm font-bold`}>
                      Keep exploring
                    </button>
                    <button type="button" disabled={busy} onClick={() => {
                      setConfirmEndStage(false);
                      send({ type: "endStage" });
                    }} className={`${styles.primary} min-h-10 px-3 text-sm font-black disabled:opacity-50`}>
                      Continue to decision
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmEndStage(true)} className={`${styles.primary} min-h-10 self-start px-4 text-sm font-black disabled:opacity-50`}>
                  I&apos;m ready to decide
                </button>
              )}
            </section>
          ) : null}
        </aside>
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

      {openedDocument || emptyDocumentsOpen ? (
        <DocumentReader
          document={openedDocument}
          documents={view.documents}
          onSelectDocument={openDocument}
          onClose={closeDocument}
          {...(openedDocument && !isMoment
            ? { onSelectPassage: (start: number, end: number) => send(v3SelectPassageAction(openedDocument.id, start, end)) }
            : {})}
        />
      ) : null}
    </>
  );
}
