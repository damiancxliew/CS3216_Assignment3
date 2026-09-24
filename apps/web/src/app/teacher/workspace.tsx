"use client";

import { useState } from "react";

import { BriefChat } from "./brief-chat";
import type { BriefState } from "@/lib/brief/schema";

/**
 * The teacher home splits in two while there is no live brief: existing
 * adventures on the left, the brief chat on the right. Once the conversation
 * is underway the list is dead space, so the chat leaves the card and takes
 * over the whole viewport as a full-screen focus surface until the brief is
 * discarded or finished.
 */
export function TeacherWorkspace({ adventures, resume }: { adventures: React.ReactNode; resume?: BriefState }) {
  const [composing, setComposing] = useState(false);

  return (
    <div
      className={
        composing
          ? "fixed inset-0 z-40 flex flex-col bg-paper"
          : "grid gap-12 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16"
      }
    >
      <section className={composing ? "hidden" : "flex flex-col gap-4 lg:max-h-full lg:overflow-y-auto"}>{adventures}</section>
      <section
        className={
          composing
            ? "mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 py-5 sm:px-8"
            : "game-shadow flex min-h-0 flex-col gap-5 rounded-surface border-2 border-ink bg-signal-wash p-6 lg:max-h-full"
        }
      >
        {composing ? null : (
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Create a new quest</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-ink">What should students step into?</h2>
          </div>
        )}
        <BriefChat resume={resume} onComposingChange={setComposing} />
      </section>
    </div>
  );
}
