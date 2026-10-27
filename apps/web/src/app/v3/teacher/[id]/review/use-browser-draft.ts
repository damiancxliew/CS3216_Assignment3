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
  onRecover: (draft: RecoveredDraft) => void;
}) {
  const key = browserDraftKey(adventureId);
  const restored = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (restored.current === key) return;
    restored.current = key;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        onRecover(recoverBrowserDraft(raw, adventureId, sources));
        setNotice("Recovered your unsaved draft from this browser.");
      }
    } catch {
      setBlocked(true);
      setError("Could not recover the browser draft. Its stored copy has been preserved.");
    }
    setReady(true);
  }, [key, adventureId, sources, onRecover]);
  useEffect(() => {
    if (!ready || blocked) return;
    try {
      if (dirty) localStorage.setItem(key, JSON.stringify(value));
      else {
        localStorage.removeItem(key);
        setNotice("");
      }
      setError("");
    } catch {
      setError("This browser could not keep your draft. Save before leaving the page.");
    }
  }, [key, ready, blocked, dirty, value]);
  function clear() {
    try { localStorage.removeItem(key); } catch { /* Keep the storage warning visible. */ }
    setNotice("");
    setBlocked(false);
  }
  return { notice, error, clear };
}
