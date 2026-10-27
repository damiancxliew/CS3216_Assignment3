"use client";

import { useId, type ReactNode } from "react";
import { AdventureDialog } from "../adventure-dialog";
import chromeStyles from "../adventure-chrome.module.css";
import { button } from "@/components/ui";
import styles from "./preparation-dialog.module.css";

export function PreparationDialog({ title, children, onClose, primary }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const titleId = useId();
  return <AdventureDialog kind="preparation" titleId={titleId} closeLabel="Close guidance" onClose={onClose}>
    <h2 id={titleId} className={chromeStyles.modalTitle}>{title}</h2>
    <div className={styles.content}>{children}</div>
    <footer className={`${chromeStyles.modalFooter} ${styles.actions}`}>
      <button type="button" className={button.subtle} onClick={onClose}>{primary ? "Keep exploring" : "Back to exploring"}</button>
      {primary ? <button type="button" className={button.primary} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</button> : null}
    </footer>
  </AdventureDialog>;
}

/** Guidance acknowledgements are cosmetic. Unavailable storage must never stop play. */
export function guidanceWasSeen(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
export function rememberGuidance(key: string) {
  try { window.localStorage.setItem(key, "1"); } catch { /* The component also remembers for this mount. */ }
}
