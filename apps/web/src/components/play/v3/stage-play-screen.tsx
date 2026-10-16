"use client";

import { MapPin, Timer } from "lucide-react";
import type { Action, PlayerView } from "@adventure/play-contract";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import { CharacterPortrait } from "@/components/play/v3/character-portrait";
import { DefiningMomentScreen } from "@/components/play/v3/defining-moment-screen";
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

function DocumentShelf({
  view,
  busy,
  onOpen,
}: {
  view: PlayerView;
  busy: boolean;
  onOpen: (documentId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-black text-ink">Your documents</h2>
      {view.documents.length ? (
        <div className="mt-3 grid gap-2">
          {view.documents.map((document) => (
            <button
              key={document.id}
              type="button"
              disabled={busy}
              onClick={() => onOpen(document.id)}
              className="min-h-11 rounded-lg bg-paper px-3 py-2 text-left text-sm font-bold text-ink hover:bg-record-wash disabled:opacity-50"
            >
              {document.title}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">No documents have been collected.</p>
      )}
    </section>
  );
}

export function StagePlayScreen({ view, busy, send, portraitBase = null, attemptId }: {
  view: PlayerView;
  busy: boolean;
  send: (action: Action, onSettled?: (succeeded: boolean) => void) => void;
  portraitBase?: string | null;
  attemptId: string;
}) {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmEndStage, setConfirmEndStage] = useState(false);
  const [walkTo, setWalkTo] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [emptyDocumentsOpen, setEmptyDocumentsOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(
    () => view.documents.find((document) => document.open)?.id ?? null,
  );
  const [now, setNow] = useState<number | null>(null);
  const currentCharacter = view.characters.find((character) => character.id === characterId) ?? null;
  const openedDocument = view.documents.find((document) => document.id === documentId) ?? null;
  const stage = view.stage;
  const stageIndex = stage?.index ?? 0;
  const stageId = `stage-${stageIndex}`;
  const spawnRoomId = view.rooms[0]?.id ?? "";
  const requestRoomEntry = useCallback((roomId: string) => new Promise<boolean>((resolve) => {
    send({ type: "enterRoom", roomId }, resolve);
  }), [send]);
  const onMapReadyChange = useCallback((ready: boolean) => setMapReady(ready), []);
  const messages = useMemo(
    // Conversation is per room; story lines (narration, notices, the role's own thoughts) follow the student.
    () => view.messages.filter((item) =>
      item.roomId === view.currentRoomId || item.kind === "notice" || item.kind === "narration" || item.kind === "thought",
    ),
    [view.currentRoomId, view.messages],
  );

  useEffect(() => {
    setCharacterId((current) => view.characters.some((character) => character.id === current)
      ? current
      : view.characters[0]?.id ?? null);
  }, [view.characters]);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!view.timer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [view.timer]);

  const remaining = view.timer && now !== null ? new Date(view.timer.endsAt).getTime() - now : null;
  const characterName = (id: string | null) =>
    id === null ? "Story" : view.characters.find((character) => character.id === id)?.name ?? "Character";

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!characterId || !message.trim() || busy) return;
    send({ type: "message", characterId, text: message.trim() });
    setMessage("");
  }

  function openDocument(id: string) {
    setDocumentId(id);
    setEmptyDocumentsOpen(false);
    send({ type: "openDocument", documentId: id });
  }

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

  if (view.definingMoment === null) {
    const chipClass = `${styles.chip} flex min-h-10 min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold`;
    const controlClass = "w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-ink outline-none";

    return (
      <>
        <div className={`${styles.game} flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row`}>
          <section
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
                onWalkDone={() => setWalkTo(null)}
                onEnterRoom={requestRoomEntry}
                onSelectCharacter={setCharacterId}
                onOpenDocument={openDocument}
                onReadyChange={onMapReadyChange}
              />
            ) : null}
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
          </section>

          <aside className={`${styles.panel} flex min-h-0 w-full min-w-0 shrink-0 flex-col text-base lg:w-[min(42rem,48vw)]`}>
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
                    disabled={busy || view.rooms.length < 2}
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

            <section aria-labelledby="conversation-heading" className={`${styles.conversation} order-2 flex min-h-0 flex-1 flex-col`}>
              <div className="shrink-0 border-b border-line px-4 py-2.5 sm:px-5">
                <h2 id="conversation-heading" className="font-black">People here</h2>
                {view.characters.length ? (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {view.characters.map((character) => (
                      <CharacterPortrait
                        key={character.id}
                        name={character.name}
                        portraitKey={character.portraitKey}
                        portraitBase={portraitBase}
                        selected={character.id === characterId}
                        onSelect={() => setCharacterId(character.id)}
                      />
                    ))}
                  </div>
                ) : <p className="mt-1 text-sm text-muted">No one is here just now. Try another room.</p>}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 sm:px-5" aria-live="polite">
                {messages.length ? messages.map((item) => (
                  <article
                    key={item.id}
                    className={`${styles.bubble} max-w-[92%] px-3 py-2.5 ${item.kind === "player" ? `${styles.myBubble} ml-auto` : "mr-auto"}`}
                  >
                    <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-muted">
                      {item.kind === "player" ? "You" : characterName(item.characterId)}
                    </p>
                    {item.text ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</p> : null}
                    {item.insertedNoteId ? (
                      <blockquote className="mt-2 border-l-2 border-world bg-world-wash px-3 py-2 text-sm leading-relaxed">
                        {view.notes.find((note) => note.id === item.insertedNoteId)?.text ?? "Note shared"}
                      </blockquote>
                    ) : null}
                  </article>
                )) : <p className="py-6 text-center text-sm text-muted">Start the conversation when you are ready.</p>}
              </div>
              <form onSubmit={submitMessage} className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-line p-3 sm:px-5">
                <label htmlFor="v3-message" className="sr-only">Ask {currentCharacter?.name ?? "someone"} a question</label>
                <input
                  id="v3-message"
                  value={message}
                  maxLength={1000}
                  disabled={busy || !characterId}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={`Ask ${currentCharacter?.name ?? "someone"} a question`}
                  className="min-h-11 min-w-0 rounded-lg border border-line-strong bg-paper px-3 text-sm text-ink disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={busy || !characterId || !message.trim()}
                  className={`${styles.primary} min-h-11 px-4 text-sm font-black disabled:opacity-50`}
                >
                  {busy ? "Sending…" : "Send"}
                </button>
              </form>
            </section>

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
              selectedCharacterName={currentCharacter?.name ?? null}
              onInsert={(noteId, text) => {
                if (!characterId) return;
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
            {...(openedDocument
              ? { onSelectPassage: (start: number, end: number) => send(v3SelectPassageAction(openedDocument.id, start, end)) }
              : {})}
          />
        ) : null}
      </>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-5 px-3 py-4 sm:px-6 sm:py-7">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-surface p-4 shadow-[0_3px_0_var(--ink)] sm:p-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-record">
            Stage {stage ? stage.index + 1 : 1}{stage ? ` of ${stage.count}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-black text-ink">{stage?.title}</h1>
          <p className="text-sm font-semibold text-muted">{stage?.timePlace}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view.timer ? (
            <span aria-label="Time remaining" className="rounded-full bg-signal-wash px-4 py-2 font-mono text-lg font-black text-signal">
              {remaining === null ? "--:--" : formatTime(remaining)}
            </span>
          ) : null}
        </div>
        <p className="w-full rounded-xl border-l-4 border-world bg-world-wash px-4 py-3 font-semibold leading-relaxed text-ink">
          {stage?.centralQuestion}
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
        <DefiningMomentScreen view={view} busy={busy} send={send} />
        <aside className="grid min-w-0 gap-4">
          <DocumentShelf view={view} busy={busy} onOpen={openDocument} />
        </aside>
      </div>
      {openedDocument ? (
        <DocumentReader
          document={openedDocument}
          documents={view.documents}
          onSelectDocument={openDocument}
          onClose={closeDocument}
        />
      ) : null}
    </main>
  );
}
