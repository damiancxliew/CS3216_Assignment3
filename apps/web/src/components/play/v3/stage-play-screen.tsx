"use client";

import type { Action, PlayerView } from "@adventure/play-contract";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { CharacterPortrait } from "@/components/play/v3/character-portrait";
import { DefiningMomentScreen } from "@/components/play/v3/defining-moment-screen";
import { DocumentReader } from "@/components/play/v3/document-reader";
import { NotesPanel } from "@/components/play/v3/notes-panel";

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function DocumentShelf({
  view,
  busy,
  momentOpen,
  onOpen,
}: {
  view: PlayerView;
  busy: boolean;
  momentOpen: boolean;
  onOpen: (documentId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-black text-ink">{momentOpen ? "Your documents" : "Documents here"}</h2>
      {!momentOpen ? (
        view.documentsHere.length ? (
          <ul className="mt-3 space-y-2">
            {view.documentsHere.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(document.id)}
                  className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 py-2 text-left text-sm font-bold text-ink hover:bg-record-wash disabled:opacity-50"
                >
                  {document.title}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">No documents are waiting in this room.</p>
      ) : null}
      {view.documents.length ? (
        momentOpen ? (
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
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-bold text-record">Collected documents ({view.documents.length})</summary>
            <div className="mt-2 grid gap-2">
              {view.documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(document.id)}
                  className="min-h-10 rounded-lg bg-paper px-3 text-left text-sm text-ink disabled:opacity-50"
                >
                  {document.title}
                </button>
              ))}
            </div>
          </details>
        )
      ) : (
        <p className="mt-2 text-sm text-muted">No documents have been collected.</p>
      )}
    </section>
  );
}

