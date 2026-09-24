"use client";

import { Check, ScrollText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";
import styles from "./document-reader.module.css";

/** A parchment scroll in the browser's modal layer, with focus contained inside. */
export function DocumentReader({ entry, name, imageUrl, position, total, error, onRetry, onClose }: {
  entry: PlayState["journal"][number] | null;
  name: string;
  imageUrl: string | null;
  position: number | null;
  total: number;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
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
            <p className={styles.eyebrow}><ScrollText size={19} aria-hidden="true" /> {position === null ? "Unfolding a scroll" : `Collected scroll ${position} of ${total}`}</p>
            <button type="button" className={styles.close} onClick={onClose} autoFocus aria-label={`Put down ${name}`}><X size={22} aria-hidden="true" /></button>
          </header>
          <div className={styles.content} tabIndex={0} aria-label="Scroll contents" key={name}>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
              <img src={imageUrl} alt="" className={styles.illustration} />
            ) : null}
            <p className={styles.kicker}>From your travels</p>
            <h2 id="document-title" className={styles.title}>{name}</h2>
            <div className={styles.divider} aria-hidden="true"><span>◆</span></div>
            {entry ? (
              <>
                <p className={styles.text}>{entry.text.startsWith(`${name}: `) ? entry.text.slice(name.length + 2) : entry.text}</p>
                {entry.sourceSpan ? <blockquote className={styles.source}><p className={styles.eyebrow}>From the historical record</p><p>{entry.sourceSpan}</p></blockquote> : null}
              </>
            ) : error ? (
              <div className={styles.loading} role="alert"><p>{error}</p><button type="button" className={styles.button} onClick={onRetry}>Try again</button></div>
            ) : (
              <div className={styles.loading} role="status"><Spinner /><p>Unfolding the document…</p><p className={styles.hint}>You can close this scroll and reopen it from Notes.</p></div>
            )}
          </div>
          <footer className={styles.footer}>
            <p>{entry ? <Check size={17} aria-hidden="true" /> : <ScrollText size={17} aria-hidden="true" />}{entry ? "Saved in your notes" : "Available in Notes"}</p>
            <button type="button" className={styles.button} onClick={onClose}>Roll up scroll</button>
          </footer>
        </div>
        <div className={styles.roller} aria-hidden="true" />
      </section>
    </dialog>
  );
}
