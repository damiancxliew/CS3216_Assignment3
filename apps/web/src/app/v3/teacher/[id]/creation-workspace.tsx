"use client";

import { useState, type ReactNode } from "react";
import {
  timerLabel,
  sourcePolicyLabel,
  type BriefStateV3,
} from "@/lib/v3/brief/schema";
import { Thinking } from "@/components/ui";
import { V3BriefChat } from "./brief-chat";
import { ReviewChatProvider } from "./review-chat-context";

/** The same two panes survive every refresh from briefing through review. */
export function CreationWorkspace({
  brief,
  active,
  statusMessage,
  generating,
  complete = false,
  children,
}: {
  brief: BriefStateV3;
  active: boolean;
  statusMessage: string;
  generating: boolean;
  complete?: boolean;
  children: ReactNode;
}) {
  const [liveBrief, setLiveBrief] = useState(brief);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const starting = active && startingGeneration;
  return (
    <ReviewChatProvider>
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-col md:h-full md:min-h-0 px-4 pb-5 pt-4 sm:px-6 lg:px-8"
        data-creation-workspace
      >
        <header className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            {brief.draft.episode ?? "New adventure"}
          </h1>
          <span className="shrink-0 rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-muted">
            {generating || starting
              ? "Creating"
              : active
                ? "The brief"
                : complete
                  ? "Ready"
                  : "Review"}
          </span>
        </header>
        <div className="grid min-h-0 gap-5 md:flex-1 md:min-h-0 md:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.35fr)]">
          <section
            aria-label="Adventure conversation"
            className="game-shadow flex h-[28rem] min-h-[24rem] min-w-0 flex-col rounded-surface border-2 border-ink bg-surface p-4 md:h-full md:min-h-0 sm:p-5"
          >
            <V3BriefChat
              initial={brief}
              active={active}
              statusMessage={statusMessage}
              generating={generating || starting}
              onStateChange={setLiveBrief}
              onGenerationStart={() => setStartingGeneration(true)}
              onGenerationError={() => setStartingGeneration(false)}
            />
          </section>
          <section
            aria-label="Generated content"
            data-generated-content
            className="block min-h-0 min-w-0 space-y-5 pb-24 md:overflow-y-auto md:overscroll-contain md:px-2 [scrollbar-gutter:stable] [overflow-wrap:anywhere]"
          >
            {active ? (
              <>
                <BriefOverview brief={liveBrief} />
                {startingGeneration ? (
                  <section
                    aria-label="Generation progress"
                    className="creation-card rounded-surface border border-line-strong bg-surface p-5"
                  >
                    <Thinking label="Preparing your adventure…" />
                  </section>
                ) : null}
              </>
            ) : (
              children
            )}
          </section>
        </div>
      </div>
    </ReviewChatProvider>
  );
}

function BriefOverview({ brief }: { brief: BriefStateV3 }) {
  const rows = [
    ["Episode", brief.draft.episode],
    [
      "Focus",
      brief.draft.focus === "" ? "No additional guidance" : brief.draft.focus,
    ],
    [
      "Timer",
      brief.draft.timerMinutes !== undefined
        ? timerLabel(brief.draft.timerMinutes)
        : undefined,
    ],
    [
      "Outside sources",
      brief.draft.sourcePolicy !== undefined
        ? sourcePolicyLabel(brief.draft.sourcePolicy ?? undefined)
        : undefined,
    ],
    [
      "Reading level",
      brief.draft.readingLevel === "sec"
        ? "Secondary"
        : brief.draft.readingLevel === "jc"
          ? "Junior college"
          : undefined,
    ],
    [
      "Generation",
      brief.draft.mode
        ? brief.draft.mode[0].toUpperCase() + brief.draft.mode.slice(1)
        : undefined,
    ],
  ].filter((row): row is [string, string] => row[1] !== undefined);
  return (
    <section className="creation-card rounded-surface border-2 border-ink bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-extrabold tracking-tight">The brief</h2>
      {brief.sources.length ? (
        <div className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            Source material
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {brief.sources.map((source) => (
              <li key={source.id}>{source.title}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {rows.length ? (
        <dl className="mt-5 divide-y divide-line">
          {rows.map(([label, value]) => (
            <div key={label} className="py-3">
              <dt className="text-xs font-semibold text-muted">{label}</dt>
              <dd className="mt-1 text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-6 text-sm text-muted">
          Start by adding the material your students will work from.
        </p>
      )}
    </section>
  );
}
