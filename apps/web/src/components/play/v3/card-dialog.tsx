"use client";

import { useId, type ReactNode } from "react";
import { button } from "@/components/ui";
import { AdventureDialog } from "../adventure-dialog";
import styles from "../adventure-chrome.module.css";

/** General exploration and activity panels; the scroll frame belongs to evidence. */
export function V3CardDialog({ title, eyebrow, footerText, closeLabel, onClose, kind = "activity", children }: {
  kind?: "activity" | "notes";
  title: string;
  eyebrow: string;
  footerText: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return <AdventureDialog kind={kind} titleId={titleId} closeLabel={closeLabel} onClose={onClose}>
    <div>
      <p className={styles.modalKicker}>{eyebrow}</p>
      <h2 id={titleId} className={styles.modalTitle}>{title}</h2>
    </div>
    {children}
    <footer className={styles.modalFooter}>
      <p className={styles.fieldStamp}>{footerText}</p>
      <button type="button" className={button.subtle} onClick={onClose}>{closeLabel}</button>
    </footer>
  </AdventureDialog>;
}
