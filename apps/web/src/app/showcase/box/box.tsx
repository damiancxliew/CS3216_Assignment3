"use client";

import { useSearchParams } from "next/navigation";

import { typewriterSlice } from "@/components/play/v3/dialogue-box";
import { SpeakerBox } from "@/components/play/v3/speaker-box";

const noop = () => {};

export function ShowcaseBox() {
  const params = useSearchParams();
  const speaker = params.get("speaker") ?? "Sam";
  const text = params.get("text") ?? "";
  const words = Number(params.get("words") ?? 999);
  const face = params.get("face");
  const shown = typewriterSlice(text, words);
  const done = shown === text;
  return (
    <main className="fixed inset-0" style={{ background: "transparent" }}>
      <style>{`
        html, body { background: transparent !important; }
        nextjs-portal { display: none !important; }
        ${face ? `section[aria-label$=" says"] .grid { background: url(${face}) center / cover no-repeat; image-rendering: pixelated; }
        section[aria-label$=" says"] .grid > span { visibility: hidden; }` : ""}
      `}</style>
      <div className="absolute inset-x-0 bottom-0 h-full" style={{ zoom: Number(params.get("zoom") ?? 1.5) }}>
        <SpeakerBox speaker={speaker} text={shown} done={done} continueLabel={done ? params.get("cont") ?? "Continue" : undefined} onAdvance={noop} />
      </div>
    </main>
  );
}
