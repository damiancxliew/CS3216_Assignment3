"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft, Newspaper, Pin, X } from "lucide-react";
import styles from "./evidence-dialog.module.css";

type EvidenceDialogProps = {
  title: string;
  masthead?: string;
  readingLabel?: string;
  boardLabel?: string;
  eyebrow: string;
  footerText: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};
export function NewspaperDialog(props: EvidenceDialogProps) {
  return <EvidenceDialog {...props} frame="newspaper" />;
}
export function NoticeboardDialog(props: EvidenceDialogProps) {
  return <EvidenceDialog {...props} frame="noticeboard" />;
}

/** Demo-only presentation. The historical scan and the student's reading activity stay distinct. */
function EvidenceDialog({ frame, title, eyebrow, footerText, closeLabel, onClose, children, masthead = "The Shonan Times", readingLabel, boardLabel = "Singapore · notice board" }: EvidenceDialogProps & {
  frame: "newspaper" | "noticeboard";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const newspaper = frame === "newspaper";
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const modal = dialog.current!;
    document.body.style.overflow = "hidden";
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={dialog} className={styles.dialog} data-evidence-frame={frame}
      aria-labelledby={titleId} onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`${styles.frame} ${newspaper ? styles.newspaper : styles.board}`}>
        <header className={styles.toolbar}>
          <span>{newspaper ? <Newspaper size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
            {newspaper ? "From the newspaper archive" : boardLabel}
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label={closeLabel} autoFocus>
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.contents} tabIndex={0} aria-label={newspaper ? "Newspaper contents" : "Notice board contents"}>
          <article className={styles.sheet}>
            {newspaper ? <p className={styles.masthead}>{masthead}</p> : <span className={styles.pin} aria-hidden="true" />}
            <p className={styles.dateline}>{eyebrow}</p>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            <p className={styles.readingLabel}>{readingLabel ?? (newspaper ? "The original front page · a reading companion" : "Observer’s display · examine the evidence")}</p>
            {children}
          </article>
        </div>
        <footer className={styles.footer}>
          <p>{footerText}</p>
          <button type="button" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" /> Back to the map</button>
        </footer>
      </section>
    </dialog>
  );
}
