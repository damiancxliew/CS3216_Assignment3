import { describe, expect, it } from "vitest";

import type { CutsceneScene } from "@adventure/generation/assets";

import { locateFlame } from "@/components/play/scene-effects";
import { cutsceneArt, cutsceneBackdrop, cutsceneBeats, cutsceneMusicUrl, soundscapeMix } from "@/lib/play/cutscene";
import type { PlayState } from "@/lib/play/session";

function state(overrides: Partial<PlayState> = {}): PlayState {
  return {
    stageCount: 3,
    decisionPrompt: "Do you sign the treaty?",
    player: { name: "Amina", role: "Harbour clerk", brief: "You keep the cargo ledgers." },
    stage: {
      id: "stage-2",
      index: 1,
      title: "The quay at dawn",
      setting: "Aden, 1839",
      sharedContext: "Two crews claim the same cargo.",
      objectives: [
        { id: "a", title: "Read the manifest", met: true },
        { id: "b", title: "Hear both crews", met: false },
      ],
    },
    landmarks: [{ id: "l1", imageUrl: "https://example.test/quay.png" }],
    ...overrides,
  } as unknown as PlayState;
}

describe("stage cutscene", () => {
  it("opens on the setting and closes on the dilemma", () => {
    const beats = cutsceneBeats(state());
    expect(beats.map((beat) => beat.id)).toEqual(["place", "situation", "role", "goals", "decision"]);
    expect(beats[0]).toMatchObject({ kicker: "Stage 2 of 3", title: "The quay at dawn", body: "Aden, 1839" });
    expect(beats.at(-1)!.body).toBe("Do you sign the treaty?");
  });

  it("lists only the goals still open, and drops the beat when there are none", () => {
    expect(cutsceneBeats(state()).find((beat) => beat.id === "goals")!.items).toEqual(["Hear both crews"]);
    const done = state({ stage: { ...state().stage, objectives: [{ id: "a", title: "Read the manifest", met: true }] } as PlayState["stage"] });
    expect(cutsceneBeats(done).some((beat) => beat.id === "goals")).toBe(false);
  });

  it("uses generated stage art as the backdrop when there is some", () => {
    expect(cutsceneBackdrop(state())).toBe("https://example.test/quay.png");
    expect(cutsceneBackdrop(state({ landmarks: [] }))).toBeNull();
  });

  it("prefers the stage's own painting over room art", () => {
    expect(cutsceneBackdrop(state({ cutsceneImageUrl: "https://example.test/opening.webp" }))).toBe("https://example.test/opening.webp");
  });
});

describe("stage opening scene", () => {
  const scene: CutsceneScene = {
    mood: "tense",
    weather: "rain",
    wind: "gusty",
    openAir: [{ x: 0.4, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.6 }, { x: 0.4, y: 0.6 }],
    flames: [{ kind: "oil-lamp", x: 0.2, y: 0.66, width: 0.02, height: 0.05 }, { kind: "brazier", x: 0.7, y: 0.7, width: 0.08, height: 0.1 }],
    firelit: true,
    smoke: [],
    crowd: false,
  };

  it("uses the stage's painting and its reading, else the bundled Beijing scene", () => {
    expect(cutsceneArt(state({ cutsceneImageUrl: "https://example.test/opening.webp", cutsceneScene: scene }))).toMatchObject({ src: "https://example.test/opening.webp", scene });
    expect(cutsceneArt(state({ cutsceneImageUrl: null }))).toBeNull();
    const beijing = cutsceneArt(state({ cutsceneImageUrl: null, stage: { ...state().stage, title: "Beijing After the Capture", sharedContext: "The Qing court" } as PlayState["stage"] }));
    expect(beijing?.src).toBe("/game/cutscenes/beijing-after-capture.webp");
    expect(beijing?.scene?.flames).toHaveLength(1);
  });

  it("scores the painting's mood and mixes only what it shows", () => {
    expect(cutsceneMusicUrl(scene)).toBe("/game/ninja/audio/music/tension.ogg");
    expect(cutsceneMusicUrl({ ...scene, mood: "hopeful" })).toBe("/game/ninja/audio/music/road.ogg");
    expect(cutsceneMusicUrl(null)).toBeNull();
    const mix = soundscapeMix(scene);
    expect(mix).toMatchObject({ rain: 0.6, wind: 0.32, crowd: 0, muffled: true });
    // The brazier dominates: wood crackles, heard right of centre.
    expect(mix.fire).toMatchObject({ wood: true, crackles: 4.2 });
    expect(mix.fire!.pan).toBeGreaterThan(0);
    const quiet = soundscapeMix({ ...scene, weather: "none", wind: "still", flames: [scene.flames[0]!], openAir: [] });
    expect(quiet).toMatchObject({ rain: 0, wind: 0, fire: { wood: false } });
    expect(quiet.fire!.crackles).toBeLessThan(1);
  });
});

describe("finding a painted flame", () => {
  // A dark 60x60 image with a warm flame 4px wide from y=20 to y=35 around x=30, and a bright cold window far away.
  const width = 60;
  const pixels = new Uint8ClampedArray(width * 60 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([30, 26, 22, 255], i);
  const paint = (x: number, y: number, rgb: [number, number, number]) => pixels.set([...rgb, 255], (y * width + x) * 4);
  for (let y = 20; y < 36; y += 1) for (let x = 28; x < 32; x += 1) paint(x, y, y > 30 ? [255, 250, 230] : [250, 170, 70]);
  for (let y = 0; y < 6; y += 1) for (let x = 0; x < 6; x += 1) paint(x, y, [240, 245, 255]);

  it("snaps a loose description to the bright warm tongue and roots it at its base", () => {
    const shape = locateFlame(pixels, width, 60, { kind: "candle", x: 0.43, y: 0.28, width: 0.1, height: 0.2 })!;
    expect(shape.cx).toBeCloseTo(29.5, 0);
    expect(shape.base).toBe(36);
    expect(shape.width).toBe(4);
    expect(shape.height).toBeGreaterThanOrEqual(16);
  });

  it("animates nothing when the description misses every flame", () => {
    const dark = new Uint8ClampedArray(pixels.length).fill(20);
    expect(locateFlame(dark, width, 60, { kind: "candle", x: 0.4, y: 0.3, width: 0.1, height: 0.2 })).toBeNull();
  });
});
