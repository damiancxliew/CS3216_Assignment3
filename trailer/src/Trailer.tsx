import type React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile } from "remotion";
import { TransitionSeries } from "@remotion/transitions";
import { SceneFade, WipTag } from "./components";
import {
  AnyLesson, CChoose, CDefend, CDisagree, CPeople, CReal, CShare, CSources, Chatbots, Choose, Close, Compare, Context, Establish, Explain, Here, Montage, Open, Question, Rapid, Rarely, Read, Reading, Reveal, Easy, Ask, ClassView, Share,
} from "./scenes";
import { TRANSITIONS, TRANSITION_FRAMES, type TransitionName } from "./transitions";
import { pitch } from "./episode";
import voice from "./voice.json";

/** 120 BPM: one beat is 15 frames, so every cut lands on the music. */
const BEAT = 15;
type Into = TransitionName | "cut";

/**
 * How long a text card stays up, in beats: 0.6 s to register, 0.04 s per character (about 25 characters a second),
 * plus any extra seconds for something else to look at, rounded to the nearest beat.
 */
const read = (lines: string[], extraSeconds = 0) => {
  const chars = lines.join(" ").replace(/\*/g, "").length;
  return Math.max(3, Math.round((0.6 + 0.04 * chars + extraSeconds) * 2));
};
/** Claim cards also carry a label and end with a half-second zoom into the game. */
const claimBeats = (i: number) => read(pitch.skills[i].lines, 0.3 + 0.55);

/**
 * The cut, in beats. Each scene starts on the beat; `into` is how it arrives (see transitions.tsx).
 * Lengths are set by content: roughly 0.3 s per word on screen, plus time to take in the frame.
 */
const CUT_SPEC: { name: string; beats: number; into: Into; Scene: (props: { duration: number }) => React.ReactElement }[] = [
  { name: "Open", beats: 8, into: "cut", Scene: Open },
  { name: "Context", beats: read(pitch.context, 0.75), into: "iris", Scene: Context },
  { name: "Reading", beats: read(pitch.reading), into: "push", Scene: Reading },
  { name: "Chatbots", beats: read(pitch.chatbots), into: "wipe-top-right", Scene: Chatbots },
  { name: "Rarely", beats: read(pitch.rarely), into: "blinds", Scene: Rarely },
  { name: "Here", beats: read(pitch.here), into: "push", Scene: Here },
  { name: "Establish", beats: 6, into: "iris", Scene: Establish },
  { name: "CPeople", beats: claimBeats(0), into: "slide-right", Scene: CPeople },
  { name: "Question", beats: 6, into: "cut", Scene: Question },
  { name: "CSources", beats: claimBeats(1), into: "wipe-bottom-left", Scene: CSources },
  { name: "Read", beats: 6, into: "cut", Scene: Read },
  { name: "CDisagree", beats: claimBeats(2), into: "blinds", Scene: CDisagree },
  { name: "Compare", beats: 6, into: "cut", Scene: Compare },
  { name: "CShare", beats: claimBeats(3), into: "flip", Scene: CShare },
  { name: "Share", beats: 6, into: "cut", Scene: Share },
  { name: "CChoose", beats: claimBeats(4), into: "clock", Scene: CChoose },
  { name: "Choose", beats: 6, into: "cut", Scene: Choose },
  { name: "CDefend", beats: claimBeats(5), into: "slide-bottom", Scene: CDefend },
  { name: "Explain", beats: 8, into: "cut", Scene: Explain },
  { name: "CReal", beats: claimBeats(6), into: "wipe-left", Scene: CReal },
  { name: "Reveal", beats: 8, into: "cut", Scene: Reveal },
  { name: "AnyLesson", beats: read(pitch.anyLesson), into: "push", Scene: AnyLesson },
  { name: "Easy", beats: 14, into: "blinds", Scene: Easy },
  { name: "Ask", beats: 8, into: "slide-right", Scene: Ask },
  { name: "Montage", beats: 8, into: "iris", Scene: Montage },
  { name: "ClassView", beats: 8, into: "blinds", Scene: ClassView },
  { name: "Rapid", beats: 6, into: "wipe-top-right", Scene: Rapid },
  { name: "Close", beats: 12, into: "fade", Scene: Close },
];

