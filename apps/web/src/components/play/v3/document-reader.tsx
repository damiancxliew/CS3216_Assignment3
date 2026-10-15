"use client";

import type { DocumentView } from "@adventure/play-contract";
import { useRef } from "react";

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
  onClose,
  onSelectPassage,
}: {
  document: DocumentView;
  onClose: () => void;
  /** Omitted once the defining moment is open: the document can be re-read, but close reading is over. */
  onSelectPassage?: (start: number, end: number) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const paragraphs = document.body.split("\n");

  function selectPassage() {
    const container = content.current;
    if (!onSelectPassage) return;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const offsets = selectionOffsets(container, selection.getRangeAt(0));
    if (!offsets) return;
    onSelectPassage(offsets.start, offsets.end);
    selection.removeAllRanges();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-3 sm:p-6" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-reader-title"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border-4 border-wood bg-paper shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line p-4 sm:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-record">{document.kind}</p>
            <h2 id="document-reader-title" className="mt-1 text-2xl font-black text-ink sm:text-3xl">{document.title}</h2>
            <p className="mt-2 text-sm text-muted">
              {[document.provenance.masthead, document.provenance.date, document.provenance.place]
                .filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line-strong px-3 font-bold text-ink">Close</button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 sm:p-8">
          <p className="mb-4 text-sm text-muted">
            {onSelectPassage ? "Select a passage to add it to your notes." : "You can re-read this, but it's time to decide now."}
          </p>
          <div ref={content} onMouseUp={selectPassage} onTouchEnd={selectPassage} className="select-text font-serif text-lg leading-8 text-ink">
            {paragraphs.map((paragraph, index) => (
              <p key={index} data-document-paragraph="" className="mb-4 whitespace-pre-wrap">{paragraph}</p>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
