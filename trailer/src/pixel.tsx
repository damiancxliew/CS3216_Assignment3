import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { color, pixel } from "./theme";

/** World pixels are drawn at an exact integer scale so the art stays crisp at 1080p. */
export const SCALE = 4;
export const T = 16;
export const VIEW_W = 1920 / SCALE;
export const VIEW_H = 1080 / SCALE;

type Crop = { sheet: "house" | "floor"; x: number; y: number; w: number; h: number };
const tiles = (sheet: Crop["sheet"], x: number, y: number, w = 1, h = 1): Crop => ({ sheet, x: x * T, y: y * T, w: w * T, h: h * T });

/** Hand-picked objects from the CC0 Ninja Adventure sheets (tile units on a 16 px grid). */
export const ATLAS = {
  grass: tiles("floor", 11, 12),
  tuftA: tiles("floor", 12, 12),
  tuftB: tiles("floor", 13, 12),
  tuftC: tiles("floor", 14, 12),
  dirt: tiles("floor", 12, 8),
  sand: tiles("floor", 1, 1),
  water: tiles("floor", 1, 22),
  foamA: tiles("floor", 6, 22),
  foamB: tiles("floor", 9, 23),
  houseSand: tiles("house", 4, 0, 4, 3),
  houseOrange: tiles("house", 8, 0, 4, 3),
  houseRed: tiles("house", 12, 0, 4, 3),
  shopBlue: tiles("house", 16, 0, 3, 3),
  marketGreen: tiles("house", 19, 0, 4, 3),
  roundHut: tiles("house", 23, 0, 3, 3),
  houseWood: tiles("house", 26, 0, 3, 3),
  cabin: tiles("house", 19, 19, 3, 3),
  thatchHut: tiles("house", 3, 8, 3, 2),
  stallA: tiles("house", 16, 16, 3, 2),
  stallB: tiles("house", 19, 16, 3, 2),
  barrel: tiles("house", 16, 15),
  barrelOpen: tiles("house", 17, 15),
  basketFish: tiles("house", 16, 13),
  basketGreens: tiles("house", 17, 13),
  basketFruit: tiles("house", 18, 13),
  crateFruit: tiles("house", 19, 14),
  crateGoods: tiles("house", 20, 14),
  jar: tiles("house", 21, 13),
  fence: tiles("house", 10, 5, 3, 1),
  bannerRed: tiles("house", 23, 20, 1, 2),
  bannerGreen: tiles("house", 25, 20, 1, 2),
  bannerGold: tiles("house", 28, 20, 1, 2),
  table: tiles("house", 29, 8, 2, 1),
} satisfies Record<string, Crop>;
export type AtlasKey = keyof typeof ATLAS;

export const Sprite = ({ name, x, y, flip = false, opacity = 1 }: { name: AtlasKey; x: number; y: number; flip?: boolean; opacity?: number }) => {
  const c = ATLAS[name];
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: c.w,
        height: c.h,
        backgroundImage: `url(${staticFile(`tiles/${c.sheet}.png`)})`,
        backgroundPosition: `-${c.x}px -${c.y}px`,
        imageRendering: "pixelated",
        transform: flip ? "scaleX(-1)" : undefined,
        opacity,
      }}
    />
  );
};

/** Deterministic noise so tufts land in the same place every frame. */
const hash = (x: number, y: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * Ground from a character map: g grass, d dirt path, s sand, w water (foam on its top edge).
 */
export const Ground = ({ map }: { map: string[] }) => {
  const cells: ReactNode[] = [];
  map.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      let name: AtlasKey = "grass";
      if (ch === "d") name = "dirt";
      else if (ch === "s") name = "sand";
      else if (ch === "w") name = map[y - 1]?.[x] !== "w" ? (hash(x, y) > 0.5 ? "foamA" : "foamB") : "water";
      else {
        const r = hash(x, y);
        name = r > 0.86 ? "tuftA" : r > 0.78 ? "tuftB" : r > 0.72 ? "tuftC" : "grass";
      }
      cells.push(<Sprite key={`${x}-${y}`} name={name} x={x * T} y={y * T} />);
    });
  });
  return <>{cells}</>;
};

type Dir = "down" | "up" | "left" | "right";
const DIR_COL: Record<Dir, number> = { down: 0, up: 1, left: 2, right: 3 };

/** A walking character from a 4×4 walk sheet (columns are directions, rows are frames). */
export const Walker = ({ sprite, path, idle = "down" }: { sprite: string; path: { f: number; x: number; y: number }[]; idle?: Dir }) => {
  const frame = useCurrentFrame();
  const fs = path.map((p) => p.f);
  const x = interpolate(frame, fs, path.map((p) => p.x), { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, fs, path.map((p) => p.y), { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const i = Math.max(0, path.findIndex((p, k) => k < path.length - 1 && frame >= p.f && frame < path[k + 1].f));
  const moving = frame >= path[0].f && frame < path[path.length - 1].f;
  let dir: Dir = idle;
  if (moving) {
    const a = path[i];
    const b = path[i + 1];
    dir = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? "right" : "left") : b.y > a.y ? "down" : "up";
  }
  const step = moving ? Math.floor(frame / 6) % 4 : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: Math.round(x),
        top: Math.round(y),
        width: 16,
        height: 16,
        backgroundImage: `url(${staticFile(`characters/${sprite}/walk.png`)})`,
        backgroundPosition: `-${DIR_COL[dir] * 16}px -${step * 16}px`,
        imageRendering: "pixelated",
      }}
    >
      <div style={{ position: "absolute", left: 3, top: 13, width: 10, height: 3, background: "rgba(0,0,0,0.18)", borderRadius: 2, zIndex: -1 }} />
    </div>
  );
};

