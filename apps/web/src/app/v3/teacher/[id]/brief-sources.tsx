"use client";

import { ChevronLeft, ChevronRight, Eye, FileText, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Thinking } from "@/components/ui";
import { previewBriefSource, type BriefSourcePreview } from "./source-preview-actions";
import styles from "./brief-sources.module.css";

type Source = { id: string; title: string; kind: string };

export function SourceMaterial({ adventureId, sources, onFiles, onRemove, removing = null, removeError = null, uploadDisabled = false }: {
  adventureId: string;
  sources: Source[];
  onFiles?: (files: File[]) => void;
  /** While sources are still being added: each tile gets a remove (×) button. */
  onRemove?: (sourceId: string) => void;
  removing?: string | null;
  removeError?: string | null;
  uploadDisabled?: boolean;
}) {
  const [selected, setSelected] = useState<{ source: Source; trigger: HTMLButtonElement } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const acceptsFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  return (
    <section
      aria-label="Source material"
      className={`${styles.card} ${dragging && !uploadDisabled ? styles.dragging : ""}`}
      onDragEnter={onFiles ? (event) => {
        if (!acceptsFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      } : undefined}
      onDragOver={onFiles ? (event) => {
        if (!acceptsFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = uploadDisabled ? "none" : "copy";
      } : undefined}
      onDragLeave={onFiles ? (event) => {
        if (!acceptsFiles(event)) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      } : undefined}
      onDrop={onFiles ? (event) => {
        if (!acceptsFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (!uploadDisabled && files.length) onFiles(files);
      } : undefined}
    >
      <div className={styles.heading}>
        <h2 className={styles.tag}><FileText aria-hidden />Source material</h2>
        <span className={styles.count}>{sources.length} {sources.length === 1 ? "source" : "sources"}</span>
      </div>
      {sources.length ? (
        <ul className={styles.grid} data-source-grid>
          {sources.map((source) => (
            <li key={source.id} className={styles.tile} data-source-tile>
              <div className={styles.stamp} aria-hidden><FileText /><span>{source.kind === "pdf" ? "PDF" : "TEXT"}</span></div>
              <strong className={styles.name}>{source.title}</strong>
              <button type="button" aria-label={`Preview ${source.title}`} title={`Preview ${source.title}`} className={styles.iconButton} onClick={(event) => setSelected({ source, trigger: event.currentTarget })}><Eye aria-hidden /></button>
              {onRemove ? <button type="button" aria-label={`Remove ${source.title}`} title={`Remove ${source.title}`} className={`${styles.iconButton} ${styles.remove}`} disabled={uploadDisabled || removing !== null} aria-busy={removing === source.id} onClick={() => onRemove(source.id)}><X aria-hidden /></button> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <svg className={styles.illustration} viewBox="0 0 64 64" aria-hidden>
            <rect x="4" y="12" width="40" height="46" rx="10" fill="var(--world-wash)" transform="rotate(-10 24 35)" />
            <rect x="22" y="5" width="35" height="46" rx="9" fill="var(--record-wash)" />
            <path d="M31 18h17M31 25h17M31 32h10" stroke="var(--record)" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="17" cy="47" r="11" fill="var(--world-wash)" />
            <path d="M17 42v10m-5-5h10" stroke="var(--world)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <p>Upload a PDF or text file, or paste a passage in the conversation. Your source material will appear here.</p>
        </div>
      )}
      {removeError ? <p role="alert" className={styles.dropHint}>{removeError}</p> : null}
      {onFiles ? <p className={styles.dropHint}>{uploadDisabled ? "Finish the current request before adding more files." : "Drop files here, or choose files in the conversation."}</p> : null}
      {selected ? <SourcePreviewDialog key={`${adventureId}:${selected.source.id}`} adventureId={adventureId} source={selected.source} returnFocus={selected.trigger} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function SourcePreviewDialog({ adventureId, source, returnFocus, onClose }: {
  adventureId: string; source: Source; returnFocus: HTMLButtonElement; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [result, setResult] = useState<BriefSourcePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const modal = dialog.current!;
    document.body.style.overflow = "hidden";
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  useEffect(() => {
    let current = true;
    setError(null);
    setResult(null);
    void previewBriefSource(adventureId, source.id).then((response) => {
      if (!current) return;
      if (response.ok) setResult(response.source);
      else setError(response.error);
    }).catch(() => {
      if (current) setError("Couldn’t load this source. Please try again.");
    });
    return () => { current = false; };
  }, [adventureId, source.id, attempt]);

  const page = result?.pages[pageIndex];
  const hasText = result?.pages.some((entry) => entry.text.trim());
  function changePage(nextIndex: number) {
    setPageIndex(nextIndex);
    reader.current?.scrollTo({ top: 0 });
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className={styles.dialog}>
      <div className={styles.dialogBody}>
        <header className={styles.dialogHead}>
          <div>
            <p className={styles.eyebrow}>Source preview</p>
            <h2 id={titleId} className={styles.dialogTitle}>{result?.title ?? source.title}</h2>
            <p id={descriptionId} className={styles.eyebrow}>Extracted text · source material</p>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label="Close source preview" className={`${styles.button} ${styles.close}`}><X aria-hidden /></button>
        </header>
        <div ref={reader} className={styles.reader}>
          {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className={styles.button}>Try again</button></div>
            : !result ? <Thinking label="Loading source…" />
            : !hasText ? <p className={styles.eyebrow}>No readable text is available for this source.</p>
            : <>
              {result.kind === "pdf" ? <p className={styles.eyebrow}>Extracted page {page?.page}</p> : null}
              <div className={styles.text}>{result.kind === "pdf" ? page?.text || "No readable text on this page." : result.pages.map((entry) => entry.text).join("\n\n")}</div>
            </>}
        </div>
        {result?.kind === "pdf" && result.pages.length > 1 ? (
          <footer className={styles.footer}>
            <button type="button" onClick={() => changePage(pageIndex - 1)} disabled={pageIndex === 0} className={styles.button}><ChevronLeft aria-hidden />Previous</button>
            <span aria-live="polite">Page {page?.page} · {pageIndex + 1} of {result.pages.length}</span>
            <button type="button" onClick={() => changePage(pageIndex + 1)} disabled={pageIndex >= result.pages.length - 1} className={styles.button}>Next<ChevronRight aria-hidden /></button>
          </footer>
        ) : <footer className={styles.footer}>{result?.origin === "outside"
          ? "Text as read from the website. Stray symbols or code, such as text in braces, come from the page’s layout and aren’t part of the article."
          : "Text preview · Original document layout is not shown."}</footer>}
      </div>
    </dialog>
  );
}
