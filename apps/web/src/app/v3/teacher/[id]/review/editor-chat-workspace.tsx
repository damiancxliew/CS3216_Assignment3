"use client";

import {
  createContext, useContext, useState, type ReactNode,
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

export function EditorConversation({ onClose }: { onClose: () => void }) {
  const conversation = useContext(Conversation);
  if (!conversation) return null;
  return (
    <section
      aria-label="Adventure conversation"
      className="flex h-56 xl:h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-surface border border-line bg-surface p-4"
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Edit with chat</h2>
        <button type="button" onClick={onClose} aria-label="Close chat" className="text-sm text-muted underline underline-offset-4 hover:text-ink">Close</button>
      </div>
      <V3BriefChat
        initial={conversation.brief}
        active={false}
        compact
        onStateChange={conversation.update}
      />
    </section>
  );
}