/** A small speech-bubble emote above someone, in world pixels. */
export const Emote = ({ x, y, text, at }: { x: number; y: number; text: string; at: number }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 4, at + 7], [0, 1.25, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `scale(${t})`, transformOrigin: "bottom center", opacity: t > 0 ? 1 : 0 }}>
      <div style={{ background: "#fff", border: `1px solid ${color.ink}`, padding: "0 3px", fontFamily: pixel, fontSize: 9, fontWeight: 700, lineHeight: "11px", color: color.signal }}>{text}</div>
      <div style={{ width: 0, height: 0, marginLeft: 4, borderLeft: "3px solid transparent", borderRight: "3px solid transparent", borderTop: `3px solid ${color.ink}` }} />
    </div>
  );
};

/** World container: pans a camera across a world drawn in native pixels. */
export const World = ({ children, camX, camY = 0, width, height }: { children: ReactNode; camX: number; camY?: number; width: number; height: number }) => (
  <AbsoluteFill style={{ background: "#1b2a1b", overflow: "hidden" }}>
    <div
      style={{
        position: "absolute",
        width,
        height,
        transformOrigin: "0 0",
        transform: `scale(${SCALE}) translate(${-Math.round(camX)}px, ${-Math.round(camY)}px)`,
        imageRendering: "pixelated",
      }}
    >
      {children}
    </div>
  </AbsoluteFill>
);

/** Late-afternoon light, drifting fog and a vignette, drawn over the world in screen space. */
export const Atmosphere = ({ fog = 0.18, warmth = 0.22 }: { fog?: number; warmth?: number }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(255,170,90,${warmth}) 0%, rgba(255,140,60,${warmth * 0.4}) 45%, rgba(20,30,60,${warmth * 0.6}) 100%)`, mixBlendMode: "soft-light" }} />
      <AbsoluteFill style={{ overflow: "hidden", opacity: fog }}>
        <Img src={staticFile("fx/fog.png")} style={{ position: "absolute", width: 1920 * 2, height: 1080, left: -((frame * 1.2) % 1920), imageRendering: "pixelated", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(10,14,24,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};

/** The 1819 riverside settlement used across the story scenes. 64 × 17 tiles. */
export const TOWN_MAP = [
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "ggggggggdggggggggggggggggggggggggggggggggggggggdgggggggggggggggg",
  "ggggggggdggggggggggggggggggggggggggggggggggggggdggggggggggdggggg",
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
  "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss",
  "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
];
export const TOWN_W = 64 * T;
export const TOWN_H = 17 * T;

/** Buildings and props of the town, in world pixels. */
export const Town = () => (
  <>
    <Ground map={TOWN_MAP} />
    {/* The Temenggong's house by the river */}
    <Sprite name="houseSand" x={6 * T} y={4 * T} />
    <Sprite name="fence" x={2 * T} y={6 * T + 4} />
    <Sprite name="jar" x={11 * T} y={6 * T} />
    {/* Market */}
    <Sprite name="stallA" x={15 * T} y={5 * T} />
    <Sprite name="stallB" x={19 * T} y={5 * T} />
    <Sprite name="basketFish" x={15 * T} y={7 * T} />
    <Sprite name="basketGreens" x={16 * T} y={7 * T} />
    <Sprite name="basketFruit" x={19 * T} y={7 * T} />
    <Sprite name="crateFruit" x={20 * T} y={7 * T} />
    <Sprite name="crateGoods" x={21 * T} y={7 * T} />
    <Sprite name="barrel" x={23 * T} y={6 * T} />
    <Sprite name="barrelOpen" x={24 * T} y={6 * T} />
    <Sprite name="bannerRed" x={14 * T} y={5 * T} />
    <Sprite name="bannerGold" x={22 * T} y={5 * T} />
    <Sprite name="cabin" x={26 * T} y={4 * T} />
    <Sprite name="thatchHut" x={30 * T} y={5 * T} />
    {/* Farquhar's residence */}
    <Sprite name="shopBlue" x={35 * T} y={4 * T} />
    <Sprite name="bannerGreen" x={38 * T} y={5 * T} />
    {/* Raffles on Government Hill */}
    <Sprite name="houseOrange" x={45 * T} y={4 * T} />
    <Sprite name="table" x={42 * T} y={7 * T} />
    {/* Tengku Hussein's house */}
    <Sprite name="houseRed" x={56 * T} y={4 * T} />
    <Sprite name="roundHut" x={52 * T} y={4 * T} />
    <Sprite name="barrel" x={60 * T} y={7 * T} />
  </>
);

/** Fixed spots where people stand, in world pixels. */
export const SPOTS = {
  temenggong: { x: 8 * T, y: 7 * T },
  merchant: { x: 18 * T, y: 7 * T + 4 },
  trader: { x: 22 * T + 8, y: 8 * T },
  farquhar: { x: 36 * T + 8, y: 7 * T },
  raffles: { x: 47 * T, y: 7 * T },
  hussein: { x: 58 * T, y: 7 * T },
};
