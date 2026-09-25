/**
 * Moves a painting from its scene description, in the painting's own pixel
 * coordinates. Nothing is drawn as an icon over the art:
 *
 * - Flames are the painted flame itself. Its bright pixels are found near the
 *   described box, then resampled every frame through a noise field that flows
 *   upward, so the tongue licks, stretches and leans while the wick stays put.
 *   Brightness follows a layered, irregular flicker rather than a sine.
 * - Light breathes with the flame: a warm screen glow around it and, in a
 *   firelit room, the rest of the painting dimming slightly as the flame drops.
 * - Wood fires throw embers and bend the air above them, and every crackle the
 *   soundscape plays is also a visible flare.
 * - Rain, snow, fog and dust stay inside the painting's open air.
 */
import type { CutsceneScene, SceneFlame } from "@adventure/generation/assets";

type Point = { x: number; y: number };

// ---------------------------------------------------------------- noise

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number): number {
  return valueNoise(x, y) * 0.65 + valueNoise(x * 2.13 + 17.3, y * 2.07 + 9.1) * 0.35;
}

/** Irregular -1..1 signal: several incommensurate rates, like a real flame's flicker. */
function flicker(t: number, seed: number): number {
  return (valueNoise(t * 1.3, seed) - 0.5) * 1.1 + (valueNoise(t * 3.9, seed + 7) - 0.5) * 0.6 + (valueNoise(t * 10.7, seed + 13) - 0.5) * 0.3;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** How much a colour reads as flame: bright and warm, or a white-hot core. */
function flameness(r: number, g: number, b: number): number {
  const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  return Math.max(clamp01((lum - 0.3) / 0.35) * clamp01(((r - b) / 255 + 0.12) / 0.32), clamp01((lum - 0.82) / 0.12));
}

// ---------------------------------------------------------------- finding flames

export interface FlameShape {
  kind: SceneFlame["kind"];
  /** Horizontal centre of the flame and the y of its root (the wick or embers). */
  cx: number;
  base: number;
  width: number;
  height: number;
}

/**
 * Snap a described flame box to the painted flame: the brightest warm pixel
 * near the box, grown into its connected bright region. A description that
 * does not land on a flame animates nothing rather than smearing the painting.
 */
export function locateFlame(pixels: ArrayLike<number>, imageWidth: number, imageHeight: number, flame: SceneFlame): FlameShape | null {
  const box = { x: flame.x * imageWidth, y: flame.y * imageHeight, w: flame.width * imageWidth, h: flame.height * imageHeight };
  const pad = Math.max(24, Math.max(box.w, box.h) * 0.8);
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const x1 = Math.min(imageWidth - 1, Math.ceil(box.x + box.w + pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const y1 = Math.min(imageHeight - 1, Math.ceil(box.y + box.h + pad));
  if (x1 <= x0 || y1 <= y0) return null;
  const lum = (i: number) => (0.3 * pixels[i]! + 0.59 * pixels[i + 1]! + 0.11 * pixels[i + 2]!) / 255;
  const warm = (i: number) => pixels[i]! - pixels[i + 2]!;
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };

  let seed = -1;
  let best = 0;
  let peak = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * imageWidth + x) * 4;
      const l = lum(i);
      if (l < 0.45 || (warm(i) < 20 && l < 0.9)) continue;
      // Prefer the bright spot nearest the description over a brighter one at the edge of the search.
      const distance = Math.hypot(x - centre.x, y - centre.y) / (pad + Math.max(box.w, box.h));
      const score = l - distance * 0.25;
      if (score > best) {
        best = score;
        seed = y * imageWidth + x;
        peak = l;
      }
    }
  }
  if (seed < 0) return null;

  const threshold = Math.max(0.4, peak * 0.58);
  const seen = new Set<number>([seed]);
  const queue = [seed];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, weight = 0, sumX = 0;
  while (queue.length > 0) {
    const index = queue.pop()!;
    const x = index % imageWidth;
    const y = (index - x) / imageWidth;
    const l = lum(index * 4);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    weight += l; sumX += x * l;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const next = ny * imageWidth + nx;
        if (seen.has(next)) continue;
        seen.add(next);
        const i = next * 4;
        const nl = lum(i);
        if (nl >= threshold && (warm(i) > 8 || nl > 0.85)) queue.push(next);
      }
    }
  }
  if (seen.size < 4 || weight === 0) return null;
  let width = maxX - minX + 1;
  let height = maxY - minY + 1;
  let base = maxY + 1;
  let cx = sumX / weight;
  // A large fire is many separate tongues; trust a big description over one tongue of it.
  if (box.w > 40 && width * height < box.w * box.h * 0.25) {
    width = box.w; height = box.h; base = box.y + box.h; cx = centre.x;
  }
  // The faint tip of a flame extends past its bright core.
  return { kind: flame.kind, cx, base, width: Math.max(3, width), height: Math.max(6, height * 1.25, width * 1.5) };
}

