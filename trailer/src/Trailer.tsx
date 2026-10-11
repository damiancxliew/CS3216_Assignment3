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

/**
 * The music: "Optimistic Corporate Technology" by RomanSenykMusic (Pixabay Content License), 80 BPM, 141 s.
 * Measured from the file: the groove's first downbeat is at 3.0 s, a quieter breakdown runs from about 67 s, the full
 * section returns on the downbeat at 99.0 s, and the last downbeat before the ending's decay is at 129.0 s.
 * The breakdown (and, if needed, whole bars before it) is cut so the track's ending lands on the title card.
 */
const TRACK = { file: "audio/optimistic-corporate-technology.mp3", bpm: 80, groove: 3.0, resume: 99.0, finalDownbeat: 129.0, bar: 3.0 };
/** The grid is the track's eighth notes (0.375 s), so every cut lands on its beat. */
const STEP_SECONDS = 60 / TRACK.bpm / 2;
const STEP = 30 * STEP_SECONDS;
const toSteps = (seconds: number) => Math.max(4, Math.round(seconds / STEP_SECONDS));
type Into = TransitionName | "cut";

/**
 * How long a text card stays up, in seconds: 0.6 s to register, 0.04 s per character (about 25 characters a second),
 * plus any extra seconds for something else to look at.
 */
const read = (lines: string[], extraSeconds = 0) => toSteps(0.6 + 0.04 * lines.join(" ").replace(/\*/g, "").length + extraSeconds);
/** Claim cards also carry a label and end with a half-second zoom into the game. */
const claimSteps = (i: number) => read(pitch.skills[i].lines, 0.3 + 0.55);

/**
 * The cut, in steps (eighth notes). Each scene starts on the grid; `into` is how it arrives (see transitions.tsx).
 * Lengths are set by content (reading time or the voice line, whichever is longer).
 */