export function StagePlayScreen({ view, busy, send }: {
  view: PlayerView;
  busy: boolean;
  send: (action: Action) => void;
}) {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmEndStage, setConfirmEndStage] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(
    () => view.documents.find((document) => document.open)?.id ?? null,
  );
  const [now, setNow] = useState<number | null>(null);
  const [confirmMoment, setConfirmMoment] = useState(false);
  const currentCharacter = view.characters.find((character) => character.id === characterId) ?? null;
  const openedDocument = view.documents.find((document) => document.id === documentId) ?? null;
  const stage = view.stage;
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
    send({ type: "openDocument", documentId: id });
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
          {view.definingMoment === null ? (
            <span className="rounded-full bg-record-wash px-4 py-2 text-sm font-black text-record">
              {view.currentRoomId ? view.rooms.find((room) => room.id === view.currentRoomId)?.name : "Exploring"}
            </span>
          ) : null}
        </div>
        <p className="w-full rounded-xl border-l-4 border-world bg-world-wash px-4 py-3 font-semibold leading-relaxed text-ink">
          {stage?.centralQuestion}
        </p>
        {view.definingMoment === null ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            {confirmMoment ? (
              <>
                <span className="text-sm font-semibold text-muted">Talking and searching end once the moment begins.</span>
                <button type="button" disabled={busy} onClick={() => setConfirmMoment(false)}
                  className="min-h-11 rounded-xl border border-line-strong bg-paper px-4 font-bold text-ink disabled:opacity-50">
                  Not yet
                </button>
                <button type="button" disabled={busy} onClick={() => { setConfirmMoment(false); send({ type: "endStage" }); }}
                  className="min-h-11 rounded-xl bg-signal px-4 font-black text-on-signal disabled:opacity-50">
                  Begin the defining moment
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmMoment(true)}
                className="min-h-11 rounded-xl border-2 border-signal bg-surface px-4 font-black text-signal disabled:opacity-50">
                I am ready to decide
              </button>
            )}
          </div>
        ) : null}
      </header>

      {view.definingMoment === null ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
          {confirmEndStage ? (
            <>
              <p role="alert" className="font-bold text-ink">You won&apos;t be able to explore after this.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmEndStage(false)}
                  className="min-h-11 rounded-xl border border-line-strong px-4 font-bold text-ink"
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
                  className="min-h-11 rounded-xl bg-signal px-4 font-black text-white disabled:opacity-50"
                >
                  Continue to decision
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmEndStage(true)}
              className="min-h-11 rounded-xl bg-signal px-5 font-black text-white hover:brightness-110 disabled:opacity-50"
            >
              I&apos;m ready to decide
            </button>
          )}
        </section>
      ) : null}

      {view.definingMoment ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
          <DefiningMomentScreen view={view} busy={busy} send={send} />
          <aside className="grid min-w-0 gap-4">
            <DocumentShelf view={view} busy={busy} momentOpen onOpen={openDocument} />
          </aside>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
          <section className="grid min-w-0 gap-4">
            <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-ink">Who is here?</h2>
                  <p className="text-sm text-muted">Choose someone to talk with.</p>
                </div>
                {view.pendingCheck ? (
                  <span role="status" className="rounded-full bg-sunshine px-3 py-1.5 text-xs font-black text-ink">Adding to your notes…</span>
                ) : null}
              </div>
              {view.characters.length ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {view.characters.map((character) => (
                    <CharacterPortrait
                      key={character.id}
                      name={character.name}
                      portraitKey={character.portraitKey}
                      selected={character.id === characterId}
                      onSelect={() => setCharacterId(character.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-paper p-4 text-sm text-muted">No one is here just now. Try another room.</p>
              )}
              {view.rooms.length > 1 ? (
                <label className="mt-4 flex flex-wrap items-center gap-3 text-sm font-bold text-ink">
                  Move to
                  <select
                    value={view.currentRoomId ?? ""}
                    disabled={busy}
                    onChange={(event) => send({ type: "enterRoom", roomId: event.target.value })}
                    className="min-h-11 min-w-48 flex-1 rounded-lg border border-line-strong bg-paper px-3 text-ink"
                  >
                    {view.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select>
                </label>
              ) : null}
            </section>

            <section aria-labelledby="conversation-heading" className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h2 id="conversation-heading" className="font-black text-ink">Conversation</h2>
                {currentCharacter ? <span className="text-xs font-semibold text-muted">Speaking with {currentCharacter.name}</span> : null}
              </div>
              <div className="max-h-[42dvh] min-h-44 space-y-3 overflow-y-auto bg-paper/60 p-4" aria-live="polite">
                {messages.length ? messages.map((item) => (
                  <article key={item.id} className={`max-w-[92%] rounded-2xl border border-line p-3 ${
                    item.kind === "player" ? "ml-auto rounded-tr-sm bg-world-wash" :
                    item.kind === "notice" ? "mx-auto border-0 bg-record-wash text-center" :
                    item.kind === "narration" ? "mx-auto border-0 bg-sunshine/70 text-center" : "mr-auto rounded-tl-sm bg-surface"
                  }`}>
                    <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-muted">
                      {item.kind === "player" ? "You" : characterName(item.characterId)}
                    </p>
                    {item.text ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{item.text}</p> : null}
                    {item.insertedNoteId ? (
                      <blockquote className="mt-2 rounded-lg border-l-2 border-world bg-world-wash px-3 py-2 text-sm leading-relaxed text-ink">
                        {view.notes.find((note) => note.id === item.insertedNoteId)?.text ?? "Note shared"}
                      </blockquote>
                    ) : null}
                  </article>
                )) : <p className="py-9 text-center text-sm text-muted">Start the conversation when you are ready.</p>}
              </div>
              <form onSubmit={submitMessage} className="grid gap-2 border-t border-line p-4">
                <label htmlFor="v3-message" className="text-sm font-bold text-ink">
                  Ask {currentCharacter?.name ?? "someone"} a question
                </label>
                <textarea id="v3-message" value={message} maxLength={1000} rows={3} disabled={busy || !characterId}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full resize-y rounded-xl border border-line-strong bg-paper p-3 text-sm text-ink disabled:opacity-60" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">{message.length}/1000</span>
                  <button type="submit" disabled={busy || !characterId || !message.trim()}
                    className="min-h-11 rounded-xl bg-world px-5 font-black text-white disabled:opacity-50">
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            </section>
          </section>

          <aside className="grid min-w-0 gap-4">
            <DocumentShelf view={view} busy={busy} momentOpen={false} onOpen={openDocument} />
            <NotesPanel
              notes={view.notes}
              busy={busy}
              selectedCharacterName={currentCharacter?.name ?? null}
              onInsert={(noteId, text) => {
                if (!characterId) return;
                send({ type: "insertNote", characterId, noteId, ...(text ? { text } : {}) });
              }}
            />
          </aside>
        </div>
      )}
      {openedDocument ? (
        <DocumentReader
          document={openedDocument}
          onClose={() => {
            send({ type: "closeDocument", documentId: openedDocument.id });
            setDocumentId(null);
          }}
          onSelectPassage={(start, end) => send({ type: "selectPassage", documentId: openedDocument.id, start, end })}
        />
      ) : null}
    </main>
  );
}
