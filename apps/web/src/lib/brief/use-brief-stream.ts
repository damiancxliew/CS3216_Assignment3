"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string; slot: string };

/** Reads newline-delimited events across arbitrary HTTP/UTF-8 chunk boundaries. */
export async function readBriefStream<T>(response: Response, onReply: (index: number, text: string) => void): Promise<T> {
  if (!response.ok || !response.body) throw new Error("Couldn’t send that message. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let completed = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "reply" && Number.isInteger(event.index) && event.index >= 0 && typeof event.text === "string") onReply(event.index, event.text);
    if (event.type === "result") { result = event.result; completed = true; }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!completed) throw new Error("The response was interrupted. Please try again.");
    return result as T;
  } finally {
    reader.releaseLock();
  }
}

export function useBriefStream<T>(setState: (state: T) => void, setError: (error: string | null) => void) {
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<Message[]>([]);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function send(url: string, payload: unknown, user?: Message): Promise<boolean> {
    if (active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    setError(null);
    setStreaming(true);
    setPreview(user ? [user] : []);
    const replies: Message[] = [];
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      const result = await readBriefStream<{ ok?: boolean; state?: T; error?: string }>(response, (index, text) => {
        replies[index] = { role: "assistant", text, slot: user?.slot ?? "" };
        setPreview([...(user ? [user] : []), ...replies.filter(Boolean)]);
      });
      if (!result.ok || !result.state) throw new Error(result.error || "Couldn’t complete that request. Please try again.");
      setState(result.state);
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn’t send that message. Please try again.");
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setStreaming(false);
        setPreview([]);
      }
    }
  }
  return { streaming, preview, send };
}
