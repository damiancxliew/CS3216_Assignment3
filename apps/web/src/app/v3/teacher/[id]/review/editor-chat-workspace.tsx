"use client";

import type { ReactNode } from "react";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import { ReviewChatProvider } from "../review-chat-context";
import { V3BriefChat } from "../brief-chat";

export function EditorChatWorkspace({
  brief,
  children,
}: {
  brief: BriefStateV3;
  children: ReactNode;
}) {
  return (
    <ReviewChatProvider>
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,2fr)]">
        <section
          aria-label="Adventure conversation"
          className="flex h-[32rem] min-w-0 flex-col rounded-surface border border-line bg-surface p-4 sm:p-5 xl:sticky xl:top-4 xl:h-[calc(100dvh-8rem)]"
        >
          <h2 className="mb-3 text-lg font-bold">Edit with chat</h2>
          <V3BriefChat
            initial={brief}
            active={false}
            statusMessage="Ask for a change, review the suggestion, then apply it to your draft. Save and publish when you’re ready."
          />
        </section>
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </ReviewChatProvider>
  );
}