// ---------------------------------------------------------------- flames

interface FlameStyle {
  sway: number;
  speed: number;
  glow: number;
  embers: number;
  haze: number;
  smoke: number;
  wood: boolean;
  colour: string;
}

const STYLE: Record<SceneFlame["kind"], FlameStyle> = {
  candle: { sway: 0.26, speed: 2.6, glow: 3.2, embers: 0, haze: 0, smoke: 0, wood: false, colour: "255,186,98" },
  "oil-lamp": { sway: 0.3, speed: 2.4, glow: 3.6, embers: 0, haze: 0, smoke: 0, wood: false, colour: "255,174,84" },
  lantern: { sway: 0.16, speed: 2.2, glow: 3.4, embers: 0, haze: 0, smoke: 0, wood: false, colour: "255,178,92" },
  torch: { sway: 0.5, speed: 2, glow: 4.4, embers: 4, haze: 0.8, smoke: 0.6, wood: true, colour: "255,152,62" },
  brazier: { sway: 0.45, speed: 1.8, glow: 4.4, embers: 6, haze: 1, smoke: 0.5, wood: true, colour: "255,146,58" },
  hearth: { sway: 0.4, speed: 1.7, glow: 4, embers: 4, haze: 0.7, smoke: 0, wood: true, colour: "255,140,55" },
  bonfire: { sway: 0.55, speed: 1.5, glow: 4.2, embers: 10, haze: 1.2, smoke: 1, wood: true, colour: "255,138,52" },
};

const MAX_PATCH_PIXELS = 24_000;

class Flame {
  readonly style: FlameStyle;
  readonly seed: number;
  flare = 0;
  lean = 0;
  level = 0;
  private stretch = 1;
  private readonly patch: { left: number; top: number; width: number; height: number; scale: number; cols: number; rows: number; source: ImageData; output: ImageData; canvas: HTMLCanvasElement } | null;

  constructor(readonly shape: FlameShape, painting: CanvasImageSource | null, imageWidth: number, imageHeight: number, seed: number) {
    this.style = STYLE[shape.kind];
    this.seed = seed;
    this.patch = painting ? this.cut(painting, imageWidth, imageHeight) : null;
  }

