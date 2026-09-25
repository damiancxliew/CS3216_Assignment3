/**
 * The opening of a stage, told as cinematic beats before the player takes control.
 *
 * Only public stage framing belongs here: the setting, the shared context, the
 * player's own brief, the goals and the dilemma. Private agent context, hidden
 * evidence and unrevealed decisions stay on the server.
 */
import type { CutsceneScene, SceneFlame } from "@adventure/generation/assets";

import { ASSET_BASE } from "@/lib/play/appearance";
import type { PlayState } from "@/lib/play/session";

export interface CutsceneBeat {
  id: string;
  kicker: string;
  title?: string;
  body?: string;
  items?: string[];
}

/** A backdrop for the cinematic: the stage's own painting, else any generated room art. */
export function cutsceneBackdrop(state: PlayState): string | null {
  return state.cutsceneImageUrl ?? state.landmarks.find((landmark) => landmark.imageUrl)?.imageUrl ?? null;
}

export function cutsceneBeats(state: PlayState): CutsceneBeat[] {
  const { stage, player } = state;
  const goals = stage.objectives.filter((objective) => !objective.met).map((objective) => objective.title);
  const beats: CutsceneBeat[] = [
    {
      id: "place",
      kicker: `Stage ${stage.index + 1} of ${state.stageCount}`,
      title: stage.title,
      ...(stage.setting ? { body: stage.setting } : {}),
    },
    { id: "situation", kicker: "The situation", body: stage.sharedContext },
    { id: "role", kicker: `You are ${player.name}`, title: player.role, body: player.brief },
  ];
  if (state.previousDecision) beats.splice(1, 0, {
    id: "previous-decision",
    kicker: "What you did last chapter",
    title: state.previousDecision.choice ?? "Time ran out",
    body: state.previousDecision.outcome,
  });
  if (goals.length > 0) beats.push({ id: "goals", kicker: "Before you decide", items: goals });
  beats.push({ id: "decision", kicker: "The decision ahead", body: state.decisionPrompt });
  return beats;
}

/** The bundled Beijing court painting, described by hand in the same terms a generated painting is read in. */
const BEIJING_COURT: CutsceneArt = {
  src: "/game/cutscenes/beijing-after-capture.webp",
  // Portrait art on a wide screen: keep both the courtyard and the lamp in frame.
  focus: { x: 0.5, y: 0.6 },
  captionSide: "right",
  scene: {
    mood: "tense",
    weather: "rain",
    wind: "breeze",
    openAir: [{ x: 0.358, y: 0.106 }, { x: 0.841, y: 0.092 }, { x: 0.836, y: 0.69 }, { x: 0.354, y: 0.673 }],
    flames: [{ kind: "oil-lamp", x: 0.211, y: 0.672, width: 0.016, height: 0.044 }],
    firelit: true,
    smoke: [],
    crowd: false,
  },
};

/**
 * The painting the opening animates: the stage's own, else the bundled court
 * scene for the Beijing story until its art is ready. `scene` is null when a
 * painting has not been read, and it then only pans.
 */
export interface CutsceneArt {
  src: string;
  scene: CutsceneScene | null;
  /** The point (fractions of the image) a full-screen crop keeps centred where it can. */
  focus: { x: number; y: number };
  /** Captions sit on this side, away from the flames that carry the painting's light. */
  captionSide: "left" | "right";
}

function captionSide(scene: CutsceneScene | null): CutsceneArt["captionSide"] {
  if (!scene || scene.flames.length === 0) return "left";
  const centre = scene.flames.reduce((sum, flame) => sum + flame.x + flame.width / 2, 0) / scene.flames.length;
  return centre < 0.5 ? "right" : "left";
}

/** Centre the crop on what moves: the open air and the flames. */
function sceneFocus(scene: CutsceneScene | null): { x: number; y: number } {
  const points = scene ? [...scene.openAir, ...scene.flames.flatMap((f) => [{ x: f.x, y: f.y }, { x: f.x + f.width, y: f.y + f.height }])] : [];
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

export function cutsceneArt(state: PlayState): CutsceneArt | null {
  if (state.cutsceneImageUrl) return { src: state.cutsceneImageUrl, scene: state.cutsceneScene, focus: sceneFocus(state.cutsceneScene), captionSide: captionSide(state.cutsceneScene) };
  const text = `${state.stage.title} ${state.stage.setting ?? ""} ${state.stage.sharedContext}`;
  return /\bbeijing\b/i.test(text) && /\b(qing|capture)\b/i.test(text) ? BEIJING_COURT : null;
}

const MUSIC_BY_MOOD: Record<CutsceneScene["mood"], string> = {
  tense: "tension",
  urgent: "tension",
  somber: "quiet",
  mysterious: "mystical",
  calm: "peaceful",
  hopeful: "road",
  celebratory: "calm-village",
};

/** The opening's soundtrack follows the painting's mood; the stage's own music takes over once play begins. */
export function cutsceneMusicUrl(scene: CutsceneScene | null): string | null {
  return scene ? `${ASSET_BASE}/audio/music/${MUSIC_BY_MOOD[scene.mood]}.ogg` : null;
}

/** How loud each flame is and how often it crackles. Candles and lamps barely sputter; wood fires pop. */
const FLAME_SOUND: Record<SceneFlame["kind"], { gain: number; crackles: number }> = {
  candle: { gain: 0.05, crackles: 0.12 },
  "oil-lamp": { gain: 0.08, crackles: 0.25 },
  lantern: { gain: 0.06, crackles: 0.12 },
  torch: { gain: 0.45, crackles: 3 },
  brazier: { gain: 0.55, crackles: 4 },
  hearth: { gain: 0.75, crackles: 5 },
  bonfire: { gain: 1, crackles: 8 },
};

export interface SoundscapeMix {
  /** 0..1 for each ambient layer. */
  rain: number;
  wind: number;
  crowd: number;
  /** Heard through a doorway or window rather than standing in it. */
  muffled: boolean;
  fire: { gain: number; crackles: number; pan: number; wood: boolean } | null;
}

function polygonArea(points: readonly { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** The ambient mix a painting implies. Only what is shown is heard. */
export function soundscapeMix(scene: CutsceneScene): SoundscapeMix {
  const flames = scene.flames.map((flame) => ({ flame, sound: FLAME_SOUND[flame.kind] }));
  const gain = Math.min(1, flames.reduce((sum, { sound }) => sum + sound.gain, 0));
  const pan = gain > 0 ? flames.reduce((sum, { flame, sound }) => sum + (flame.x + flame.width / 2) * sound.gain, 0) / flames.reduce((sum, { sound }) => sum + sound.gain, 0) : 0.5;
  return {
    rain: scene.weather === "rain" ? 0.6 : 0,
    wind: { still: 0, breeze: 0.12, gusty: 0.32 }[scene.wind] + (scene.weather === "snow" || scene.weather === "dust" ? 0.12 : 0),
    crowd: scene.crowd ? 0.22 : 0,
    muffled: scene.openAir.length === 0 || polygonArea(scene.openAir) < 0.4,
    fire: flames.length > 0
      ? {
          gain,
          crackles: Math.max(...flames.map(({ sound }) => sound.crackles)) + flames.length * 0.1,
          pan: Math.max(-0.7, Math.min(0.7, (pan - 0.5) * 1.4)),
          wood: flames.some(({ flame }) => flame.kind === "torch" || flame.kind === "brazier" || flame.kind === "hearth" || flame.kind === "bonfire"),
        }
      : null,
  };
}
