"use client";

import { useState } from "react";
import { BookOpen, Compass, Flag, Sparkles } from "lucide-react";

import { BriefChat } from "./brief-chat";
import type { BriefState } from "@/lib/brief/schema";

/**
 * The teacher home, while there is no live brief. With nothing built yet the
 * brief is the whole point of the page, so it stands as a large card beside
 * the empty list. Once adventures exist they are what the teacher came back
 * for: the brief shrinks to a slim banner above them and the grid takes the
 * full width. Once the conversation is underway the list is dead space, so
 * the chat leaves its card and takes over the whole viewport as a full-screen
 * focus surface until the brief is discarded or finished.
 *
 * The three layouts share one tree so the chat keeps its place (and its
 * state) when it moves between them; only class names and decoration change.
 */
export function TeacherWorkspace({
  adventures,
  hasAdventures,
  resume,
}: {
  adventures: React.ReactNode;
  hasAdventures: boolean;
  resume?: BriefState;
}) {
  const [composing, setComposing] = useState(false);
  const banner = hasAdventures && !composing;

  return (
    <div
      className={
        composing
          ? "fixed inset-0 z-40 flex flex-col bg-paper"
          : banner
            ? "flex flex-col gap-10"
            : "grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:items-start"
      }
    >
      <section className={composing ? "hidden" : "min-w-0"}>{adventures}</section>
      <section
        className={
          composing
            ? "mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 py-5 sm:px-8"
            : banner
              ? "game-shadow order-first flex flex-col gap-5 rounded-surface border-2 border-ink bg-signal-wash p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6"
              : "game-shadow relative flex min-w-0 flex-col gap-5 overflow-hidden rounded-surface border-2 border-ink bg-signal-wash p-6 lg:sticky lg:top-8"
        }
      >
        {composing ? null : banner ? (
          <>
            <div className="game-grid hidden h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-2 border-ink/10 sm:flex" aria-hidden="true">
              <div className="sticker rounded-xl border-2 border-ink bg-surface p-2.5"><Compass className="h-8 w-8 text-signal" strokeWidth={1.5} /></div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Create a new quest</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-ink">The next chapter starts with you.</h2>
              <p className="mt-1 text-base text-muted">Bring the reading your students will play from. The rest is a few short questions.</p>
            </div>
          </>
        ) : (
          <>
            <div className="game-grid relative -mx-6 -mt-6 flex h-40 items-center justify-center border-b-2 border-ink/10" aria-hidden="true">
              <div className="absolute h-28 w-28 rounded-full border border-signal/25" />
              <div className="absolute h-36 w-36 rounded-full border border-signal/15" />
              <div className="sticker rounded-2xl border-2 border-ink bg-surface p-5"><Compass className="h-12 w-12 text-signal" strokeWidth={1.5} /></div>
              <span className="absolute left-8 top-7 -rotate-12 rounded-xl border-2 border-ink bg-sunshine p-2.5 shadow-sm"><BookOpen className="h-5 w-5 text-ink" /></span>
              <span className="absolute bottom-6 right-8 rotate-12 rounded-xl border-2 border-ink bg-world-wash p-2.5 shadow-sm"><Flag className="h-5 w-5 text-world" /></span>
              <Sparkles className="absolute right-8 top-6 h-5 w-5 text-signal" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Create a new quest</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-ink">The next chapter starts with you.</h2>
            </div>
          </>
        )}
        <div className={banner ? "shrink-0" : "contents"}>
          <BriefChat resume={resume} compact={hasAdventures} onComposingChange={setComposing} />
        </div>
      </section>
    </div>
  );
}
