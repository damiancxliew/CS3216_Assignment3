import type React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { WIPE_FRAMES } from "./pitch";
import { SceneFade, WipTag } from "./components";
import {
  Choose, Close, Compare, Establish, Explain, Neither, Open, PChoose, PDefend, PDisagree, PPeople, PReal, PShare, PSources, Problem, Question, Rapid, Read, Reveal, Share,
} from "./scenes";
import { s } from "./theme";

type Kind = "type" | "pitch" | "game";

/** The cut: pitch claims interleaved with gameplay proof. Change seconds here to retime. */
export const CUT: { name: string; seconds: number; kind: Kind; Scene: () => React.ReactElement }[] = [
  { name: "Open", seconds: 3.6, kind: "type", Scene: Open },
  { name: "Problem", seconds: 3.3, kind: "pitch", Scene: Problem },
  { name: "Neither", seconds: 2.7, kind: "pitch", Scene: Neither },
  { name: "Establish", seconds: 3.0, kind: "game", Scene: Establish },
  { name: "PPeople", seconds: 1.8, kind: "pitch", Scene: PPeople },
  { name: "Question", seconds: 3.4, kind: "game", Scene: Question },
  { name: "PSources", seconds: 1.8, kind: "pitch", Scene: PSources },
  { name: "Read", seconds: 3.4, kind: "game", Scene: Read },
  { name: "PDisagree", seconds: 1.6, kind: "pitch", Scene: PDisagree },
  { name: "Compare", seconds: 3.4, kind: "game", Scene: Compare },
  { name: "PShare", seconds: 1.8, kind: "pitch", Scene: PShare },
  { name: "Share", seconds: 3.0, kind: "game", Scene: Share },
  { name: "PChoose", seconds: 1.8, kind: "pitch", Scene: PChoose },
  { name: "Choose", seconds: 3.2, kind: "game", Scene: Choose },
  { name: "PDefend", seconds: 1.8, kind: "pitch", Scene: PDefend },
  { name: "Explain", seconds: 3.6, kind: "game", Scene: Explain },
  { name: "PReal", seconds: 1.8, kind: "pitch", Scene: PReal },
  { name: "Reveal", seconds: 3.6, kind: "game", Scene: Reveal },
  { name: "Rapid", seconds: 3.2, kind: "pitch", Scene: Rapid },
  { name: "Close", seconds: 6.4, kind: "type", Scene: Close },
];

const lengths = CUT.map((c) => s(c.seconds));

/** Transition into each scene: pitch cards slide in over the last shot; game beats and the close fade in. */
const transitionInto = (kind: Kind) =>
  kind === "pitch"
    ? { presentation: slide({ direction: "from-right" }), timing: springTiming({ config: { damping: 200 }, durationInFrames: WIPE_FRAMES }), frames: WIPE_FRAMES }
    : { presentation: fade(), timing: linearTiming({ durationInFrames: kind === "type" ? 10 : 6 }), frames: kind === "type" ? 10 : 6 };
const overlaps = CUT.map((c, i) => (i === 0 ? 0 : transitionInto(c.kind).frames));
const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0) - overlaps.slice(0, i + 1).reduce((a, b) => a + b, 0));
export const TOTAL_FRAMES = starts[CUT.length - 1] + lengths[CUT.length - 1];

/** When the title card appears inside "Close" (see scenes.tsx). */
const TITLE_AT = starts[CUT.length - 1] + 84;
const BED_FROM = starts[1];

/** Per-frame mix targets: clear bed on game beats and the title card, muffled on pitch beats. */
const mix = (() => {
  const clear = new Float32Array(TOTAL_FRAMES);
  const muffled = new Float32Array(TOTAL_FRAMES);
  CUT.forEach((c, i) => {
    for (let f = starts[i]; f < Math.min(TOTAL_FRAMES, starts[i] + lengths[i]); f++) {
      if (c.kind === "game") { clear[f] = 1; muffled[f] = 0; }
      if (c.kind === "pitch") { muffled[f] = 1; clear[f] = 0; }
      if (c.name === "Close") { clear[f] = f >= TITLE_AT ? 1 : 0; muffled[f] = f >= TITLE_AT ? 0 : 0.55; }
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
    <TransitionSeries>
      {CUT.flatMap(({ name, seconds, kind, Scene }, i) => {
        const scene = (
          <TransitionSeries.Sequence key={name} name={name} durationInFrames={s(seconds)}>
            <SceneFade duration={s(seconds)} fadeIn={i === 0 ? 8 : 0.001} fadeOut={name === "Close" ? 20 : 0.001}>
              <Scene />
            </SceneFade>
          </TransitionSeries.Sequence>
        );
        if (i === 0) return [scene];
        const t = transitionInto(kind);
        return [<TransitionSeries.Transition key={`${name}-in`} presentation={t.presentation} timing={t.timing} />, scene];
      })}
    </TransitionSeries>
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
