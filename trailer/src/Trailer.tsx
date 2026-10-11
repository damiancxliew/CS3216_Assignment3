import type React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile } from "remotion";
import { TransitionSeries } from "@remotion/transitions";
import { SceneFade, WipTag } from "./components";
import {
  AnyLesson, CChoose, CDefend, CDisagree, CPeople, CReal, CShare, CSources, Chatbots, Choose, Close, Compare, Context, Establish, Explain, Here, Montage, Open, Question, Rapid, Rarely, Read, Reading, Reveal, Shape, ClassView, Share, Upload,
} from "./scenes";
import { TRANSITIONS, TRANSITION_FRAMES, type TransitionName } from "./transitions";

/** 120 BPM: one beat is 15 frames, so every cut lands on the music. */
const BEAT = 15;
type Into = TransitionName | "cut";

/**
 * The cut, in beats. Each scene starts on the beat; `into` is how it arrives (see transitions.tsx).
 * Lengths are set by content: roughly 0.3 s per word on screen, plus time to take in the frame.
 */
export const CUT: { name: string; beats: number; into: Into; Scene: () => React.ReactElement }[] = [
  { name: "Open", beats: 8, into: "cut", Scene: Open },
  { name: "Context", beats: 7, into: "iris", Scene: Context },
  { name: "Reading", beats: 5, into: "push", Scene: Reading },
  { name: "Chatbots", beats: 5, into: "wipe-top-right", Scene: Chatbots },
  { name: "Rarely", beats: 4, into: "blinds", Scene: Rarely },
  { name: "Here", beats: 4, into: "push", Scene: Here },
  { name: "Establish", beats: 6, into: "iris", Scene: Establish },
  { name: "CPeople", beats: 5, into: "slide-right", Scene: CPeople },
  { name: "Question", beats: 6, into: "cut", Scene: Question },
  { name: "CSources", beats: 5, into: "wipe-bottom-left", Scene: CSources },
  { name: "Read", beats: 6, into: "cut", Scene: Read },
  { name: "CDisagree", beats: 5, into: "blinds", Scene: CDisagree },
  { name: "Compare", beats: 6, into: "cut", Scene: Compare },
  { name: "CShare", beats: 5, into: "flip", Scene: CShare },
  { name: "Share", beats: 6, into: "cut", Scene: Share },
  { name: "CChoose", beats: 5, into: "clock", Scene: CChoose },
  { name: "Choose", beats: 6, into: "cut", Scene: Choose },
  { name: "CDefend", beats: 5, into: "slide-bottom", Scene: CDefend },
  { name: "Explain", beats: 8, into: "cut", Scene: Explain },
  { name: "CReal", beats: 5, into: "wipe-left", Scene: CReal },
  { name: "Reveal", beats: 8, into: "cut", Scene: Reveal },
  { name: "AnyLesson", beats: 4, into: "push", Scene: AnyLesson },
  { name: "Upload", beats: 10, into: "blinds", Scene: Upload },
  { name: "Shape", beats: 16, into: "slide-right", Scene: Shape },
  { name: "Montage", beats: 8, into: "iris", Scene: Montage },
  { name: "ClassView", beats: 8, into: "blinds", Scene: ClassView },
  { name: "Rapid", beats: 6, into: "wipe-top-right", Scene: Rapid },
  { name: "Close", beats: 12, into: "fade", Scene: Close },
];

const overlap = (into: Into) => (into === "cut" ? 0 : TRANSITION_FRAMES);
/** Grid start of each scene; the incoming transition begins exactly there. */
const gridStarts = CUT.map((_, i) => CUT.slice(0, i).reduce((a, c) => a + c.beats * BEAT, 0));
/** Sequence length = time on the grid + the overlap the next scene's transition eats. */
const lengths = CUT.map((c, i) => c.beats * BEAT + (i + 1 < CUT.length ? overlap(CUT[i + 1].into) : 0));
export const TOTAL_FRAMES = gridStarts[CUT.length - 1] + CUT[CUT.length - 1].beats * BEAT;
const at = (name: string) => gridStarts[CUT.findIndex((c) => c.name === name)];

/**
 * Sheets drawn as CSS backgrounds (tiles, walk cycles, fog). Remotion waits for <Img> but not for CSS backgrounds, so
 * rendering these invisibly on every frame stops a fresh render tab from capturing a half-drawn town.
 */
const PRELOAD = [
  "tiles/house.png", "tiles/floor.png", "fx/fog.png",
  ...["Villager", "Villager2", "Villager3", "Villager6", "Woman", "OldMan", "OldMan3", "Inspector", "Master", "Sultan"].map((c) => `characters/${c}/walk.png`),
];
const Preload = () => (
  <AbsoluteFill style={{ opacity: 0, pointerEvents: "none" }}>
    {PRELOAD.map((src) => <Img key={src} src={staticFile(src)} style={{ width: 1, height: 1 }} />)}
  </AbsoluteFill>
);

export const Trailer = () => (
  <AbsoluteFill style={{ background: "#0b0d12" }}>
    <Preload />
    <TransitionSeries>
      {CUT.flatMap(({ name, into, Scene }, i) => {
        const scene = (
          <TransitionSeries.Sequence key={name} name={name} durationInFrames={lengths[i]}>
            <SceneFade duration={lengths[i]} fadeIn={i === 0 ? 8 : 0} fadeOut={name === "Close" ? 20 : 0}>
              <Scene />
            </SceneFade>
          </TransitionSeries.Sequence>
        );
        if (i === 0 || into === "cut") return [scene];
        const t = TRANSITIONS[into];
        return [<TransitionSeries.Transition key={`${name}-in`} presentation={t.presentation} timing={t.timing} />, scene];
      })}
    </TransitionSeries>
    <Sequence from={at("Establish")} durationInFrames={at("Close") - at("Establish")} layout="none">
      <WipTag />
    </Sequence>
    <Audio src={staticFile("audio/upbeat.mp3")} volume={(f) => 0.8 * interpolate(f, [TOTAL_FRAMES - 40, TOTAL_FRAMES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
  </AbsoluteFill>
);
