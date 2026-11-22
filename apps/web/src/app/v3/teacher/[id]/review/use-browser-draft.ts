"use client";

import { useEffect, useRef, useState } from "react";
import type { CapturedSource } from "@/lib/v3/edit/commands";
import { browserDraftKey, recoverBrowserDraft, type BrowserDraft } from "./browser-draft";

type RecoveredDraft = ReturnType<typeof recoverBrowserDraft>;
export function useBrowserDraft({ adventureId, value, dirty, sources, onRecover }: {
  adventureId: string;
  value: BrowserDraft;
  dirty: boolean;
  sources: CapturedSource[];
  /** Return false to leave the stored draft untouched instead of adopting it. */
  onRecover: (draft: RecoveredDraft) => boolean | void;
}) {
  const key = browserDraftKey(adventureId);
  const restored = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const wrote = useRef(false);
  /** Set by clear(): keep the stored copy gone until the draft is clean again, even if the page re-renders before a reload. */
  const cleared = useRef(false);
  useEffect(() => {
    if (restored.current === key) return;
    restored.current = key;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        if (onRecover(recoverBrowserDraft(raw, adventureId, sources)) !== false) {
          wrote.current = true;
          setNotice("Recovered your unsaved draft from this browser.");
        }
      }
    } catch {
      setBlocked(true);
      setError("Could not recover the browser draft. Its stored copy has been preserved.");
    }
    setReady(true);
  }, [key, adventureId, sources, onRecover]);
  useEffect(() => {
    if (!ready || blocked) return;
    if (cleared.current) {
      if (dirty) return;
      cleared.current = false;
    }
    try {
      if (dirty) {
        localStorage.setItem(key, JSON.stringify(value));
        wrote.current = true;
      } else if (wrote.current) {
        // Only drop a copy this page wrote, so a clean page never erases another tab's draft.
        localStorage.removeItem(key);
        wrote.current = false;
        setNotice("");
      }
      setError("");
    } catch {
      setError("This browser could not keep your draft. Save before leaving the page.");
    }
  }, [key, ready, blocked, dirty, value]);
  function clear() {
    try { localStorage.removeItem(key); } catch { /* Keep the storage warning visible. */ }
    cleared.current = true;
    wrote.current = false;
    setNotice("");
    setBlocked(false);
  }
  return { notice, error, clear };
}
