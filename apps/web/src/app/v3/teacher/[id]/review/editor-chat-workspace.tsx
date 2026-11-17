"use client";

import {
  createContext, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { Grip } from "lucide-react";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import { ReviewChatProvider } from "../review-chat-context";
import { V3BriefChat } from "../brief-chat";

const Conversation = createContext<{
  brief: BriefStateV3;
  update(brief: BriefStateV3): void;
} | null>(null);

export function EditorChatWorkspace({ brief, children }: {
  brief: BriefStateV3;
  children: ReactNode;
}) {
  const [conversation, update] = useState(brief);
  return (
    <ReviewChatProvider>
      <Conversation.Provider value={{ brief: conversation, update }}>
        {children}
      </Conversation.Provider>
    </ReviewChatProvider>
  );
}

export function EditorConversation({ onClose }: { onClose: () => void }) {
  const conversation = useContext(Conversation);
  const [height, setHeight] = useState(224);
  const [narrow, setNarrow] = useState(false);
  const drag = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    const update = () => setNarrow(query.matches);
    setHeight(Math.round(Math.min(440, window.innerHeight * 0.6)));
    update();
    query.addEventListener("change", update);
    try {
      const saved = Number(sessionStorage.getItem("v3-editor-chat-height"));
      if (saved) setHeight(Math.max(160, Math.min(window.innerHeight * 0.8, saved)));
    } catch { /* Resizing still works without storage. */ }
    return () => query.removeEventListener("change", update);
  }, []);
  const resize = (next: number) => {
    const value = Math.max(160, Math.min(window.innerHeight * 0.8, next));
    setHeight(value);
    try { sessionStorage.setItem("v3-editor-chat-height", String(value)); } catch { /* Keep the in-memory height. */ }
  };
  if (!conversation) return null;
  return (
    <section
      aria-label="Adventure conversation"
      style={narrow ? { height, minHeight: 160, maxHeight: "80vh" } : undefined}
      className="relative flex h-56 xl:h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-surface border border-line bg-surface p-4 shadow-[0_2px_10px_rgb(0_0_0/0.10)]"
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Edit with chat</h2>
        <button type="button" onClick={onClose} aria-label="Close chat" className="text-sm text-muted underline underline-offset-4 hover:text-ink">Close</button>
      </div>
      <V3BriefChat
        initial={conversation.brief}
        active={false}
        onStateChange={conversation.update}
      />
      <div
        role="separator"
        aria-label="Resize chat height"
        aria-orientation="horizontal"
        aria-valuemin={160}
        aria-valuemax={narrow ? Math.round(window.innerHeight * 0.8) : 800}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        className="absolute bottom-0 right-0 flex h-5 w-5 touch-none cursor-ns-resize items-center justify-center rounded-control text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink xl:hidden"
        onPointerDown={event => { drag.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (drag.current) resize(drag.current.height + event.clientY - drag.current.y); }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); resize(height + (event.key === "ArrowUp" ? -24 : 24)); } }}
      ><Grip size={12} aria-hidden /></div>
    </section>
  );
}
