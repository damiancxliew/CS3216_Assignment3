"use client";

import { Compass, UserRound, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./adventure-chrome.module.css";

/** The browser's modal layer keeps keyboard focus (and map input) inside the card. */
export function AdventureDialog({ kind, titleId, descriptionId, onClose, children }: {
  kind: "landmark" | "character";
  titleId: string;
  descriptionId?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const modal = dialog.current!;
    document.body.style.overflow = "hidden";
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const Icon = kind === "landmark" ? Compass : UserRound;
  return (
    <dialog ref={dialog} className={`${styles.dialog} ${styles[kind]}`} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={onClose} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }}>
      <div className={styles.modalFrame}>
        <header className={styles.modalHeader}>
          <span className={styles.modalEmblem}><Icon size={24} aria-hidden="true" /></span>
          <p>{kind === "landmark" ? "A closer look" : "Meet your character"}</p>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className={styles.modalPaper}>{children}</div>
      </div>
    </dialog>
  );
}
