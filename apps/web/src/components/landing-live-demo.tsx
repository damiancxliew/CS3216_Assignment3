"use client";

import { FileText, MessageCircle, MousePointerClick, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { MapCanvas } from "@/components/play/map-canvas";
import { button } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";

type Focus = { kind: "agent"; id: string } | { kind: "prop"; id: string } | null;

const NO_AUDIO = { muted: true, cues: [] };
const noop = () => {};

/**
 * The hero's "live adventure": the real map renderer on the demo adventure's first stage,
 * not a recording, so it can't go stale when the game changes. Walking is accepted locally;
 * characters and documents answer with their public text, and questioning them for real is
 * what the product does after sign-in.
 */
export function LandingLiveDemo({ onStage }: { onStage?: (stage: { index: number; count: number }) => void }) {
  const [state, setState] = useState<PlayState | null>(null);
  const [failed, setFailed] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/landing-demo")
      .then((response) => (response.ok ? (response.json() as Promise<PlayState>) : Promise.reject(new Error(String(response.status)))))
      .then((next) => {
        if (cancelled) return;
        setState(next);
        onStage?.({ index: next.stage.index, count: next.stageCount });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; };
  }, [onStage]);

  const agent = focus?.kind === "agent" ? state?.agents.find((candidate) => candidate.id === focus.id) : undefined;
  const prop = focus?.kind === "prop" ? state?.props.find((candidate) => candidate.id === focus.id) : undefined;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[1.15rem] bg-[#4f5d3a]">
      {state ? (
        <MapCanvas
          state={state}
          audio={NO_AUDIO}
          intent={null}
          onIntentDone={noop}
          onSteps={async (_from, path) => ({ position: path.at(-1) ?? null, accepted: true, retry: false })}
          onLocalPosition={noop}
          onTalk={(id) => setFocus({ kind: "agent", id })}
          onProp={(id) => setFocus({ kind: "prop", id })}
          onPickup={(id) => setFocus({ kind: "prop", id })}
          onLandmark={noop}
          keyboardScope="map"
          camera="overview"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-on-inverse/80">
          {failed ? "The live adventure couldn’t load here." : "Loading the live adventure…"}
        </div>
      )}

      {state && !focus ? (
        <p className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border-2 border-ink bg-surface/95 px-3 py-1 text-xs font-extrabold text-ink">
          <MousePointerClick className="h-4 w-4" aria-hidden /> Click to walk. Click someone to talk.
        </p>
      ) : null}

      {agent || prop ? (
        <div role="dialog" aria-label={agent?.name ?? prop?.name} className="absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2 overflow-y-auto rounded-2xl border-2 border-ink bg-surface p-4 text-ink shadow-[0_4px_0_var(--ink)] sm:inset-x-auto sm:right-3 sm:max-w-sm">
          <button type="button" onClick={() => setFocus(null)} className="absolute right-2 top-2 rounded-full p-1 text-muted hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </button>
          {agent ? (
            <>
              <p className="flex items-center gap-2 pr-6 text-base font-black leading-tight"><MessageCircle className="h-4 w-4 shrink-0 text-record" aria-hidden />{agent.name}</p>
              <p className="text-xs font-semibold text-muted">{agent.role}</p>
              <p className="text-sm leading-relaxed">“{agent.publicPosition}”</p>
              <p className="text-xs font-semibold text-muted">In class, students question {agent.name.split(" ").at(-1)} in their own words — and get an answer in character, from the sources.</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 pr-6 text-base font-black leading-tight"><FileText className="h-4 w-4 shrink-0 text-world" aria-hidden />{prop!.name}</p>
              <p className="text-sm leading-relaxed">A primary source lying where it would have been. Students walk to it and read the real text before they decide.</p>
            </>
          )}
          <Link href="/teacher" className={`${button.primary} self-start`}>Make one from your sources</Link>
        </div>
      ) : null}
    </div>
  );
}
