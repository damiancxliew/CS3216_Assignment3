"use client";

import { Check, ChevronLeft, ChevronRight, ScrollText, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "@/components/play/document-reader.module.css";

export function V3ScrollDialog({
  eyebrow,
  title,
  kicker,
  footerText,
  footerSaved = false,
  closeLabel,
  buttonLabel = "Roll up scroll",
  onClose,
  navigation,
  banner,
  children,
}: {
  eyebrow: string;
  title: string;
  kicker?: string;
  footerText: string;
  footerSaved?: boolean;
  closeLabel: string;
  buttonLabel?: string;
  onClose: () => void;
  navigation?: {
    items: { id: string; name: string }[];
    selectedId: string;
    onSelect: (id: string) => void;
  };
  /** Pinned above the scrolling contents, so it stays in view while reading. */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selectedIndex = navigation?.items.findIndex((item) => item.id === navigation.selectedId) ?? -1;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const modal = dialog.current!;
    document.body.style.overflow = "hidden";
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.scroll}>
        <div className={styles.roller} aria-hidden="true" />
        <div className={styles.paper}>
          <header className={styles.header}>
            <p className={styles.eyebrow}><ScrollText size={19} aria-hidden="true" /> {eyebrow}</p>
            <button type="button" className={styles.close} onClick={onClose} autoFocus aria-label={closeLabel}>
              <X size={22} aria-hidden="true" />
            </button>
          </header>
          {navigation && navigation.items.length > 1 ? (
            <nav className={styles.navigation} aria-label="Collected scrolls">
              <button
                type="button"
                className={styles.pageButton}
                aria-label="Previous scroll"
                disabled={selectedIndex <= 0}
                onClick={() => navigation.onSelect(navigation.items[selectedIndex - 1]!.id)}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <select
                className={styles.select}
                aria-label="Choose a collected scroll"
                value={navigation.selectedId}
                onChange={(event) => navigation.onSelect(event.target.value)}
              >
                {navigation.items.map((item, index) => (
                  <option key={item.id} value={item.id}>{index + 1}. {item.name}</option>
                ))}
              </select>
              <button
                type="button"
                className={styles.pageButton}
                aria-label="Next scroll"
                disabled={selectedIndex < 0 || selectedIndex >= navigation.items.length - 1}
                onClick={() => navigation.onSelect(navigation.items[selectedIndex + 1]!.id)}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </nav>
          ) : null}
          {banner}
          <div className={styles.content} tabIndex={0} aria-label="Scroll contents">
            {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
            <h2 id={titleId} className={styles.title}>{title}</h2>
            <div className={styles.divider} aria-hidden="true"><span>◆</span></div>
            {children}
          </div>
          <footer className={styles.footer}>
            <p>
              {footerSaved ? <Check size={17} aria-hidden="true" /> : <ScrollText size={17} aria-hidden="true" />}
              {footerText}
            </p>
            <button type="button" className={styles.button} onClick={onClose}>{buttonLabel}</button>
          </footer>
        </div>
        <div className={styles.roller} aria-hidden="true" />
      </section>
    </dialog>
  );
}
