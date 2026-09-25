/**
 * Background music for the play view. The map renderer is torn down and rebuilt
 * on every new stage, so music played from inside it restarts (and overlaps the
 * track the previous renderer was still fading out). Music therefore lives here,
 * outside the renderer: one track plays at a time, a new track crossfades over
 * the old one, and the old element is always stopped when the fade ends.
 */

export const MUSIC_VOLUME = 0.35;
const FADE_MS = 900;
const FADE_STEP_MS = 60;

/** The part of `HTMLAudioElement` this needs, so the fading is testable without a DOM. */
export interface MusicElement {
  loop: boolean;
  volume: number;
  muted: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export interface StageMusicOptions {
  createElement: (src: string) => MusicElement;
  setInterval?: (handler: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
}

interface Playing {
  element: MusicElement;
  target: number;
  fade: number | undefined;
}

export class StageMusic {
  private readonly options: Required<StageMusicOptions>;
  private track: string | null = null;
  private current: Playing | null = null;
  private fading: Playing[] = [];
  private muted = false;

  constructor(options: StageMusicOptions) {
    this.options = {
      setInterval: (handler, ms) => window.setInterval(handler, ms),
      clearInterval: (handle) => window.clearInterval(handle),
      ...options,
    };
  }

  /** Play `src`, crossfading from whatever is playing. Asking for the current track does nothing. */
  play(src: string | null): void {
    if (src === this.track) return;
    this.track = src;
    const previous = this.current;
    this.current = null;
    if (previous) {
      this.fading.push(previous);
      this.ramp(previous, 0, () => this.retire(previous));
    }
    if (!src) return;
    const element = this.options.createElement(src);
    element.loop = true;
    element.volume = 0;
    element.muted = this.muted;
    const next: Playing = { element, target: 0, fade: undefined };
    this.current = next;
    void Promise.resolve(element.play()).catch(() => {
      // Autoplay is refused until the page has been interacted with; the next
      // stage (or unmuting) tries again, and the game is playable without sound.
    });
    this.ramp(next, MUSIC_VOLUME);
  }

  /** Browsers refuse autoplay until the page is interacted with: try again after a gesture. */
  resume(): void {
    if (this.current) void Promise.resolve(this.current.element.play()).catch(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const playing of [this.current, ...this.fading]) {
      if (playing) playing.element.muted = muted;
    }
    if (!muted && this.current) void Promise.resolve(this.current.element.play()).catch(() => {});
  }

  /** Stop everything at once: leaving the game, not moving between stages. */
  stop(): void {
    this.track = null;
    for (const playing of [this.current, ...this.fading]) {
      if (playing) this.retire(playing);
    }
    this.current = null;
    this.fading = [];
  }

  private retire(playing: Playing): void {
    if (playing.fade !== undefined) this.options.clearInterval(playing.fade);
    playing.fade = undefined;
    playing.element.pause();
    this.fading = this.fading.filter((candidate) => candidate !== playing);
  }

  private ramp(playing: Playing, to: number, onDone?: () => void): void {
    if (playing.fade !== undefined) this.options.clearInterval(playing.fade);
    playing.target = to;
    const from = playing.element.volume;
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
    let step = 0;
    playing.fade = this.options.setInterval(() => {
      step += 1;
      playing.element.volume = Math.min(1, Math.max(0, from + ((to - from) * step) / steps));
      if (step < steps) return;
      if (playing.fade !== undefined) this.options.clearInterval(playing.fade);
      playing.fade = undefined;
      onDone?.();
    }, FADE_STEP_MS);
  }
}
