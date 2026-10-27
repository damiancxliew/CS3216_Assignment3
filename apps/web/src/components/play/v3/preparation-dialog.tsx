"use client";

import type { ReactNode } from "react";
import { V3ScrollDialog } from "./scroll-dialog";
import scrollStyles from "@/components/play/document-reader.module.css";
import styles from "./preparation-dialog.module.css";

export function PreparationDialog({ title, children, onClose, primary }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return <V3ScrollDialog eyebrow="Investigation" title={title} footerText="Stage preparation" closeLabel="Close guidance" onClose={onClose} footerActions={
    <div className={styles.actions}>
      <button type="button" className={scrollStyles.button} onClick={onClose}>{primary ? "Keep exploring" : "Back to exploring"}</button>
      {primary ? <button type="button" className={`${scrollStyles.button} ${styles.primary}`} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</button> : null}
    </div>
  }>
    <div className={styles.content}>{children}</div>
  </V3ScrollDialog>;
}

/** Guidance acknowledgements are cosmetic. Unavailable storage must never stop play. */
export function guidanceWasSeen(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
export function rememberGuidance(key: string) {
  try { window.localStorage.setItem(key, "1"); } catch { /* The component also remembers for this mount. */ }
}
