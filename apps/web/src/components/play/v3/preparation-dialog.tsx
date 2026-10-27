"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./preparation-dialog.module.css";

export function PreparationDialog({ title, children, onClose, primary }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section>
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close guidance"><X size={20} aria-hidden /></button>
        </header>
        <div className={styles.content}>{children}</div>
        <footer>
          <button type="button" onClick={onClose} autoFocus>{primary ? "Keep exploring" : "Back to exploring"}</button>
          {primary ? <button type="button" className={styles.primary} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</button> : null}
        </footer>
      </section>
    </dialog>
  );
}

/** Guidance acknowledgements are cosmetic. Unavailable storage must never stop play. */
export function guidanceWasSeen(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
export function rememberGuidance(key: string) {
  try { window.localStorage.setItem(key, "1"); } catch { /* The component also remembers for this mount. */ }
}