  /** The painted region the flame (and, for wood, its shimmer) can move within. */
  private cut(painting: CanvasImageSource, imageWidth: number, imageHeight: number) {
    const { cx, base, width, height } = this.shape;
    const half = Math.max(width * 2.2, height * 0.5, 12);
    const left = Math.max(0, Math.floor(cx - half));
    const right = Math.min(imageWidth, Math.ceil(cx + half));
    const top = Math.max(0, Math.floor(base - height * (this.style.haze > 0 ? 2.3 : 1.6)));
    const bottom = Math.min(imageHeight, Math.ceil(base + height * 0.15));
    const w = right - left;
    const h = bottom - top;
    if (w < 4 || h < 4) return null;
    const scale = Math.min(1, Math.sqrt(MAX_PATCH_PIXELS / (w * h)));
    const cols = Math.max(4, Math.round(w * scale));
    const rows = Math.max(4, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(painting, left, top, w, h, 0, 0, cols, rows);
    const source = context.getImageData(0, 0, cols, rows);
    return { left, top, width: w, height: h, scale: cols / w, cols, rows, source, output: context.createImageData(cols, rows), canvas };
  }

  step(t: number, dt: number, wind: number): void {
    const calm = this.style.wood ? 1 : 0.6;
    this.level = flicker(t, this.seed) * calm;
    this.flare *= Math.exp(-dt / 0.14);
    const gust = wind * (0.5 + valueNoise(t * 0.4, this.seed + 3));
    this.lean = (valueNoise(t * 0.33, this.seed + 5) - 0.5) * 0.5 * calm + gust * 0.35;
    // Wood pops flare up; a wick sputters, dipping and leaning for a moment.
    this.stretch = this.style.wood ? 1 + this.level * 0.2 + this.flare * 0.32 : 1 + this.level * 0.16 - this.flare * 0.22;
    if (!this.style.wood) this.lean += this.flare * 0.5 * Math.sign(valueNoise(this.seed, Math.floor(t * 4)) - 0.5);
  }

  /** Resample the painted flame through an upward-flowing noise field. */
  render(context: CanvasRenderingContext2D, t: number): void {
    const patch = this.patch;
    if (!patch) return;
    const { cx, base, width: fw, height: fh } = this.shape;
    const { sway, speed, haze } = this.style;
    const src = patch.source.data;
    const out = patch.output.data;
    const { cols, rows, scale, left, top } = patch;
    const brighten = this.level * 0.1 + (this.style.wood ? this.flare * 0.35 : this.flare * 0.12);
    const featherX = cols * 0.14;
    const featherY = rows * 0.14;
    const drift = t * speed;
    const seed = this.seed;
    for (let j = 0; j < rows; j += 1) {
      const py = top + (j + 0.5) / scale;
      const v = (base - py) / fh;
      const edgeY = smoothstep(0, 1, Math.min(j, rows - 1 - j) / featherY);
      for (let i = 0; i < cols; i += 1) {
        const o = (j * cols + i) * 4;
        const px = left + (i + 0.5) / scale;
        const edge = edgeY * smoothstep(0, 1, Math.min(i, cols - 1 - i) / featherX);
        let sx = px;
        let sy = py;
        let hazeWeight = 0;
        if (v > -0.08 && edge > 0) {
          const hx = (px - cx) / (fw * 0.5 + 2);
          const influence = smoothstep(-0.02, 0.3, v) * Math.exp(-hx * hx * 0.18);
          if (influence > 0.002) {
            const nx = hx * 0.55 + seed;
            const ny = v * 2.2 - drift;
            const lick = fbm(nx, ny) - 0.5;
            const pull = fbm(nx + 31.7, ny * 1.4 + 5) - 0.5;
            sx = px - (lick * 2 * sway * fw * (0.35 + v) + this.lean * v * v * fw) * influence;
            sy = base - (v / this.stretch) * fh + pull * 0.2 * fh * influence;
          }
          if (haze > 0) {
            // Hot air above a wood fire bends whatever is behind it.
            const band = smoothstep(0.7, 1.1, v) * (1 - smoothstep(1.4, 2.2, v)) * Math.exp(-hx * hx * 0.08);
            if (band > 0.01) {
              sx += (valueNoise(px * 0.07 + seed, py * 0.05 + t * 3.2) - 0.5) * haze * fh * 0.035 * band;
              sy += (valueNoise(px * 0.05 + 11, py * 0.07 + t * 2.7) - 0.5) * haze * fh * 0.025 * band;
              hazeWeight = band;
            }
          }
        }
        const r0 = src[o]!, g0 = src[o + 1]!, b0 = src[o + 2]!;
        if (sx === px && sy === py) {
          out[o] = r0; out[o + 1] = g0; out[o + 2] = b0; out[o + 3] = 255;
          continue;
        }
        // Bilinear sample of the source patch.
        const fx = Math.min(cols - 1.001, Math.max(0, (sx - left) * scale - 0.5));
        const fy = Math.min(rows - 1.001, Math.max(0, (sy - top) * scale - 0.5));
        const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy;
        const a = (iy * cols + ix) * 4, b = a + 4, c = a + cols * 4, d = c + 4;
        const r = (src[a]! * (1 - ax) + src[b]! * ax) * (1 - ay) + (src[c]! * (1 - ax) + src[d]! * ax) * ay;
        const g = (src[a + 1]! * (1 - ax) + src[b + 1]! * ax) * (1 - ay) + (src[c + 1]! * (1 - ax) + src[d + 1]! * ax) * ay;
        const bl = (src[a + 2]! * (1 - ax) + src[b + 2]! * ax) * (1 - ay) + (src[c + 2]! * (1 - ax) + src[d + 2]! * ax) * ay;
        const sampled = flameness(r, g, bl);
        const weight = Math.max(flameness(r0, g0, b0), sampled, hazeWeight) * edge;
        const gain = 1 + brighten * sampled;
        out[o] = r0 + (Math.min(255, r * gain) - r0) * weight;
        out[o + 1] = g0 + (Math.min(255, g * gain) - g0) * weight;
        out[o + 2] = b0 + (Math.min(255, bl * gain) - b0) * weight;
        out[o + 3] = 255;
      }
    }
    patch.canvas.getContext("2d")!.putImageData(patch.output, 0, 0);
    context.drawImage(patch.canvas, left, top, patch.width, patch.height);
  }

  /** Radius around the flame that the patch covers, so room shading never cuts across it. */
  get reach(): number {
    return this.patch ? Math.hypot(this.patch.width, this.patch.height) * 0.6 : this.shape.height;
  }

  get light(): number {
    return 0.55 + this.level * 0.35 + this.flare * (this.style.wood ? 0.6 : -0.25);
  }
}

// ---------------------------------------------------------------- particles

interface Particle { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; seed: number }

function softSprite(colour: string): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const context = sprite.getContext("2d")!;
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, `rgba(${colour},.8)`);
  gradient.addColorStop(0.3, `rgba(${colour},.4)`);
  gradient.addColorStop(1, `rgba(${colour},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return sprite;
}

// ---------------------------------------------------------------- the whole scene

export interface SceneLayers {
  /** Resampled flames and the firelit room's shading. */
  base: HTMLCanvasElement;
  /** Weather, smoke and embers. */
  air: HTMLCanvasElement;
  /** Warm light, composited with `mix-blend-mode: screen`. */
  light: HTMLCanvasElement;
}

const WIND = { still: 0, breeze: 0.35, gusty: 0.9 } as const;

export class SceneEffects {
  private readonly width: number;
  private readonly height: number;
  private readonly flames: Flame[];
  private readonly air: Point[];
  private readonly airBox: { x0: number; y0: number; x1: number; y1: number } | null;
  private readonly soft = softSprite("211,220,215");
  private readonly smokeSprite = softSprite("140,138,132");
  private readonly dustSprite = softSprite("206,176,128");
  private readonly drops: Particle[] = [];
  private readonly splashes: Particle[] = [];
  private readonly embers: Particle[] = [];
  private readonly smoke: (Particle & { source: number })[] = [];
  private readonly smokeSources: { x: number; y: number; rate: number; carry: number }[];
  private readonly contexts: { base: CanvasRenderingContext2D; air: CanvasRenderingContext2D; light: CanvasRenderingContext2D };
  private random: () => number;
  private time = 0;

  constructor(layers: SceneLayers, painting: HTMLImageElement, private readonly scene: CutsceneScene) {
    this.width = painting.naturalWidth;
    this.height = painting.naturalHeight;
    for (const canvas of Object.values(layers)) {
      canvas.width = this.width;
      canvas.height = this.height;
    }
    this.contexts = { base: layers.base.getContext("2d")!, air: layers.air.getContext("2d")!, light: layers.light.getContext("2d")! };
    let state = 71823;
    this.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };

    // Reading pixels needs a CORS-clean image; without it flames only glow and throw embers.
    let pixels: Uint8ClampedArray | null = null;
    try {
      const reader = document.createElement("canvas");
      reader.width = this.width;
      reader.height = this.height;
      const context = reader.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(painting, 0, 0);
      pixels = context.getImageData(0, 0, this.width, this.height).data;
    } catch {
      pixels = null;
    }
    this.flames = scene.flames.flatMap((flame, index) => {
      const shape = pixels
        ? locateFlame(pixels, this.width, this.height, flame)
        : { kind: flame.kind, cx: (flame.x + flame.width / 2) * this.width, base: (flame.y + flame.height) * this.height, width: flame.width * this.width, height: flame.height * this.height };
      return shape ? [new Flame(shape, pixels ? painting : null, this.width, this.height, 41 + index * 97)] : [];
    });

    this.air = scene.openAir.map((point) => ({ x: point.x * this.width, y: point.y * this.height }));
    this.airBox = this.air.length >= 3
      ? { x0: Math.min(...this.air.map((p) => p.x)), y0: Math.min(...this.air.map((p) => p.y)), x1: Math.max(...this.air.map((p) => p.x)), y1: Math.max(...this.air.map((p) => p.y)) }
      : null;
    const scale = this.height / 1536;
    this.smokeSources = [
      ...scene.smoke.map((point) => ({ x: point.x * this.width, y: point.y * this.height, rate: 2.2, carry: 0 })),
      ...this.flames.filter((flame) => flame.style.smoke > 0).map((flame) => ({ x: flame.shape.cx, y: flame.shape.base - flame.shape.height, rate: 2.5 * flame.style.smoke, carry: 0 })),
    ];
    if (this.airBox && (scene.weather === "rain" || scene.weather === "snow" || scene.weather === "dust")) {
      const area = (this.airBox.x1 - this.airBox.x0) * (this.airBox.y1 - this.airBox.y0) / (scale * scale);
      const count = Math.round(Math.min(240, Math.max(40, area / (scene.weather === "rain" ? 2700 : 3600))));
      for (let i = 0; i < count; i += 1) this.drops.push(this.spawnDrop(true));
      if (scene.weather === "rain") for (let i = 0; i < 24; i += 1) this.splashes.push(this.spawnSplash(true));
    }
  }

  /** A crackle heard in the soundscape, shown on one of the flames. */
  flare(strength: number): void {
    if (this.flames.length === 0) return;
    const wood = this.flames.filter((flame) => flame.style.wood);
    const pool = wood.length > 0 ? wood : this.flames;
    const flame = pool[Math.floor(this.random() * pool.length)]!;
    flame.flare = Math.min(1.4, flame.flare + strength);
    if (flame.style.wood) for (let i = 0; i < Math.round(strength * 7); i += 1) this.embers.push(this.spawnEmber(flame, true));
  }

  get hasMotion(): boolean {
    return this.flames.length > 0 || this.drops.length > 0 || this.smokeSources.length > 0 || this.scene.weather === "fog";
  }

  frame(dt: number): void {
    this.time += dt;
    const t = this.time;
    const wind = WIND[this.scene.wind];
    const { base, air, light } = this.contexts;
    base.clearRect(0, 0, this.width, this.height);
    air.clearRect(0, 0, this.width, this.height);
    light.clearRect(0, 0, this.width, this.height);

    for (const flame of this.flames) {
      flame.step(t, dt, wind);
      flame.render(base, t);
    }
    this.shadeRoom(base);
    this.weather(air, dt, t, wind);
    this.drawSmoke(air, dt, t, wind);
    this.drawEmbers(air, dt, t, wind);
    this.glow(light);
  }

  clear(): void {
    for (const context of Object.values(this.contexts)) context.clearRect(0, 0, this.width, this.height);
  }

  /** In a firelit room the whole painting follows the flame, darkest when it gutters. */
  private shadeRoom(context: CanvasRenderingContext2D): void {
    if (!this.scene.firelit || this.flames.length === 0) return;
    const main = this.flames.reduce((a, b) => (b.shape.height > a.shape.height ? b : a));
    const light = this.flames.reduce((sum, flame) => sum + flame.light, 0) / this.flames.length;
    const alpha = 0.09 * clamp01(1 - light);
    if (alpha < 0.004) return;
    const cy = main.shape.base - main.shape.height * 0.5;
    const gradient = context.createRadialGradient(main.shape.cx, cy, main.reach, main.shape.cx, cy, main.reach + main.shape.height * main.style.glow * 2.5);
    gradient.addColorStop(0, "rgba(8,5,3,0)");
    gradient.addColorStop(1, `rgba(8,5,3,${alpha})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
  }

  private glow(context: CanvasRenderingContext2D): void {
    for (const flame of this.flames) {
      const { cx, base, height } = flame.shape;
      const cy = base - height * 0.55;
      const intensity = Math.max(0, 0.14 + flame.level * 0.06 + flame.flare * (flame.style.wood ? 0.14 : -0.05));
      const radius = height * flame.style.glow * (this.scene.firelit ? 1.25 : 1);
      const gradient = context.createRadialGradient(cx, cy, height * 0.2, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${flame.style.colour},${intensity})`);
      gradient.addColorStop(0.35, `rgba(${flame.style.colour},${intensity * 0.35})`);
      gradient.addColorStop(1, `rgba(${flame.style.colour},0)`);
      context.fillStyle = gradient;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
  }

  private spawnEmber(flame: Flame, burst = false): Particle {
    const { cx, base, width, height } = flame.shape;
    const lift = height * (burst ? 1.4 : 1) * (0.8 + this.random() * 0.8);
    return {
      x: cx + (this.random() - 0.5) * width * 0.6,
      y: base - height * (0.4 + this.random() * 0.5),
      vx: (this.random() - 0.5) * height * 0.5,
      vy: -lift,
      age: 0,
      life: 0.8 + this.random() * 1.6,
      size: Math.max(0.6, Math.min(2.2, height / 60)) * (0.6 + this.random() * 0.8),
      seed: this.random() * 100,
    };
  }

  private drawEmbers(context: CanvasRenderingContext2D, dt: number, t: number, wind: number): void {
    for (const flame of this.flames) {
      if (flame.style.embers > 0 && this.random() < flame.style.embers * dt) this.embers.push(this.spawnEmber(flame));
    }
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (let i = this.embers.length - 1; i >= 0; i -= 1) {
      const ember = this.embers[i]!;
      ember.age += dt;
      if (ember.age >= ember.life) {
        this.embers.splice(i, 1);
        continue;
      }
      const px = ember.x;
      const py = ember.y;
      const turbulence = (valueNoise(ember.seed, t * 2.2) - 0.5) * 140;
      ember.vx += (turbulence + wind * 60) * dt;
      ember.vy *= Math.exp(-dt * 0.6);
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      const heat = 1 - ember.age / ember.life;
      const twinkle = 0.6 + 0.4 * valueNoise(ember.seed + 50, t * 9);
      context.strokeStyle = `rgba(255,${Math.round(90 + 150 * heat * heat)},${Math.round(40 * heat)},${heat * twinkle})`;
      context.lineWidth = ember.size;
      context.beginPath();
      context.moveTo(px, py);
      context.lineTo(ember.x, ember.y);
      context.stroke();
    }
    context.restore();
  }

  private drawSmoke(context: CanvasRenderingContext2D, dt: number, t: number, wind: number): void {
    const scale = this.height / 1536;
    this.smokeSources.forEach((source, index) => {
      source.carry += source.rate * dt;
      while (source.carry >= 1) {
        source.carry -= 1;
        this.smoke.push({ x: source.x + (this.random() - 0.5) * 6 * scale, y: source.y, vx: 0, vy: -(18 + this.random() * 14) * scale, age: 0, life: 6 + this.random() * 4, size: 8 * scale, seed: this.random() * 100, source: index });
      }
    });
    for (let i = this.smoke.length - 1; i >= 0; i -= 1) {
      const puff = this.smoke[i]!;
      puff.age += dt;
      if (puff.age >= puff.life) {
        this.smoke.splice(i, 1);
        continue;
      }
      const progress = puff.age / puff.life;
      puff.x += ((valueNoise(puff.seed, t * 0.5) - 0.5) * 24 + wind * 30 * progress) * scale * dt;
      puff.y += puff.vy * dt;
      const size = puff.size + progress * 55 * scale;
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.09;
      context.drawImage(this.smokeSprite, puff.x - size / 2, puff.y - size / 2, size, size * 1.2);
    }
    context.globalAlpha = 1;
  }

  private spawnDrop(anywhere: boolean): Particle {
    const box = this.airBox!;
    const depth = this.random();
    return {
      x: box.x0 + this.random() * (box.x1 - box.x0),
      y: anywhere ? box.y0 + this.random() * (box.y1 - box.y0) : box.y0 - this.random() * 80,
      vx: 0,
      vy: 0,
      age: 0,
      life: 0,
      size: depth,
      seed: this.random() * 10,
    };
  }

  private spawnSplash(anywhere: boolean): Particle {
    const box = this.airBox!;
    return {
      x: box.x0 + (box.x1 - box.x0) * (0.04 + this.random() * 0.92),
      y: box.y1 - (box.y1 - box.y0) * this.random() * 0.2,
      vx: 0,
      vy: 0,
      age: anywhere ? this.random() * 3 : 0,
      life: 1.3 + this.random() * 2.8,
      size: 3 + this.random() * 9,
      seed: this.random(),
    };
  }

  private weather(context: CanvasRenderingContext2D, dt: number, t: number, wind: number): void {
    const weather = this.scene.weather;
    if (weather === "none") return;
    const scale = this.height / 1536;
    context.save();
    if (this.air.length >= 3) {
      context.beginPath();
      this.air.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
      context.closePath();
      context.clip();
    } else if (weather !== "fog") {
      context.restore();
      return;
    }

    if (weather === "fog" || weather === "rain" || weather === "dust") {
      // Slow banks of mist or haze drifting across the lower open air.
      const box = this.airBox ?? { x0: 0, y0: this.height * 0.4, x1: this.width, y1: this.height };
      const banks = weather === "fog" ? 5 : 2;
      for (let i = 0; i < banks; i += 1) {
        const phase = valueNoise(i * 3.1, t * 0.05);
        const x = box.x0 + (box.x1 - box.x0) * (((i * 0.37 + t * 0.012 * (1 + wind)) % 1.4) - 0.2);
        const y = box.y0 + (box.y1 - box.y0) * (0.55 + 0.35 * (i / banks));
        const w = (box.x1 - box.x0) * (0.7 + phase * 0.4);
        context.globalAlpha = (weather === "fog" ? 0.16 : weather === "dust" ? 0.1 : 0.07) * (0.6 + phase * 0.4);
        context.drawImage(weather === "dust" ? this.dustSprite : this.soft, x - w / 2, y - w * 0.09, w, w * 0.18);
      }
    }

    if (weather === "rain" && this.airBox) {
      const slant = 0.05 + wind * 0.16;
      for (let i = 0; i < this.drops.length; i += 1) {
        const drop = this.drops[i]!;
        const speed = (280 + drop.size * 620) * scale;
        drop.y += dt * speed;
        drop.x += dt * speed * slant + dt * Math.sin(t * 0.37 + drop.seed) * 8;
        if (drop.y > this.airBox.y1 + 10) this.drops[i] = this.spawnDrop(false);
        const width = (0.9 + drop.size * 2.2) * scale;
        const length = (3 + drop.size * 12) * scale;
        context.globalAlpha = (0.045 + drop.size * 0.15) * (0.55 + 0.45 * Math.sin(drop.seed + drop.y * 0.018) ** 2);
        context.save();
        context.translate(drop.x, drop.y);
        context.rotate(-slant + Math.sin(t * 0.45 + drop.seed) * 0.04);
        context.drawImage(this.soft, -width / 2, -length / 2, width, length);
        context.restore();
      }
      context.strokeStyle = "#bac6c1";
      context.lineWidth = 0.65 * scale;
      for (let i = 0; i < this.splashes.length; i += 1) {
        const splash = this.splashes[i]!;
        splash.age += dt;
        if (splash.age > splash.life) {
          this.splashes[i] = this.spawnSplash(false);
          continue;
        }
        const progress = splash.age / splash.life;
        const radius = (0.5 + progress * splash.size) * scale;
        context.globalAlpha = Math.sin(progress * Math.PI) * 0.12;
        context.beginPath();
        context.ellipse(splash.x, splash.y, radius, radius * 0.16, -0.05, 0.3, 2.5);
        context.stroke();
        context.beginPath();
        context.ellipse(splash.x, splash.y, radius, radius * 0.16, -0.05, 3.5, 5.6);
        context.stroke();
      }
    }

    if ((weather === "snow" || weather === "dust") && this.airBox) {
      const sprite = weather === "snow" ? this.soft : this.dustSprite;
      for (let i = 0; i < this.drops.length; i += 1) {
        const flake = this.drops[i]!;
        const fall = weather === "snow" ? (25 + flake.size * 50) * scale : (4 + flake.size * 8) * scale;
        const across = weather === "snow" ? Math.sin(t * 0.8 + flake.seed) * 14 + wind * 40 : 30 + wind * 90;
        flake.y += fall * dt;
        flake.x += across * scale * dt;
        if (flake.y > this.airBox.y1 + 10 || flake.x > this.airBox.x1 + 20) {
          // Snow falls in from above; dust blows in from the side.
          const next = this.spawnDrop(weather === "dust");
          if (weather === "dust") next.x = this.airBox.x0 - 10;
          this.drops[i] = next;
        }
        const size = (weather === "snow" ? 1.6 + flake.size * 3.2 : 1 + flake.size * 1.6) * scale;
        context.globalAlpha = weather === "snow" ? 0.35 + flake.size * 0.45 : 0.18 + flake.size * 0.2;
        context.drawImage(sprite, flake.x - size / 2, flake.y - size / 2, size, size);
      }
    }
    context.restore();
    context.globalAlpha = 1;
  }

  /** Test hook: where the flames were found. */
  get flameShapes(): FlameShape[] {
    return this.flames.map((flame) => flame.shape);
  }
}
