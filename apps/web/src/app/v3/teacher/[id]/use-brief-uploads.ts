"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import { MAX_UPLOAD_BYTES } from "@/lib/brief/schema";
import { addV3BriefSource, removeV3BriefSource } from "../actions";

export type UploadQueueItem = {
  id: string;
  name: string;
  status: "queued" | "uploading" | "failed";
  error?: string;
};
type Entry = UploadQueueItem & { file?: File; text?: string; reserved: boolean; resolve?: (ok: boolean) => void };
const MAX_SOURCES = 20;

function fileError(file: File) {
  if (!file.size) return "That file is empty. Choose a file with source material.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file exceeds the 15 MB limit.";
  if (!/\.(pdf|txt|md)$/i.test(file.name) && !["application/pdf", "text/plain", "text/markdown"].includes(file.type)) return "Only PDF, TXT and MD files are supported.";
}

/** One queue shared by both file pickers and drop targets; tokens survive retry. */
export function useBriefUploads({ adventureId, sourceCount, onState }: {
  adventureId: string;
  sourceCount: number;
  onState(state: BriefStateV3): void;
}) {
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const entries = useRef<Entry[]>([]);
  const pending = useRef(false);
  const mounted = useRef(true);
  const authoritative = useRef(sourceCount);
  const lastCount = useRef(sourceCount);
  const callback = useRef(onState);
  callback.current = onState;
  if (lastCount.current !== sourceCount) {
    authoritative.current = sourceCount;
    lastCount.current = sourceCount;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const entry of entries.current) entry.resolve?.(false);
    };
  }, []);

  const publish = useCallback(() => {
    if (mounted.current) setItems(entries.current.map(({ id, name, status, error }) => ({ id, name, status, error })));
  }, []);
  const hasRoom = useCallback(() => authoritative.current + entries.current.filter((entry) => entry.reserved).length < MAX_SOURCES, []);
  const pump = useCallback(async () => {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    try {
      let next: Entry | undefined;
      while (mounted.current && (next = entries.current.find((entry) => entry.status === "queued"))) {
        const entry = next;
        entry.status = "uploading";
        publish();
        const form = new FormData();
        form.set("uploadId", entry.id);
        if (entry.file) form.set("file", entry.file);
        else form.set("body", entry.text ?? "");
        try {
          const result = await addV3BriefSource(adventureId, form);
          if (!mounted.current) return;
          if ("ok" in result && result.ok) {
            authoritative.current = result.state.sources.length;
            entries.current = entries.current.filter((item) => item.id !== entry.id);
            callback.current(result.state);
            entry.resolve?.(true);
          } else {
            entry.status = "failed";
            entry.error = "error" in result && result.error !== "not_found" ? result.error : "Couldn’t save that source. Please try again.";
            entry.resolve?.(false);
          }
        } catch {
          if (!mounted.current) return;
          entry.status = "failed";
          entry.error = "Couldn’t save that source. Check your connection and try again.";
          entry.resolve?.(false);
        }
        entry.resolve = undefined;
        publish();
      }
    } finally {
      pending.current = false;
    }
  }, [adventureId, publish]);

  const addFiles = useCallback((files: File[]) => {
    if (!mounted.current) return;
    for (const file of files) {
      const error = fileError(file) ?? (!hasRoom() ? "You can add up to 20 sources. Dismiss a queued source before adding another." : undefined);
      entries.current.push({ id: crypto.randomUUID(), name: file.name, file, status: error ? "failed" : "queued", error, reserved: !error });
    }
    publish();
    void pump();
  }, [hasRoom, publish, pump]);

  const retry = useCallback((id: string) => {
    const entry = entries.current.find((item) => item.id === id && item.status === "failed");
    if (!entry || !mounted.current) return;
    const error = entry.file ? fileError(entry.file) : undefined;
    if (error) { entry.error = error; publish(); return; }
    if (!entry.reserved && !hasRoom()) { entry.error = "You can add up to 20 sources."; publish(); return; }
    entry.reserved = true;
    entry.status = "queued";
    entry.error = undefined;
    publish();
    void pump();
  }, [hasRoom, publish, pump]);

  const dismiss = useCallback((id: string) => {
    const entry = entries.current.find((item) => item.id === id);
    if (!entry || entry.status === "uploading") return;
    entry.resolve?.(false);
    entries.current = entries.current.filter((item) => item.id !== id);
    publish();
  }, [publish]);

  const addText = useCallback((text: string): Promise<boolean> => {
    if (!mounted.current || !text.trim()) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (!hasRoom()) {
        entries.current.push({ id: crypto.randomUUID(), name: "Pasted passage", text: text.trim(), status: "failed", error: "You can add up to 20 sources.", reserved: false });
        publish(); resolve(false); return;
      }
      entries.current.push({ id: crypto.randomUUID(), name: "Pasted passage", text: text.trim(), status: "queued", reserved: true, resolve });
      publish();
      void pump();
    });
  }, [hasRoom, publish, pump]);

  /** Removes a saved upload; one at a time, never while the queue is writing. */
  const remove = useCallback(async (sourceId: string) => {
    if (!mounted.current || removing || pending.current) return;
    setRemoving(sourceId);
    setRemoveError(null);
    try {
      const result = await removeV3BriefSource(adventureId, sourceId);
      if (!mounted.current) return;
      if ("ok" in result && result.ok) {
        authoritative.current = result.state.sources.length;
        callback.current(result.state);
      } else setRemoveError("error" in result && result.error !== "not_found" ? result.error : "Couldn’t remove that source. Please try again.");
    } catch {
      if (mounted.current) setRemoveError("Couldn’t remove that source. Check your connection and try again.");
    } finally {
      if (mounted.current) setRemoving(null);
    }
  }, [adventureId, removing]);

  return { items, busy: removing !== null || items.some((item) => item.status !== "failed"), removing, removeError, addFiles, retry, dismiss, addText, remove };
}
export type BriefUploads = ReturnType<typeof useBriefUploads>;
