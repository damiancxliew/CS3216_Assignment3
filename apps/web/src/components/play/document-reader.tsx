"use client";

import { Check, ChevronLeft, ChevronRight, ScrollText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";
import styles from "./document-reader.module.css";

/** A parchment scroll in the browser's modal layer, with focus contained inside. */
export function DocumentReader({ entry, saved = true, name, imageUrl, documents, selectedId, onSelect, error, onRetry, onClose }: {
  entry: Pick<PlayState["journal"][number], "text" | "sourceSpan"> | null;
  saved?: boolean;
  name: string;
  imageUrl: string | null;
  documents: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const index = documents.findIndex((document) => document.id === selectedId);
  const empty = selectedId === null;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="document-title" onCancel={onClose} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={styles.scroll}>
        <div className={styles.roller} aria-hidden="true" />
        <div className={styles.paper}>
          <header className={styles.header}>
            <p className={styles.eyebrow}><ScrollText size={19} aria-hidden="true" /> {empty ? "Your notes" : !saved || index < 0 ? "Evidence scroll" : `Collected scroll ${index + 1} of ${documents.length}`}</p>
            <button type="button" className={styles.close} onClick={onClose} autoFocus aria-label={empty ? "Close notes" : `Put down ${name}`}><X size={22} aria-hidden="true" /></button>
          </header>
          {documents.length > 1 ? (
            <nav className={styles.navigation} aria-label="Collected notes">
              <button type="button" className={styles.pageButton} aria-label="Previous scroll" disabled={index <= 0} onClick={() => onSelect(documents[index - 1].id)}><ChevronLeft size={20} aria-hidden="true" /></button>
              <select className={styles.select} aria-label="Choose a collected scroll" value={index < 0 ? "" : selectedId ?? ""} onChange={(event) => onSelect(event.target.value)}>
                {index < 0 ? <option value="" disabled>Choose a collected scroll</option> : null}
                {documents.map((document, position) => <option key={document.id} value={document.id}>{position + 1}. {document.name}</option>)}
              </select>
              <button type="button" className={styles.pageButton} aria-label="Next scroll" disabled={index < 0 || index >= documents.length - 1} onClick={() => onSelect(documents[index + 1].id)}><ChevronRight size={20} aria-hidden="true" /></button>
            </nav>
          ) : null}
          <div className={styles.content} tabIndex={0} aria-label="Scroll contents" key={selectedId}>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
              <img src={imageUrl} alt="" className={styles.illustration} />
            ) : null}
            <p className={styles.kicker}>From your travels</p>
            <h2 id="document-title" className={styles.title}>{empty ? "Your notes" : name}</h2>
            <div className={styles.divider} aria-hidden="true"><span>◆</span></div>
            {empty ? (
              <div className={styles.loading}><ScrollText size={44} aria-hidden="true" /><p>No scrolls collected yet.</p><p className={styles.hint}>Walk to a document to read it. Every scroll you collect will be saved here.</p></div>
            ) : entry ? (
              <>
                <p className={styles.text}>{entry.text.startsWith(`${name}: `) ? entry.text.slice(name.length + 2) : entry.text}</p>
                {entry.sourceSpan ? <blockquote className={styles.source}><p className={styles.eyebrow}>From the historical record</p><p>{entry.sourceSpan}</p></blockquote> : null}
                {error && !saved ? <div role="alert"><p>{error}</p><button type="button" className={styles.button} onClick={onRetry}>Try again</button></div> : null}
              </>
            ) : error ? (
              <div className={styles.loading} role="alert"><p>{error}</p><button type="button" className={styles.button} onClick={onRetry}>Try again</button></div>
            ) : (
              <div className={styles.loading} role="status"><Spinner /><p>Unfolding the document…</p><p className={styles.hint}>You can close this scroll and reopen it from Notes.</p></div>
            )}
          </div>
          <footer className={styles.footer}>
            <p>{entry && saved ? <Check size={17} aria-hidden="true" /> : <ScrollText size={17} aria-hidden="true" />}{empty ? "A record of your discoveries" : entry && saved ? "Saved in your notes" : error ? "Not saved yet" : "Saving to your notes…"}</p>
            <button type="button" className={styles.button} onClick={onClose}>{empty ? "Continue exploring" : "Roll up scroll"}</button>
          </footer>
        </div>
        <div className={styles.roller} aria-hidden="true" />
      </section>
    </dialog>
  );
}
