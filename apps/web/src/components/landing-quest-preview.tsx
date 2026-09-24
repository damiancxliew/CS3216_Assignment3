"use client";

import { ArrowDown, ArrowRight, BookOpen, Check, Clock3, FileText, Footprints, MapPin, MessageCircle, Store, Users } from "lucide-react";
import { useId, useState } from "react";

const places = [
  { name: "Harbour", icon: MapPin, clue: "A ship’s cargo list", detail: "Find out what traders brought to port." },
  { name: "Bazaar", icon: Store, clue: "A merchant’s account", detail: "Hear how trade rules affect a livelihood." },
  { name: "Office", icon: FileText, clue: "A draft agreement", detail: "Read the terms before taking a side." },
] as const;

function WorldPreview() {
  const [selected, setSelected] = useState(0);
  const detailId = useId();

  return (
    <>
      <p className="text-sm font-bold text-muted">Pick a place. Follow a clue.</p>
      <div className="relative my-6 grid grid-cols-3 gap-2">
        <div className="absolute left-[16%] right-[16%] top-7 border-t-[3px] border-dashed border-world/40" aria-hidden />
        {places.map((place, index) => {
          const Icon = place.icon;
          return (
            <button key={place.name} type="button" aria-pressed={selected === index} aria-controls={detailId} onClick={() => setSelected(index)} className="relative flex min-w-0 flex-col items-center gap-2 rounded-lg py-1 text-sm font-bold">
              <span className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-ink transition-colors ${selected === index ? "bg-world text-white shadow-[0_4px_0_var(--ink)]" : "bg-surface text-ink hover:bg-world-wash"}`}><Icon className="h-6 w-6" aria-hidden /></span>
              {place.name}
            </button>
          );
        })}
      </div>
      <div id={detailId} aria-live="polite" aria-atomic="true" className="mt-auto rounded-2xl border-2 border-world/25 bg-surface p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-bold text-world"><Footprints className="h-4 w-4" aria-hidden /> Found at the {places[selected].name.toLowerCase()}</p>
        <p className="text-xl font-black tracking-tight">{places[selected].clue}</p>
        <p className="mt-1 text-base text-muted">{places[selected].detail}</p>
      </div>
    </>
  );
}

function DialoguePreview() {
  return (
    <>
      <p className="text-sm font-bold text-muted">Same port. Different priorities.</p>
      <div className="mt-4 space-y-3">
        <div className="mr-5 rounded-2xl rounded-bl-sm border-2 border-record/25 bg-surface p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-record"><Store className="h-4 w-4" aria-hidden /> The merchant</p>
          <p className="text-lg font-bold leading-snug">“Open the port. My trade depends on it.”</p>
        </div>
        <div className="ml-5 rounded-2xl rounded-br-sm border-2 border-ink bg-ink p-4 text-paper">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-[#ffe66d]"><Users className="h-4 w-4" aria-hidden /> The local ruler</p>
          <p className="text-lg font-bold leading-snug">“And who will control what happens here?”</p>
        </div>
      </div>
      <p className="mt-auto flex items-center gap-2 pt-4 text-base font-bold"><MessageCircle className="h-5 w-5 shrink-0 text-record" aria-hidden /> Whose interests does each account serve?</p>
    </>
  );
}

const choices = [
  { title: "Commit now", result: "You move the negotiation forward, with gaps in your evidence." },
  { title: "Keep investigating", result: "You seek another perspective, with less time left to negotiate." },
] as const;

function DecisionPreview() {
  const [selected, setSelected] = useState<number | null>(null);
  const resultId = useId();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-muted">The agreement is waiting.</p>
        <span className="flex items-center gap-1.5 rounded-full border border-ink/20 bg-surface px-3 py-1 text-base font-black tabular-nums"><Clock3 className="h-4 w-4" aria-hidden /> 00:45</span>
      </div>
      <p className="mt-5 text-2xl font-black tracking-tight">Enough evidence to take a side?</p>
      <div className="my-4 flex flex-wrap gap-2">
        {choices.map((choice, index) => (
          <button key={choice.title} type="button" aria-pressed={selected === index} aria-controls={resultId} onClick={() => setSelected(index)} className={`flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink px-4 py-2 text-base font-bold transition-colors ${selected === index ? "bg-ink text-paper" : "bg-surface hover:bg-[#ffe66d]"}`}>
            {choice.title}{selected === index ? <Check className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
          </button>
        ))}
      </div>
      <div id={resultId} aria-live="polite" aria-atomic="true" className="mt-auto rounded-2xl border-2 border-ink/15 bg-surface p-4">
        <p className="mb-1 text-sm font-bold text-muted">{selected === null ? "Try a choice" : "The trade-off"}</p>
        <p className="text-base font-semibold">{selected === null ? "More evidence takes time. Acting sooner means knowing less." : choices[selected].result}</p>
      </div>
    </>
  );
}

function DebriefPreview() {
  return (
    <>
      <p className="text-sm font-bold text-muted">After the choice, check the story.</p>
      <div className="mt-4 overflow-hidden rounded-2xl border-2 border-ink/20 bg-surface">
        <div className="border-b border-ink/15 p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-black text-record"><BookOpen className="h-5 w-5" aria-hidden /> Documented history</p>
          <p className="text-lg font-bold leading-snug">What the agreement actually says.</p>
          <p className="mt-1 text-base text-muted">Trace the claim to your source material.</p>
        </div>
        <div className="bg-world-wash/50 p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-black text-world"><MessageCircle className="h-5 w-5" aria-hidden /> Simulated dialogue</p>
          <p className="text-lg font-bold leading-snug">What a character might have said.</p>
          <p className="mt-1 text-base text-muted">Part of the story, not a historical quote.</p>
        </div>
      </div>
      <p className="mt-auto flex items-center gap-2 pt-4 text-base font-bold"><ArrowDown className="h-5 w-5 shrink-0 text-[#7140ac]" aria-hidden /> Leave with an argument you can support.</p>
    </>
  );
}

export function LandingQuestPreview({ quest }: { quest: "01" | "02" | "03" | "04" }) {
  return (
    <div className="game-grid flex h-full flex-col rounded-[1rem] border-2 border-ink/15 bg-surface/45 p-4 sm:p-5">
      {quest === "01" ? <WorldPreview /> : quest === "02" ? <DialoguePreview /> : quest === "03" ? <DecisionPreview /> : <DebriefPreview />}
    </div>
  );
}
