"use client";

import type { DocumentView } from "@adventure/play-contract";
import { Check, Highlighter, ScrollText } from "lucide-react";
import { useRef, useState } from "react";

import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import styles from "@/components/play/document-reader.module.css";
import { offsetsFromParagraphs } from "@/lib/play/v3/passage-offsets";

function endpointFor(container: HTMLElement, node: Node, offset: number) {
  const paragraphs = Array.from(container.querySelectorAll<HTMLParagraphElement>("[data-document-paragraph]"));
  const index = paragraphs.findIndex((paragraph) => paragraph === node || paragraph.contains(node));
  if (index < 0) return null;
  const range = document.createRange();
  range.selectNodeContents(paragraphs[index]);
  range.setEnd(node, offset);
  return { paragraph: index, offset: range.toString().length };
}

export function selectionOffsets(container: HTMLElement, range: Range) {
  const paragraphs = Array.from(container.querySelectorAll<HTMLParagraphElement>("[data-document-paragraph]"));
  const start = endpointFor(container, range.startContainer, range.startOffset);
  const end = endpointFor(container, range.endContainer, range.endOffset);
  if (!start || !end) return null;
  return offsetsFromParagraphs(paragraphs.map((paragraph) => paragraph.textContent ?? ""), start, end);
}

export type PassageCheck = { documentId: string; notesBefore: number; settled: boolean; succeeded: boolean };
export type PassageStatus = "checking" | "added" | "nothing" | null;

export function passageStatus(check: PassageCheck | null, documentId: string | null, noteCount: number): PassageStatus {
  if (!check || check.documentId !== documentId) return null;
  if (!check.settled) return "checking";
  if (!check.succeeded) return null;
  return noteCount > check.notesBefore ? "added" : "nothing";
}

const PASSAGE_MESSAGES: Record<Exclude<PassageStatus, null>, string> = {
  checking: "Checking your highlight…",
  added: "Added to your notes.",
  nothing: "No new note added. This evidence may already be in your notes, or try another passage.",
};

function PassageHint({ canSelect, firstTime, status }: { canSelect: boolean; firstTime: boolean; status: PassageStatus }) {
  if (!canSelect) return <p className={styles.passageHint}>You can re-read this, but it&apos;s time to decide now.</p>;
  if (status) {
    return (
      <p className={`${styles.passageHint} ${status === "added" ? styles.passageAdded : ""}`} role="status">
        {status === "added" ? <Check size={17} aria-hidden="true" /> : <Highlighter size={17} aria-hidden="true" />}
        {PASSAGE_MESSAGES[status]}
      </p>
    );
  }
  return (
    <p className={`${styles.passageHint} ${firstTime ? styles.passageTip : ""}`} role="status">
      <Highlighter size={17} aria-hidden="true" />
      {firstTime
        ? "Tip: drag across the line that matters to save it as a note."
        : "Highlight the line that matters to save it as a note."}
    </p>
  );
}

export function DocumentReader({
  document,
  documents,
  onSelectDocument,
  onClose,
  onSelectPassage,
  noteCount = 0,
  hasDocumentNote = false,
}: {
  document: DocumentView | null;
  documents: DocumentView[];
  onSelectDocument: (documentId: string) => void;
  onClose: () => void;
  /** Omitted once the defining moment is open: the document can be re-read, but close reading is over. */
  onSelectPassage?: (start: number, end: number, onSettled: (succeeded: boolean) => void) => void;
  noteCount?: number;
  /** Until the student has a note from a document, the reader teaches highlighting more prominently. */
  hasDocumentNote?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState<PassageCheck | null>(null);
  const status = passageStatus(check, document?.id ?? null, noteCount);
  const index = document ? documents.findIndex((item) => item.id === document.id) : -1;
  const saved = index >= 0;

  function selectPassage() {
    const container = content.current;
    if (!document || !onSelectPassage || !container) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const offsets = selectionOffsets(container, selection.getRangeAt(0));
    if (!offsets) return;
    const sent: PassageCheck = { documentId: document.id, notesBefore: noteCount, settled: false, succeeded: false };
    setCheck(sent);
    onSelectPassage(offsets.start, offsets.end, (succeeded) => {
      setCheck((current) => (current === sent ? { ...sent, settled: true, succeeded } : current));
    });
    selection.removeAllRanges();
  }

  return (
    <V3ScrollDialog
      eyebrow={document ? (saved ? `Collected scroll ${index + 1} of ${documents.length}` : "Evidence scroll") : "Collected scrolls"}
      title={document?.title ?? "Documents"}
      kicker="From your travels"
      footerText={document ? (saved ? "Collected" : "Not collected yet") : "A record of your discoveries"}
      footerSaved={saved}
      closeLabel={document ? `Put down ${document.title}` : "Close documents"}
      buttonLabel={document ? undefined : "Continue exploring"}
      onClose={onClose}
      banner={document ? <PassageHint canSelect={Boolean(onSelectPassage)} firstTime={!hasDocumentNote} status={status} /> : undefined}
      navigation={document && saved && documents.length > 1 ? {
        items: documents.map((item) => ({ id: item.id, name: item.title })),
        selectedId: document.id,
        onSelect: onSelectDocument,
      } : undefined}
    >
      {document ? (
        <div ref={content} onMouseUp={selectPassage} onTouchEnd={selectPassage} className="select-text">
          <p data-document-paragraph="" className={styles.text}>{document.body}</p>
        </div>
      ) : (
        <div className={styles.loading}>
          <ScrollText size={44} aria-hidden="true" />
          <p>No scrolls collected yet.</p>
          <p className={styles.hint}>Walk to a document to read it. Every scroll you collect will be saved here.</p>
        </div>
      )}
    </V3ScrollDialog>
  );
}
