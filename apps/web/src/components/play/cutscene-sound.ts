/**
 * The opening's ambience, mixed from what the painting shows. Fire is
 * synthesised (a low lapping roar, a faint hiss and short filtered-noise
 * crackles) so it never audibly loops; rain gets a synthesised bed under the
 * recorded loop for the same reason. Weather and crowds heard from indoors are
 * muffled. One `CrackleClock` drives both the crackles heard here and the
 * flares drawn by the scene effects, so sound and flame stay in step.
 */
import type { SoundscapeMix } from "@/lib/play/cutscene";

/** Random crackles at a mean rate, sometimes in quick runs, as burning wood does. */
export class CrackleClock {
  private handle = 0;
  private running = false;
  private readonly listeners = new Set<(strength: number) => void>();

  constructor(private readonly rate: number) {}

  subscribe(listener: (strength: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.running || this.rate <= 0) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    window.clearTimeout(this.handle);
  }

  private emit(strength: number): void {
    if (this.running) for (const listener of this.listeners) listener(strength);
  }

  private schedule(): void {
    const wait = Math.min(20_000, (-Math.log(1 - Math.random()) / this.rate) * 1000);
    this.handle = window.setTimeout(() => {
      const strength = 0.15 + Math.random() ** 2.2 * 0.85;
      this.emit(strength);
      if (Math.random() < 0.25) {
        const follow = 1 + Math.floor(Math.random() * 3);
        for (let i = 1; i <= follow; i += 1) window.setTimeout(() => this.emit(strength * (0.25 + Math.random() * 0.35)), i * (25 + Math.random() * 60));
      }
      if (this.running) this.schedule();
    }, wait);
  }
}

function noiseBuffer(context: BaseAudioContext, seconds: number, brown: boolean): AudioBuffer {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else data[i] = white;
  }
  return buffer;
}

export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private fire: { out: StereoPannerNode; roar: GainNode; roarLevel: number } | null = null;
  private white: AudioBuffer | null = null;
  private lapping = 0;
  private muted = false;
  private disposed = false;

  constructor(private readonly mix: SoundscapeMix, private readonly sfxBase: string) {}

  /** Audio may only start after a user gesture; call from one, or once the page has been interacted with. */
  start(): void {
    if (this.disposed) return;
    if (!this.context) this.build();
    void this.context?.resume().catch(() => {});
  }

  get started(): boolean {
    return this.context?.state === "running";
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.12);
  }

  /** One crackle, or for a wick a soft sputter. `strength` is 0..1. */
  crackle(strength: number): void {
    const context = this.context;
    const fire = this.fire;
    if (!context || !fire || !this.white || this.muted || context.state !== "running") return;
    const wood = this.mix.fire!.wood;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.white;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = wood ? 1800 + Math.random() * 4500 : 700 + Math.random() * 900;
    filter.Q.value = wood ? 0.8 + Math.random() * 2 : 2.5;
    const envelope = context.createGain();
    const peak = (wood ? 0.9 : 0.22) * strength * Math.sqrt(this.mix.fire!.gain);
    const length = wood ? 0.004 + strength * 0.02 : 0.02 + strength * 0.03;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(peak, now + 0.0015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + length * 3 + 0.01);
    source.connect(filter).connect(envelope).connect(fire.out);
    source.start(now, Math.random() * 1.5, length * 3 + 0.02);
    if (wood && strength > 0.55) {
      // A big pop has body as well as snap.
      const thump = context.createBufferSource();
      thump.buffer = this.white;
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 320;
      const body = context.createGain();
      body.gain.setValueAtTime(0, now);
      body.gain.linearRampToValueAtTime(peak * 0.9, now + 0.003);
      body.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      thump.connect(low).connect(body).connect(fire.out);
      thump.start(now, Math.random(), 0.08);
    } else if (!wood) {
      // A sputtering wick briefly drops its breath.
      fire.roar.gain.setTargetAtTime(fire.roarLevel * 0.4, now, 0.02);
      fire.roar.gain.setTargetAtTime(fire.roarLevel, now + 0.12, 0.15);
    }
  }

  /** Fade out, then release the audio device. */
  dispose(fadeMs = 900): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.lapping);
    const context = this.context;
    if (!context || !this.master) return;
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setTargetAtTime(0, context.currentTime, fadeMs / 4000);
    window.setTimeout(() => void context.close().catch(() => {}), fadeMs + 100);
  }

  private build(): void {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    this.context = context;
    const master = context.createGain();
    master.gain.value = 0;
    master.gain.setTargetAtTime(this.muted ? 0 : 1, context.currentTime, 0.6);
    master.connect(context.destination);
    this.master = master;
    this.white = noiseBuffer(context, 2, false);

    // Weather and crowds, heard through a doorway when the painting looks out from inside.
    const outside = context.createBiquadFilter();
    outside.type = "lowpass";
    outside.frequency.value = this.mix.muffled ? 2600 : 16_000;
    outside.connect(master);
    const loop = (name: string, gain: number) => {
      if (gain <= 0) return;
      void fetch(`${this.sfxBase}/${name}.ogg`)
        .then((response) => response.arrayBuffer())
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => {
          if (this.disposed) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const level = context.createGain();
          level.gain.value = gain;
          source.connect(level).connect(outside);
          source.start(context.currentTime, Math.random() * buffer.duration);
        })
        .catch(() => {});
    };
    loop("rain", this.mix.rain * 0.55);
    loop("wind", this.mix.wind);
    loop("crowd", this.mix.crowd);
    if (this.mix.rain > 0) {
      const bed = context.createBufferSource();
      bed.buffer = noiseBuffer(context, 3, false);
      bed.loop = true;
      const high = context.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 500;
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 6000;
      const level = context.createGain();
      level.gain.value = this.mix.rain * 0.12;
      bed.connect(high).connect(low).connect(level).connect(outside);
      bed.start();
    }

    const fire = this.mix.fire;
    if (fire) {
      const out = context.createStereoPanner();
      out.pan.value = fire.pan;
      out.connect(master);
      const roarSource = context.createBufferSource();
      roarSource.buffer = noiseBuffer(context, 4, true);
      roarSource.loop = true;
      const roarFilter = context.createBiquadFilter();
      roarFilter.type = "lowpass";
      roarFilter.frequency.value = fire.wood ? 520 : 260;
      const roar = context.createGain();
      const roarLevel = fire.wood ? 0.55 * fire.gain : 0.05;
      roar.gain.value = roarLevel;
      roarSource.connect(roarFilter).connect(roar).connect(out);
      roarSource.start();
      const hissSource = context.createBufferSource();
      hissSource.buffer = this.white;
      hissSource.loop = true;
      const hissFilter = context.createBiquadFilter();
      hissFilter.type = "highpass";
      hissFilter.frequency.value = 3200;
      const hiss = context.createGain();
      hiss.gain.value = fire.wood ? 0.035 * fire.gain : 0.006;
      hissSource.connect(hissFilter).connect(hiss).connect(out);
      hissSource.start();
      this.fire = { out, roar, roarLevel };
      // The roar laps: its level wanders rather than holding still.
      this.lapping = window.setInterval(() => {
        if (context.state === "running") roar.gain.setTargetAtTime(roarLevel * (0.65 + Math.random() * 0.7), context.currentTime, 0.08);
      }, 110);
    }
  }
}
