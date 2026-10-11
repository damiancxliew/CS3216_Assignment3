import type React from "react";
import { AbsoluteFill, Audio, Sequence, Series, staticFile } from "remotion";
import { SceneFade, WipTag } from "./components";
import {
  Choose, Close, Compare, Establish, Explain, Neither, Open, PChoose, PDefend, PDisagree, PPeople, PReal, PShare, PSources, Problem, Question, Rapid, Read, Reveal, Share,
} from "./scenes";
import { s } from "./theme";

type Kind = "type" | "pitch" | "game";

/** The cut: pitch claims interleaved with gameplay proof. Change seconds here to retime. */
export const CUT: { name: string; seconds: number; kind: Kind; Scene: () => React.ReactElement }[] = [
  { name: "Open", seconds: 3.6, kind: "type", Scene: Open },
  { name: "Problem", seconds: 3.0, kind: "pitch", Scene: Problem },
  { name: "Neither", seconds: 2.4, kind: "pitch", Scene: Neither },
  { name: "Establish", seconds: 3.0, kind: "game", Scene: Establish },
  { name: "PPeople", seconds: 1.5, kind: "pitch", Scene: PPeople },
  { name: "Question", seconds: 3.4, kind: "game", Scene: Question },
  { name: "PSources", seconds: 1.5, kind: "pitch", Scene: PSources },
  { name: "Read", seconds: 3.4, kind: "game", Scene: Read },
  { name: "PDisagree", seconds: 1.3, kind: "pitch", Scene: PDisagree },
  { name: "Compare", seconds: 3.4, kind: "game", Scene: Compare },
  { name: "PShare", seconds: 1.5, kind: "pitch", Scene: PShare },
  { name: "Share", seconds: 3.0, kind: "game", Scene: Share },
  { name: "PChoose", seconds: 1.5, kind: "pitch", Scene: PChoose },
  { name: "Choose", seconds: 3.2, kind: "game", Scene: Choose },
  { name: "PDefend", seconds: 1.5, kind: "pitch", Scene: PDefend },
  { name: "Explain", seconds: 3.6, kind: "game", Scene: Explain },
  { name: "PReal", seconds: 1.5, kind: "pitch", Scene: PReal },
  { name: "Reveal", seconds: 3.6, kind: "game", Scene: Reveal },
  { name: "Rapid", seconds: 3.2, kind: "pitch", Scene: Rapid },
  { name: "Close", seconds: 6.4, kind: "type", Scene: Close },
];

const lengths = CUT.map((c) => s(c.seconds));
export const TOTAL_FRAMES = lengths.reduce((a, b) => a + b, 0);
const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

/** When the title card appears inside "Close" (see scenes.tsx). */
const TITLE_AT = starts[CUT.length - 1] + 84;
const BED_FROM = starts[1];

/** Per-frame mix targets: clear bed on game beats and the title card, muffled on pitch beats. */
const mix = (() => {
  const clear = new Float32Array(TOTAL_FRAMES);
  const muffled = new Float32Array(TOTAL_FRAMES);
  CUT.forEach((c, i) => {
    for (let f = starts[i]; f < starts[i] + lengths[i]; f++) {
      if (c.kind === "game") clear[f] = 1;
      if (c.kind === "pitch") muffled[f] = 1;
      if (c.name === "Close") (f >= TITLE_AT ? clear : muffled)[f] = f >= TITLE_AT ? 1 : 0.55;
    }
  });
  const smooth = (a: Float32Array, w = 5) => a.map((_, f) => {
    let sum = 0;
    let n = 0;
    for (let k = f - w; k <= f + w; k++) if (k >= 0 && k < a.length) { sum += a[k]; n++; }
    return sum / n;
  });
  const fadeOut = (f: number) => Math.min(1, Math.max(0, (TOTAL_FRAMES - f) / 45));
  const fadeIn = (f: number) => Math.min(1, Math.max(0, (f - BED_FROM) / 12));
  const c = smooth(clear);
  const m = smooth(muffled);
  return {
    clear: (f: number) => 0.55 * c[f] * fadeOut(f) * fadeIn(f),
    muffled: (f: number) => 0.75 * m[f] * fadeOut(f) * fadeIn(f),
  };
})();

export const Trailer = () => (
  <AbsoluteFill style={{ background: "#0b0d12" }}>
    <Series>
      {CUT.map(({ name, seconds, kind, Scene }) => (
        <Series.Sequence key={name} name={name} durationInFrames={s(seconds)}>
          <SceneFade duration={s(seconds)} fadeIn={kind === "pitch" ? 0.001 : kind === "type" ? 8 : 3} fadeOut={name === "Close" ? 20 : 0.001}>
            <Scene />
          </SceneFade>
        </Series.Sequence>
      ))}
    </Series>
    <Sequence from={starts[3]} durationInFrames={starts[CUT.length - 1] - starts[3]} layout="none">
      <WipTag />
    </Sequence>
    {/* Both versions start together so they stay in sync; only their volumes change. */}
    <Sequence from={BED_FROM} layout="none">
      <Audio src={staticFile("audio/lofi.mp3")} volume={(f) => mix.clear(f + BED_FROM)} />
      <Audio src={staticFile("audio/lofi-muffled.mp3")} volume={(f) => mix.muffled(f + BED_FROM)} />
    </Sequence>
  </AbsoluteFill>
);
