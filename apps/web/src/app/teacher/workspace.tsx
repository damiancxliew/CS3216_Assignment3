"use client";

import { useState } from "react";

import { BriefChat } from "./brief-chat";
import type { BriefState } from "@/lib/brief/schema";

/**
 * The teacher home splits in two while there is no live brief: existing
 * adventures on the left, the brief chat on the right. Once the conversation
 * is underway the list is dead space, so the chat takes the full width until
 * the brief is discarded or finished.
 */
export function TeacherWorkspace({ adventures, resume }: { adventures: React.ReactNode; resume?: BriefState }) {
  const [composing, setComposing] = useState(false);

  return (
    <div
      className={
        composing
          ? "flex min-h-0 flex-1 flex-col"
          : "grid gap-12 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16"
      }
    >
      <section className={composing ? "hidden" : "flex flex-col gap-4 lg:max-h-full lg:overflow-y-auto"}>
        {adventures}
      </section>
      <section
        className={`flex min-h-0 flex-col gap-5 rounded-surface border border-line bg-surface p-6 lg:max-h-full lg:overflow-y-auto ${
          composing ? "mx-auto w-full max-w-4xl flex-1" : ""
        }`}
      >
        <h2 className="font-serif text-2xl text-ink">New adventure</h2>
        <BriefChat resume={resume} onComposingChange={setComposing} />
      </section>
    </div>
  );
}
