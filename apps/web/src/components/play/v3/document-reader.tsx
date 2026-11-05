"use client";

import type { DocumentView } from "@adventure/play-contract";
import { Check, Highlighter, ImageIcon, ScrollText } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import { ReadingCheck, type ReadingCheckSubmission, type SupportingSelection } from "./reading-check";
import { documentDisplayTitle } from "@/lib/play/v3/document-labels";
import styles from "@/components/play/document-reader.module.css";
import readingStyles from "./reading-check.module.css";
import { offsetsFromParagraphs } from "@/lib/play/v3/passage-offsets";
import { pixelFont } from "./pixel-font";

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

const KIND_LABELS: Record<DocumentView["kind"], string> = {
  newspaper: "Newspaper", letter: "Letter", telegram: "Telegram", speech: "Speech", minutes: "Minutes",
  memoir: "Memoir", treaty: "Treaty", report: "Report", other: "Document",
};

/** "Letter · 30 January 1819 · Singapoora": where and when the document comes from, before the student reads it. */
export function documentProvenanceLine(document: Pick<DocumentView, "kind" | "provenance">): string {
  const { masthead, date, place } = document.provenance;
  return [masthead ?? KIND_LABELS[document.kind], date, place].filter(Boolean).join(" · ");
}

/** "Historical source · printed 1878": the year in the citation's last parentheses, when there is one. */
export function sourceTagText(document: Pick<DocumentView, "real" | "sourceLabel">): string {
  if (!document.real) return "Reconstruction · written for this adventure";
  const label = document.sourceLabel && document.sourceLabel !== "invented" ? document.sourceLabel : "";
  const year = [...label.matchAll(/\((?:[^()]*?\b)?(1[0-9]{3}|20[0-9]{2})\b[^()]*\)/g)].at(-1)?.[1];
  return year ? `Historical source · printed ${year}` : "Historical source";
}

function DocumentDetails({ document }: { document: DocumentView }) {
  const { sender, recipient } = document.provenance;
  const fromTo = [sender ? `From ${sender}` : null, recipient ? `To ${recipient}` : null].filter(Boolean).join(" · ");
  return fromTo ? <p className={styles.sourceMeta}>{fromTo}</p> : null;
}

function DocumentCitation({ document }: { document: DocumentView }) {
  const label = document.sourceLabel && document.sourceLabel !== "invented" ? document.sourceLabel : null;
  return <p className={styles.citation}>{label ?? (document.real ? "From the historical record." : "Written for this adventure.")}</p>;
}

