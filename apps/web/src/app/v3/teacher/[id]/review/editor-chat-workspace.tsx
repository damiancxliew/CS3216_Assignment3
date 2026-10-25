"use client";

import {
  createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode,
} from "react";
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

export function EditorConversation() {
  const conversation = useContext(Conversation);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!panel.current) return;
    const element = panel.current;
    const resize = () => {
      const top = Math.max(0, element.getBoundingClientRect().top);
      element.style.setProperty("--chat-height", `${Math.max(160, window.innerHeight - top - 24)}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    const layout = element.closest("[data-review-screen]");
    if (layout) observer.observe(layout);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  if (!conversation) return null;
  return (
    <section
      ref={panel}
      aria-label="Adventure conversation"
      className="flex h-[var(--chat-height,60dvh)] min-h-0 min-w-0 flex-col overflow-hidden rounded-surface border border-line bg-surface p-4"
    >
      <h2 className="mb-3 shrink-0 text-lg font-bold">Edit with chat</h2>
      <V3BriefChat
        initial={conversation.brief}
        active={false}
        compact
        onStateChange={conversation.update}
      />
    </section>
  );
}
