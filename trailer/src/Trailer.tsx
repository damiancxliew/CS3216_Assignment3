import type React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { WIPE_FRAMES } from "./pitch";
import { SceneFade, WipTag } from "./components";
import {
  CChoose, CDefend, CDisagree, CPeople, CReal, CShare, CSources, Chatbots, Choose, Close, Compare, Context, Establish, Explain, Here, Open, Question, Rapid, Rarely, Read, Reading, Reveal, Share,
} from "./scenes";

/** 120 BPM: one beat is 15 frames, so every cut lands on the music. */
const BEAT = 15;
type Into = "slide" | "fade" | "cut";

/** The cut, in beats. Each scene starts on the beat; `into` is how it arrives. */
export const CUT: { name: string; beats: number; into: Into; Scene: () => React.ReactElement }[] = [
  { name: "Open", beats: 8, into: "cut", Scene: Open },
  { name: "Context", beats: 8, into: "slide", Scene: Context },
  { name: "Reading", beats: 6, into: "slide", Scene: Reading },
  { name: "Chatbots", beats: 6, into: "slide", Scene: Chatbots },
  { name: "Rarely", beats: 6, into: "slide", Scene: Rarely },
  { name: "Here", beats: 4, into: "slide", Scene: Here },
  { name: "Establish", beats: 6, into: "fade", Scene: Establish },
  { name: "CPeople", beats: 4, into: "slide", Scene: CPeople },
  { name: "Question", beats: 6, into: "cut", Scene: Question },
  { name: "CSources", beats: 4, into: "slide", Scene: CSources },
  { name: "Read", beats: 6, into: "cut", Scene: Read },
  { name: "CDisagree", beats: 4, into: "slide", Scene: CDisagree },
  { name: "Compare", beats: 6, into: "cut", Scene: Compare },
  { name: "CShare", beats: 4, into: "slide", Scene: CShare },
  { name: "Share", beats: 6, into: "cut", Scene: Share },
  { name: "CChoose", beats: 4, into: "slide", Scene: CChoose },
  { name: "Choose", beats: 6, into: "cut", Scene: Choose },
  { name: "CDefend", beats: 4, into: "slide", Scene: CDefend },
  { name: "Explain", beats: 6, into: "cut", Scene: Explain },
  { name: "CReal", beats: 4, into: "slide", Scene: CReal },
  { name: "Reveal", beats: 8, into: "cut", Scene: Reveal },
  { name: "Rapid", beats: 8, into: "slide", Scene: Rapid },
  { name: "Close", beats: 12, into: "fade", Scene: Close },
];

const overlap = (into: Into) => (into === "slide" ? WIPE_FRAMES : into === "fade" ? 8 : 0);
/** Grid start of each scene; the incoming transition begins exactly there. */
const gridStarts = CUT.map((_, i) => CUT.slice(0, i).reduce((a, c) => a + c.beats * BEAT, 0));
/** Sequence length = time on the grid + the overlap the next scene's transition eats. */
const lengths = CUT.map((c, i) => c.beats * BEAT + (i + 1 < CUT.length ? overlap(CUT[i + 1].into) : 0));
export const TOTAL_FRAMES = gridStarts[CUT.length - 1] + CUT[CUT.length - 1].beats * BEAT;

const transition = (into: Into) =>
  into === "slide"
    ? { presentation: slide({ direction: "from-right" }), timing: springTiming({ config: { damping: 200 }, durationInFrames: WIPE_FRAMES }) }
    : { presentation: fade(), timing: linearTiming({ durationInFrames: overlap(into) }) };

export const Trailer = () => (
  <AbsoluteFill style={{ background: "#0b0d12" }}>
    <TransitionSeries>
      {CUT.flatMap(({ name, into, Scene }, i) => {
        const scene = (
          <TransitionSeries.Sequence key={name} name={name} durationInFrames={lengths[i]}>
            <SceneFade duration={lengths[i]} fadeIn={i === 0 ? 8 : 0.001} fadeOut={name === "Close" ? 20 : 0.001}>
              <Scene />
            </SceneFade>
          </TransitionSeries.Sequence>
        );
        if (i === 0 || into === "cut") return [scene];
        const t = transition(into);
        return [<TransitionSeries.Transition key={`${name}-in`} presentation={t.presentation} timing={t.timing} />, scene];
      })}
    </TransitionSeries>
    <Sequence from={gridStarts[CUT.findIndex((c) => c.name === "Establish")]} durationInFrames={gridStarts[CUT.length - 1] - gridStarts[CUT.findIndex((c) => c.name === "Establish")]} layout="none">
      <WipTag />
    </Sequence>
    <Audio src={staticFile("audio/upbeat.mp3")} volume={(f) => 0.8 * interpolate(f, [TOTAL_FRAMES - 40, TOTAL_FRAMES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
  </AbsoluteFill>
);