function DocumentNotes({ document }: { document: DocumentView }) {
  if (document.glossary.length === 0) return null;
  return (
    <div className={styles.source}>
      <p className={styles.glossaryHeading}>Words to know</p>
      <dl className={styles.glossaryChips}>
        {document.glossary.map((entry) => (
          <div key={entry.term}>
            <dt>{entry.term}</dt>
            <dd>{entry.meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type DocumentFacsimileImage = { url: string; alt: string; caption: string; credit: string };

/** The scanned page, when the teacher attached one. The transcription below stays the text students select. */
function DocumentFacsimile({ facsimile }: { facsimile: DocumentFacsimileImage | null | undefined }) {
  const [shown, setShown] = useState(true);
  const [failed, setFailed] = useState(false);
  if (!facsimile || failed) return null;
  return (
    <>
      <button type="button" className={styles.facsimileToggle} aria-expanded={shown} onClick={() => setShown((open) => !open)}>
        <ImageIcon size={15} aria-hidden /> {shown ? "Hide the original page" : "Show the original page"}
      </button>
      {shown ? (
        <figure className={styles.facsimile}>
          {/* eslint-disable-next-line @next/next/no-img-element -- teacher-selected archive scans use storage URLs */}
          <img src={facsimile.url} alt={facsimile.alt} loading="lazy" onError={() => setFailed(true)} />
          <figcaption>{facsimile.caption}{facsimile.credit ? ` · ${facsimile.credit}` : ""} · Transcription below. Highlight evidence in the transcription.</figcaption>
        </figure>
      ) : null}
    </>
  );
}

/** Keep the source text and offsets intact, including selections across marked text nodes. */
function highlightedBody(body: string, spans: SupportingSelection[]) {
  const boundaries = [...new Set([0, body.length, ...spans.flatMap(({ start, end }) => [start, end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1]!;
    const text = body.slice(start, end);
    return spans.some(span => span.start <= start && span.end >= end)
      ? <mark key={start} className={readingStyles.correctHighlight} data-correct-support="">{text}</mark> : text;
  });
}

export function DocumentReader({
  document,
  documents,
  onSelectDocument,
  onClose,
  onSelectPassage,
  noteCount = 0,
  hasDocumentNote = false,
  supplement,
  readingHint,
  onSubmitReadingCheck,
  onContinueReadingCheck,
  busy = false,
  facsimiles,
}: {
  /** Scanned original pages by document id, resolved on the server like stage art. */
  facsimiles?: Readonly<Record<string, DocumentFacsimileImage>>;
  supplement?: ReactNode;
  readingHint?: string;
  onSubmitReadingCheck?: (submission: ReadingCheckSubmission, onSettled: (succeeded: boolean) => void) => void;
  onContinueReadingCheck?: (questionId: string, onSettled: (succeeded: boolean) => void) => void;
  busy?: boolean;
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
  const [support, setSupport] = useState<{ documentId: string; taskId: string; selection: SupportingSelection | null } | null>(null);
  const status = passageStatus(check, document?.id ?? null, noteCount);
  const index = document ? documents.findIndex((item) => item.id === document.id) : -1;
  const saved = index >= 0;
  const readingCheck = document?.readingCheck;
  const task = readingCheck?.status === "needsReview" ? readingCheck.recovery : readingCheck?.question;
  const taskId = `${readingCheck?.status ?? ""}:${readingCheck?.revealedAnswer ? "answer:" + readingCheck.revealedAnswer.questionId : task?.id ?? ""}`;
  const checkedSelection = support?.documentId === document?.id && support?.taskId === taskId ? support.selection : null;
  const needsCheck = Boolean(readingCheck && readingCheck.status !== "passed");
  const previousTask = useRef<{ documentId: string; key: string; needsReview: boolean } | null>(null);
  const [correctionNotice, setCorrectionNotice] = useState<{ documentId: string; taskId: string } | null>(null);
  const correctionAccepted = correctionNotice?.documentId === document?.id && correctionNotice?.taskId === taskId;

  useEffect(() => {
    const previous = previousTask.current;
    const key = taskId;
    previousTask.current = document ? { documentId: document.id, key, needsReview: readingCheck?.status === "needsReview" } : null;
    if (!document || previous?.documentId !== document.id || previous.key === key) return;
    if (previous.needsReview && readingCheck?.status === "unanswered") setCorrectionNotice({ documentId: document.id, taskId });
    const taskElement = content.current?.parentElement?.querySelector<HTMLElement>("[data-reading-check]");
    taskElement?.scrollIntoView({ block: "start" });
    taskElement?.focus({ preventScroll: true });
  }, [document, readingCheck?.status, taskId]);

  // Touch selection handles and keyboard selection do not always produce a mouseup.
  useEffect(() => {
    if (!needsCheck || !document) return;
    function rememberSelection() {
      const selection = window.getSelection();
      if (!content.current || !selection || selection.isCollapsed || !selection.rangeCount) return;
      const offsets = selectionOffsets(content.current, selection.getRangeAt(0));
      if (offsets) setSupport({ documentId: document!.id, taskId, selection: offsets });
    }
    window.document.addEventListener("selectionchange", rememberSelection);
    return () => window.document.removeEventListener("selectionchange", rememberSelection);
  }, [document, needsCheck, taskId]);

  function selectPassage() {
    const container = content.current;
    if (!document || (!onSelectPassage && !needsCheck) || !container) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const offsets = selectionOffsets(container, selection.getRangeAt(0));
    if (!offsets) return;
    if (needsCheck) {
      setSupport({ documentId: document.id, taskId, selection: offsets });
      return;
    }
    savePassage(offsets.start, offsets.end);
    selection.removeAllRanges();
  }

  function savePassage(start: number, end: number, onSettled?: (succeeded: boolean) => void) {
    if (!document || !onSelectPassage) return;
    const sent: PassageCheck = { documentId: document.id, notesBefore: noteCount, settled: false, succeeded: false };
    setCheck(sent);
    onSelectPassage(start, end, (succeeded) => {
      setCheck((current) => (current === sent ? { ...sent, settled: true, succeeded } : current));
      onSettled?.(succeeded);
    });
  }

  return (
    <V3ScrollDialog
      eyebrow={document ? (saved ? `Collected scroll ${index + 1} of ${documents.length}` : "Evidence scroll") : "Collected scrolls"}
      title={document ? documentDisplayTitle(document.title) : "Documents"}
      kicker={document ? documentProvenanceLine(document) || "From your travels" : "From your travels"}
      footerText={document ? (saved ? "Collected" : "Not collected yet") : "A record of your discoveries"}
      footerSaved={saved}
      closeLabel={document ? `Put down ${documentDisplayTitle(document.title)}` : "Close documents"}
      buttonLabel={document ? undefined : "Continue exploring"}
      onClose={onClose}
      banner={document && readingCheck ? readingCheck.status === "passed" && status ? <PassageHint canSelect={Boolean(onSelectPassage)} firstTime={false} status={status} /> : <p className={`${styles.passageHint} ${readingCheck.status === "passed" ? styles.passageAdded : styles.passageTip}`} role="status">{readingCheck.status === "passed" ? "Reading complete. You can save other useful passages as notes." : readingCheck.status === "needsReview" ? readingCheck.revealedAnswer ? "Review the answer and supporting passage." : "Review the evidence and try again." : correctionAccepted ? "Answer the new question to finish this reading check." : "Read the source, then answer with a short supporting passage."}</p> : document && readingHint ? <p className={styles.passageHint}>{readingHint}</p> : document ? <PassageHint canSelect={Boolean(onSelectPassage)} firstTime={!hasDocumentNote} status={status} /> : undefined}
      navigation={document && saved && documents.length > 1 ? {
        items: documents.map((item) => ({ id: item.id, name: documentDisplayTitle(item.title) })),
        selectedId: document.id,
        onSelect: onSelectDocument,
      } : undefined}
    >
      {document ? (
        <>
          <article className={styles.sourceCard} aria-label={sourceTagText(document)}>
            <span className={`${pixelFont.className} ${styles.sourceTag}`} data-real={document.real} title={document.real ? "From historical source material" : "Written for this adventure"}>{sourceTagText(document)}</span>
            <DocumentDetails document={document} />
            <DocumentFacsimile key={document.id} facsimile={facsimiles?.[document.id]} />
            <div ref={content} onMouseUp={selectPassage} onTouchEnd={selectPassage} className="select-text">
              <p data-document-paragraph="" className={styles.text}>{highlightedBody(document.body, readingCheck?.revealedAnswer?.support ?? [])}</p>
            </div>
            <DocumentCitation document={document} />
          </article>
          {readingCheck ? <ReadingCheck key={`${document.id}:${taskId}`} document={document} selection={checkedSelection} onSelect={(selection) => {
            if (!selection) window.getSelection()?.removeAllRanges();
            setSupport({ documentId: document.id, taskId, selection });
          }} onSubmit={onSubmitReadingCheck} onContinue={onContinueReadingCheck} busy={busy} /> : null}
          {supplement}
          <DocumentNotes document={document} />
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
