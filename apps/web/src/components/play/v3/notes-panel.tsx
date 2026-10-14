"use client";

import type { NoteView } from "@adventure/play-contract";
import { useMemo, useState } from "react";

export function NotesPanel({
  notes,
  busy,
  selectedCharacterName,
  onInsert,
}: {
  notes: NoteView[];
  busy: boolean;
  selectedCharacterName: string | null;
  onInsert: (noteId: string, text?: string) => void;
}) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const groups = useMemo(() => {
    const byStage = new Map<number, NoteView[]>();
    for (const note of [...notes].sort((a, b) => b.stageIndex - a.stageIndex || b.at - a.at)) {
      byStage.set(note.stageIndex, [...(byStage.get(note.stageIndex) ?? []), note]);
    }
    return [...byStage.entries()].sort(([a], [b]) => b - a);
  }, [notes]);

  return (
    <section aria-labelledby="notes-heading" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="notes-heading" className="text-lg font-black text-ink">Your notes</h2>
        <span className="text-xs font-semibold text-muted">{notes.length} saved</span>
      </div>
      {groups.length === 0 ? <p className="mt-3 text-sm text-muted">Your discoveries will be collected here.</p> : (
        <div className="mt-4 space-y-4">
          {groups.map(([stageIndex, stageNotes]) => (
            <section key={stageIndex}>
              <h3 className="border-b border-line pb-1 text-xs font-black uppercase tracking-wide text-record">Stage {stageIndex + 1}</h3>
              <div className="mt-2 space-y-2">
                {stageNotes.map((note) => (
                  <details key={note.id} className="rounded-xl border border-line bg-paper p-3">
                    <summary className="cursor-pointer list-none">
                      <span className="block text-sm font-semibold leading-relaxed text-ink">{note.text}</span>
                      <span className="mt-2 inline-flex rounded-full bg-world-wash px-2 py-1 text-[11px] font-bold text-world">
                        {note.source === "conversation" ? "Conversation" : "Document"}
                      </span>
                    </summary>
                    <label className="mt-3 block text-xs font-bold text-muted" htmlFor={`note-comment-${note.id}`}>
                      Optional comment for {selectedCharacterName ?? "a character"}
                    </label>
                    <textarea
                      id={`note-comment-${note.id}`}
                      value={comments[note.id] ?? ""}
                      maxLength={500}
                      rows={2}
                      onChange={(event) => setComments((current) => ({ ...current, [note.id]: event.target.value }))}
                      className="mt-1 w-full resize-y rounded-lg border border-line-strong bg-surface p-2 text-sm text-ink"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">{(comments[note.id] ?? "").length}/500</span>
                      <button
                        type="button"
                        disabled={busy || !selectedCharacterName}
                        onClick={() => onInsert(note.id, comments[note.id]?.trim() || undefined)}
                        className="min-h-10 rounded-lg bg-record px-3 text-xs font-black text-white disabled:opacity-50"
                      >
                        Share note
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
