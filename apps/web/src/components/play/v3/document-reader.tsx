"use client";

import type { DocumentView } from "@adventure/play-contract";
import { ScrollText } from "lucide-react";
import { useRef } from "react";

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

export function DocumentReader({
  document,
  documents,
  onSelectDocument,
  onClose,
  onSelectPassage,
}: {
  document: DocumentView | null;
  documents: DocumentView[];
  onSelectDocument: (documentId: string) => void;
  onClose: () => void;
  /** Omitted once the defining moment is open: the document can be re-read, but close reading is over. */
  onSelectPassage?: (start: number, end: number) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const index = document ? documents.findIndex((item) => item.id === document.id) : -1;
  const saved = index >= 0;

  function selectPassage() {
    const container = content.current;
    if (!document || !onSelectPassage || !container) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const offsets = selectionOffsets(container, selection.getRangeAt(0));
    if (!offsets) return;
    onSelectPassage(offsets.start, offsets.end);
    selection.removeAllRanges();
  }

  return (
    <V3ScrollDialog
      eyebrow={document ? (saved ? `Collected scroll ${index + 1} of ${documents.length}` : "Evidence scroll") : "Collected scrolls"}
      title={document?.title ?? "Documents"}
      kicker="From your travels"
      footerText={document ? (saved ? "Saved in your notes" : "Not saved yet") : "A record of your discoveries"}
      footerSaved={saved}
      closeLabel={document ? `Put down ${document.title}` : "Close documents"}
      buttonLabel={document ? undefined : "Continue exploring"}
      onClose={onClose}
      navigation={document && saved && documents.length > 1 ? {
        items: documents.map((item) => ({ id: item.id, name: item.title })),
        selectedId: document.id,
        onSelect: onSelectDocument,
      } : undefined}
    >
      {document ? (
        <>
          <p className={styles.eyebrow}>{onSelectPassage ? "Select a passage to add it to your notes." : "You can re-read this, but it's time to decide now."}</p>
          <div ref={content} onMouseUp={selectPassage} onTouchEnd={selectPassage} className="select-text">
            <p data-document-paragraph="" className={styles.text}>{document.body}</p>
          </div>
        </>
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