/** Voiceover: which line plays in which shot, and how many frames into the shot it starts (scripts/make_voice.mjs). */
type VoiceId = keyof typeof voice.lengths;
const VOICE_CUES: Record<string, { id: VoiceId; at: number }[]> = {
  Context: [{ id: "context", at: 8 }],
  Reading: [{ id: "reading", at: 6 }],
  Chatbots: [{ id: "chatbots", at: 6 }],
  Rarely: [{ id: "rarely", at: 6 }],
  Here: [{ id: "here", at: 6 }],
  Establish: [{ id: "establish", at: 12 }],
  CPeople: [{ id: "skill1", at: 6 }],
  CSources: [{ id: "skill2", at: 6 }],
  CDisagree: [{ id: "skill3", at: 6 }],
  CShare: [{ id: "skill4", at: 6 }],
  CChoose: [{ id: "skill5", at: 6 }],
  CDefend: [{ id: "skill6", at: 6 }],
  CReal: [{ id: "skill7", at: 6 }],
  AnyLesson: [{ id: "anyLesson", at: 6 }],
  Easy: [{ id: "step1", at: 8 }, { id: "step2", at: 78 }, { id: "step3", at: 148 }],
  Ask: [{ id: "ask", at: 6 }],
  Montage: [{ id: "montage", at: 8 }],
  ClassView: [{ id: "classView", at: 6 }],
  Close: [{ id: "title", at: 58 }],
};
const voiceFrames = (id: VoiceId) => Math.ceil(voice.lengths[id] * 30);
/** A shot lasts at least as long as its last line plus a short breath, rounded up to the beat. */
const BREATH = 8;
const voiceBeats = (name: string) => Math.max(0, ...(VOICE_CUES[name] ?? []).map((c) => Math.ceil((c.at + voiceFrames(c.id) + BREATH) / BEAT)));

/** The close's typewriter, outro and final hit must start on a bar, so any spare beats go to the benefits shot. */
export const CUT = (() => {
  const timed = CUT_SPEC.map((c) => ({ ...c, beats: Math.max(c.beats, voiceBeats(c.name)) }));
  const beforeClose = timed.slice(0, -1).reduce((a, c) => a + c.beats, 0);
  const pad = (4 - (beforeClose % 4)) % 4;
  return timed.map((c) => (c.name === "Rapid" ? { ...c, beats: c.beats + pad } : c));
})();

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

/** Every voice clip at its absolute frame. */
const VOICE_CLIPS = CUT.flatMap((c, i) => (VOICE_CUES[c.name] ?? []).map((cue) => ({ id: cue.id, from: gridStarts[i] + cue.at })));
/** Music volume: full between lines, ducked under the voice with short ramps. */
const MUSIC = (() => {
  const duck = new Float32Array(TOTAL_FRAMES);
  for (const clip of VOICE_CLIPS) for (let f = clip.from - 4; f < clip.from + voiceFrames(clip.id) + 6 && f < TOTAL_FRAMES; f++) if (f >= 0) duck[f] = 1;
  const smooth = (f: number) => {
    let sum = 0;
    let n = 0;
    for (let k = f - 6; k <= f + 6; k++) if (k >= 0 && k < TOTAL_FRAMES) { sum += duck[k]; n++; }
    return sum / n;
  };
  return (f: number) => (0.58 - 0.4 * smooth(f)) * interpolate(f, [TOTAL_FRAMES - 40, TOTAL_FRAMES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
})();

export const Trailer = () => (
  <AbsoluteFill style={{ background: "#0b0d12" }}>
    <Preload />
    <TransitionSeries>
      {CUT.flatMap(({ name, into, Scene }, i) => {
        const scene = (
          <TransitionSeries.Sequence key={name} name={name} durationInFrames={lengths[i]}>
            <SceneFade duration={lengths[i]} fadeIn={i === 0 ? 8 : 0} fadeOut={name === "Close" ? 20 : 0}>
              <Scene duration={CUT[i].beats * BEAT} />
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
    <Audio src={staticFile("audio/upbeat.mp3")} volume={MUSIC} />
    {VOICE_CLIPS.map((clip) => (
      <Sequence key={`${clip.id}-${clip.from}`} from={clip.from} layout="none">
        <Audio src={staticFile(`voice/${clip.id}.mp3`)} volume={1} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