const CUT_SPEC: { name: string; steps: number; into: Into; Scene: (props: { duration: number }) => React.ReactElement }[] = [
  { name: "Open", steps: 11, into: "cut", Scene: Open },
  { name: "Context", steps: read(pitch.context, 0.75), into: "iris", Scene: Context },
  { name: "Reading", steps: read(pitch.reading), into: "push", Scene: Reading },
  { name: "Chatbots", steps: read(pitch.chatbots), into: "wipe-top-right", Scene: Chatbots },
  { name: "Rarely", steps: read(pitch.rarely), into: "blinds", Scene: Rarely },
  { name: "Here", steps: read(pitch.here), into: "push", Scene: Here },
  { name: "Establish", steps: 8, into: "iris", Scene: Establish },
  { name: "CPeople", steps: claimSteps(0), into: "slide-right", Scene: CPeople },
  { name: "Question", steps: 8, into: "cut", Scene: Question },
  { name: "CSources", steps: claimSteps(1), into: "wipe-bottom-left", Scene: CSources },
  { name: "Read", steps: 8, into: "cut", Scene: Read },
  { name: "CDisagree", steps: claimSteps(2), into: "blinds", Scene: CDisagree },
  { name: "Compare", steps: 8, into: "cut", Scene: Compare },
  { name: "CShare", steps: claimSteps(3), into: "flip", Scene: CShare },
  { name: "Share", steps: 8, into: "cut", Scene: Share },
  { name: "CChoose", steps: claimSteps(4), into: "clock", Scene: CChoose },
  { name: "Choose", steps: 8, into: "cut", Scene: Choose },
  { name: "CDefend", steps: claimSteps(5), into: "slide-bottom", Scene: CDefend },
  { name: "Explain", steps: 11, into: "cut", Scene: Explain },
  { name: "CReal", steps: claimSteps(6), into: "wipe-left", Scene: CReal },
  { name: "Reveal", steps: 11, into: "cut", Scene: Reveal },
  { name: "AnyLesson", steps: read(pitch.anyLesson), into: "push", Scene: AnyLesson },
  { name: "Easy", steps: 19, into: "blinds", Scene: Easy },
  { name: "Ask", steps: 11, into: "slide-right", Scene: Ask },
  { name: "Montage", steps: 11, into: "iris", Scene: Montage },
  { name: "ClassView", steps: 11, into: "blinds", Scene: ClassView },
  { name: "Rapid", steps: 8, into: "wipe-top-right", Scene: Rapid },
  { name: "Close", steps: 16, into: "fade", Scene: Close },
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
/** A shot lasts at least as long as its last line plus a short breath, rounded up to the grid. */
const BREATH = 8;
const voiceSteps = (name: string) => Math.max(0, ...(VOICE_CUES[name] ?? []).map((c) => Math.ceil((c.at + voiceFrames(c.id) + BREATH) / STEP)));

/** Frames into the close at which the title card lands (see scenes.tsx): five steps, on the track's final downbeat. */
const TITLE_STEPS = 5;

/**
 * Fit the cut to the music. The track starts so that its groove's first downbeat meets the first pitch card; the
 * benefits shot is padded so the title card lands on the final downbeat of the (shortened) track.
 */
const fit = (() => {
  const timed = CUT_SPEC.map((c) => ({ ...c, steps: Math.max(c.steps, voiceSteps(c.name)) }));
  const stepsBefore = (name: string) => timed.slice(0, timed.findIndex((c) => c.name === name)).reduce((a, c) => a + c.steps, 0);
  const offset = stepsBefore("Context") * STEP_SECONDS - TRACK.groove;
  const naturalClose = stepsBefore("Close") * STEP_SECONDS;
  // Remove whole bars (the breakdown first) so the title card falls on the track's final downbeat, as early as possible.
  const slack = TRACK.finalDownbeat + offset - TITLE_STEPS * STEP_SECONDS - naturalClose;
  const removed = Math.floor(slack / TRACK.bar + 1e-9) * TRACK.bar;
  const closeAt = TRACK.finalDownbeat - removed + offset - TITLE_STEPS * STEP_SECONDS;
  const pad = Math.round((closeAt - naturalClose) / STEP_SECONDS);
  const cut = timed.map((c) => (c.name === "Rapid" ? { ...c, steps: c.steps + pad } : c));
  return { cut, offset, jumpFrom: TRACK.resume - removed };
})();
export const CUT = fit.cut;

const overlap = (into: Into) => (into === "cut" ? 0 : TRANSITION_FRAMES);
/** Grid start of each scene (frames, rounded from the eighth-note grid); the incoming transition begins exactly there. */
const gridStarts = CUT.map((_, i) => Math.round(CUT.slice(0, i).reduce((a, c) => a + c.steps, 0) * STEP));
export const TOTAL_FRAMES = Math.round(CUT.reduce((a, c) => a + c.steps, 0) * STEP);
/** Sequence length = time on the grid + the overlap the next scene's transition eats. */
const lengths = CUT.map((_, i) => (i + 1 < CUT.length ? gridStarts[i + 1] : TOTAL_FRAMES) - gridStarts[i] + (i + 1 < CUT.length ? overlap(CUT[i + 1].into) : 0));
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
/** Music volume (the track is mastered at about -10 LUFS): about -16.5 LUFS between lines, about -28 under the voice. */
const MUSIC = (() => {
  const duck = new Float32Array(TOTAL_FRAMES);
  for (const clip of VOICE_CLIPS) for (let f = clip.from - 4; f < clip.from + voiceFrames(clip.id) + 6 && f < TOTAL_FRAMES; f++) if (f >= 0) duck[f] = 1;
  const smooth = (f: number) => {
    let sum = 0;
    let n = 0;
    for (let k = f - 6; k <= f + 6; k++) if (k >= 0 && k < TOTAL_FRAMES) { sum += duck[k]; n++; }
    return sum / n;
  };
  return (f: number) => (0.48 - 0.355 * smooth(f)) * interpolate(f, [TOTAL_FRAMES - 40, TOTAL_FRAMES], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
})();

/** The track in two pieces: up to the cut point, then from where the full section returns. */
const MusicTrack = () => {
  const startA = Math.round(fit.offset * 30);
  const lenA = Math.round(fit.jumpFrom * 30);
  const startB = startA + lenA;
  const X = 4; // crossfade frames
  return (
    <>
      <Sequence from={startA} durationInFrames={lenA + X} layout="none">
        <Audio src={staticFile(TRACK.file)} trimAfter={lenA + X} volume={(f) => MUSIC(f + startA) * interpolate(f, [lenA - X, lenA + X], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </Sequence>
      <Sequence from={startB - X} layout="none">
        <Audio src={staticFile(TRACK.file)} trimBefore={Math.round(TRACK.resume * 30) - X} volume={(f) => MUSIC(f + startB - X) * interpolate(f, [0, 2 * X], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </Sequence>
    </>
  );
};

export const Trailer = () => (
  <AbsoluteFill style={{ background: "#0b0d12" }}>
    <Preload />
    <TransitionSeries>
      {CUT.flatMap(({ name, into, Scene }, i) => {
        const scene = (
          <TransitionSeries.Sequence key={name} name={name} durationInFrames={lengths[i]}>
            <SceneFade duration={lengths[i]} fadeIn={i === 0 ? 8 : 0} fadeOut={name === "Close" ? 20 : 0}>
              <Scene duration={(i + 1 < CUT.length ? gridStarts[i + 1] : TOTAL_FRAMES) - gridStarts[i]} />
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
    <MusicTrack />
    {VOICE_CLIPS.map((clip) => (
      <Sequence key={`${clip.id}-${clip.from}`} from={clip.from} layout="none">
        <Audio src={staticFile(`voice/${clip.id}.mp3`)} volume={1} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
