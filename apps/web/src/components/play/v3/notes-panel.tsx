"use client";

import type { NoteView } from "@adventure/play-contract";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "@/components/play/document-reader.module.css";

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
    groups.length === 0 ? (
      <div className={styles.loading}>
        <ScrollText size={44} aria-hidden="true" />
        <p>No notes yet.</p>
        <p className={styles.hint}>Talk to people and read documents. What you learn is saved here.</p>
      </div>
    ) : (
      <div className="space-y-6">
        {groups.map(([stageIndex, stageNotes]) => (
          <section key={stageIndex}>
            <p className={styles.eyebrow}>Stage {stageIndex + 1}</p>
            <div className="mt-4 space-y-6">
              {stageNotes.map((note) => (
                <article key={note.id} className="border-b border-line pb-6 last:border-0">
                  <p className={styles.eyebrow}>{note.source === "document" ? "From the historical record" : "From a conversation"}</p>
                  <p className={`${styles.text} mt-3`}>{note.text}</p>
                  <label className={`${styles.hint} mt-4 block font-semibold`} htmlFor={`note-comment-${note.id}`}>
                    Optional comment for {selectedCharacterName ?? "a character"}
                  </label>
                  <textarea
                    id={`note-comment-${note.id}`}
                    value={comments[note.id] ?? ""}
                    maxLength={500}
                    rows={2}
                    onChange={(event) => setComments((current) => ({ ...current, [note.id]: event.target.value }))}
                    className={`${styles.select} mt-2 resize-y`}
                  />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className={styles.hint}>{(comments[note.id] ?? "").length}/500</span>
                    <button
                      type="button"
                      disabled={busy || !selectedCharacterName}
                      onClick={() => onInsert(note.id, comments[note.id]?.trim() || undefined)}
                      className={`${styles.button} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      Insert into chat
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  );
}
