import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CutsceneScene } from "@adventure/generation/assets";

import type { CutsceneArt } from "@/lib/play/cutscene";
import type { CrackleClock } from "./cutscene-sound";
import { SceneEffects } from "./scene-effects";
import styles from "./cutscene-theatre.module.css";

const DEFAULT_SIZE = { width: 1024, height: 1536 };

/**
 * The opening painting, cover-fitted, with its effects drawn in the painting's
 * own coordinates on canvases the same size, so they stay pinned to the art at
 * every crop. A painting with a scene description gets its flames, light and
 * weather; one without only drifts. Without a painting, room art fills in,
 * kept crisp because it is pixel art.
 */
export function CutsceneTheatre({ art, fallback, paused, clock }: {
  art: CutsceneArt | null;
  fallback: string | null;
  paused: boolean;
  clock: CrackleClock;
}) {
  return (
    <div className={styles.theatre} data-paused={paused} aria-hidden="true">
      {art ? <Painting src={art.src} scene={art.scene} focus={art.focus} paused={paused} clock={clock} /> : fallback ? <div className={`${styles.fill} ${styles.pixelated}`} style={{ backgroundImage: `url("${fallback}")` }} /> : <div className={styles.unpainted} />}
      <div className={styles.depth} />
      <div className={styles.dust}>
        {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--x": `${12 + index * 9}%`, "--delay": `${-index * 2.7}s`, "--duration": `${14 + index % 4 * 3}s` } as CSSProperties} />)}
      </div>
      <div className={styles.vignette} />
    </div>
  );
}

function Painting({ src, scene, focus, paused, clock }: { src: string; scene: CutsceneScene | null; focus: CutsceneArt["focus"]; paused: boolean; clock: CrackleClock }) {
  const container = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const air = useRef<HTMLCanvasElement>(null);
  const light = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const sync = useRef<(() => void) | null>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [frame, setFrame] = useState<CSSProperties>({ inset: 0 });

  // Cover the screen with the painting, keeping its focus centred as far as the edges allow.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      const scale = Math.max(width / size.width, height / size.height);
      const w = size.width * scale;
      const h = size.height * scale;
      const place = (view: number, extent: number, at: number) => Math.min(0, Math.max(view - extent, view / 2 - at * extent));
      setFrame({ width: w, height: h, left: place(width, w, focus.x), top: place(height, h, focus.y) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size, focus.x, focus.y]);

  useEffect(() => {
    pausedRef.current = paused;
    sync.current?.();
  }, [paused]);

  useEffect(() => {
    let disposed = false;
    let effects: SceneEffects | null = null;
    let frameHandle = 0;
    let previous = 0;
    let unsubscribe = () => {};
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const tick = (now: number) => {
      frameHandle = 0;
      if (!effects || disposed || pausedRef.current || motion.matches || document.hidden) return;
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      // 30fps is plenty for fire and weather, and halves the work on phones.
      if (!previous || now - previous >= 1000 / 30) {
        previous = now;
        effects.frame(dt);
      }
      frameHandle = requestAnimationFrame(tick);
    };
    const restart = () => {
      if (frameHandle) cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      previous = 0;
      if (!effects) return;
      if (motion.matches) effects.clear();
      else if (!pausedRef.current && !document.hidden) frameHandle = requestAnimationFrame(tick);
    };
    sync.current = restart;

    const begin = (image: HTMLImageElement) => {
      if (disposed) return;
      setSize({ width: image.naturalWidth, height: image.naturalHeight });
      if (!scene || !base.current || !air.current || !light.current) return;
      effects = new SceneEffects({ base: base.current, air: air.current, light: light.current }, image, scene);
      if (!effects.hasMotion) return;
      unsubscribe = clock.subscribe((strength) => effects?.flare(strength));
      restart();
    };
    // Reading the painting's pixels needs a CORS-clean copy; if that is refused
    // the painting still animates, with flames that glow but do not move.
    const reader = new Image();
    reader.crossOrigin = "anonymous";
    reader.onload = () => begin(reader);
    reader.onerror = () => {
      const plain = new Image();
      plain.onload = () => begin(plain);
      plain.src = src;
    };
    reader.src = src;

    motion.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    return () => {
      disposed = true;
      if (frameHandle) cancelAnimationFrame(frameHandle);
      unsubscribe();
      sync.current = null;
      motion.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [src, scene, clock]);

  return (
    <div ref={container} className={styles.fill}>
      <div className={`${styles.frame} ${styles.pan}`} style={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a painted scene, sized and cropped by its frame */}
        <img src={src} alt="" className={styles.layer} draggable={false} />
        <canvas ref={base} className={styles.layer} />
        <canvas ref={air} className={styles.layer} />
        <canvas ref={light} className={`${styles.layer} ${styles.screen}`} />
      </div>
      <div className={styles.sheen} />
    </div>
  );
}
