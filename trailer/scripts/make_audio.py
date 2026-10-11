"""
Placeholder soundtrack and sound effects for the trailer, synthesised in code (no samples, no licence needed).

  python3 scripts/make_audio.py            # needs numpy
  FFMPEG=/path/to/ffmpeg python3 ...       # optional: master to -14 LUFS

Writes into public/audio/:
  upbeat.wav        bright 120 BPM bed (Am-F-C-G); bars 1-2 intro pad, last 3 bars outro with a final hit
  sfx-*.wav         whoosh, impact, typewriter key/bell, pop, chime
"""
import os
import subprocess
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "audio")
rng = np.random.default_rng(1819)


def write(name, data):
    data = np.asarray(data, dtype=np.float64)
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)
    peak = np.max(np.abs(data)) or 1.0
    data = data / peak * 0.89
    pcm = (data * 32767).astype("<i2")
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    return path


def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def one_pole_lowpass(x, cutoff):
    """Simple warm low-pass; cutoff may be a scalar or an array (per sample)."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def lowpass_fft(x, cutoff, slope=24):
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / np.sqrt(1 + (freqs / cutoff) ** (slope / 3))
    return np.fft.irfft(spec, len(x))


def highpass_fft(x, cutoff, slope=24):
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 - 1 / np.sqrt(1 + (freqs / cutoff) ** (slope / 3))
    return np.fft.irfft(spec, len(x))


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)



def reverb(x, mix=0.25, seconds=2.2):
    ir_t = t_axis(seconds)
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
    ir = lowpass_fft(ir, 3500)
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + len(ir)) * np.fft.rfft(ir, len(x) + len(ir)), len(x) + len(ir))[: len(x)]
    return (1 - mix) * x + mix * wet * 0.6



def saw(freq, t, detune=0.0):
    """Band-limited-ish sawtooth via a handful of harmonics (keeps the top end clean)."""
    out = np.zeros_like(t)
    for k in range(1, 14):
        out += ((-1) ** (k + 1)) * np.sin(2 * np.pi * k * freq * (1 + detune) * t) / k
    return out * 0.6


def upbeat_bed(seconds=92.0, bpm=120):
    """
    Bright, driving placeholder: four-on-the-floor kick, claps on 2 and 4, offbeat hats, a pumping chord stab,
    an octave bassline and a pluck arpeggio. Bars 1-2 are an intro pad (the typewriter opening); from bar 3 the full
    groove; the last 3 bars drop back to pad with a final hit on the downbeat of the last bar.
    Chords: Am - F - C - G (one per bar).
    """
    beat = 60 / bpm
    bar = 4 * beat
    n = int(seconds * SR)
    bars = int(seconds / bar)
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
    roots = [45, 41, 48, 43]
    pad, stab, bass, pluck, drums = (np.zeros(n) for _ in range(5))
    pump = np.ones(n)

    def add(buf, start, sig):
        i = int(start * SR)
        if 0 <= i < len(buf):
            j = min(len(buf), i + len(sig))
            buf[i:j] += sig[: j - i]

    full_from, outro_from = 2, bars - 3
    for b in range(bars):
        start = b * bar
        chord, root = chords[b % 4], roots[b % 4]
        # Pad throughout (soft, detuned saws).
        t = t_axis(bar)
        env = np.minimum(1, t / 0.08) * np.minimum(1, (bar - t) / 0.08)
        add(pad, start, sum(saw(midi(n_ + 12), t, d) for n_ in chord for d in (-0.004, 0.004)) * env * 0.12)
        if b < full_from or b >= outro_from:
            continue
        for q in range(4):
            bt = start + q * beat
            # Kick and sidechain pump.
            t = t_axis(0.35)
            f = 50 + 110 * np.exp(-t * 35)
            add(drums, bt, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) * 1.0)
            i = int(bt * SR)
            dip = 1 - 0.65 * np.exp(-t_axis(beat) * 9)
            pump[i:i + len(dip)] = np.minimum(pump[i:i + len(dip)], dip[: max(0, min(len(dip), n - i))])
            if q in (1, 3):  # clap
                t = t_axis(0.22)
                clap = lowpass_fft(highpass_fft(rng.standard_normal(len(t)), 1200), 7000) * (np.exp(-t * 30) + 0.4 * np.exp(-np.abs(t - 0.012) * 400))
                add(drums, bt, clap * 0.45)
            # Offbeat hat.
            t = t_axis(0.08)
            add(drums, bt + beat / 2, lowpass_fft(highpass_fft(rng.standard_normal(len(t)), 7000), 12000) * np.exp(-t * 45) * 0.16)
            # Chord stab on the offbeat.
            t = t_axis(beat * 0.45)
            st = sum(saw(midi(n_ + 12), t, d) for n_ in chord for d in (-0.006, 0.006)) * np.exp(-t * 7)
            add(stab, bt + beat / 2, lowpass_fft(st, 3200) * 0.22)
            # Octave bass on eighths.
            for e in range(2):
                t = t_axis(beat * 0.45)
                note = root + (12 if e else 0)
                bs = lowpass_fft(saw(midi(note), t), 900) * np.exp(-t * 5) * (1 - np.exp(-t * 300))
                add(bass, bt + e * beat / 2, bs * 0.7)
        # Pluck arpeggio on sixteenths, up the chord.
        arp = [chord[0] + 24, chord[1] + 24, chord[2] + 24, chord[1] + 24]
        for k in range(16):
            t = t_axis(beat / 4 * 0.9)
            pl = lowpass_fft(saw(midi(arp[k % 4]), t), 4200) * np.exp(-t * 18)
            add(pluck, start + k * beat / 4, pl * 0.12)

    # Final hit on the last bar's downbeat.
    t = t_axis(2.4)
    f = 40 + 120 * np.exp(-t * 20)
    hit = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.5) + sum(saw(midi(n_ + 12), t) for n_ in chords[0]) * np.exp(-t * 1.6) * 0.25
    add(drums, (bars - 1) * bar, hit * 0.9)

    mix = drums * 0.55 + (stab + pluck + bass * 0.9) * pump + reverb(pad, 0.3) * (0.6 + 0.4 * pump)
    mix = lowpass_fft(highpass_fft(mix, 30), 14000)
    fade = np.ones(n)
    fo = int(1.5 * SR)
    fade[-fo:] = np.linspace(1, 0, fo)
    mix *= fade
    width = reverb(pluck + stab, 0.5, 1.0)
    return np.stack([mix + 0.15 * np.roll(width, 300), mix + 0.15 * np.roll(width, -300)], axis=1)


def whoosh():
    t = t_axis(0.55)
    env = np.sin(np.pi * np.clip(t / 0.55, 0, 1)) ** 2
    noise = rng.standard_normal(len(t))
    sweep = 400 + 5200 * (t / 0.55) ** 1.4
    return one_pole_lowpass(noise, sweep) * env


def impact():
    t = t_axis(0.9)
    f = 38 + 90 * np.exp(-t * 16)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    thud = lowpass_fft(rng.standard_normal(len(t)), 900) * np.exp(-t * 30)
    return reverb(boom + 0.5 * thud, 0.3, 1.5)


def typewriter_key(seed):
    r = np.random.default_rng(seed)
    t = t_axis(0.07)
    click = highpass_fft(r.standard_normal(len(t)), 1800) * np.exp(-t * 160)
    thock = np.sin(2 * np.pi * (180 + r.uniform(-20, 20)) * t) * np.exp(-t * 90)
    return click * 0.7 + thock * 0.5


def bell():
    t = t_axis(1.4)
    return sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in ((2093, 1, 3), (4186, 0.35, 6), (3136, 0.2, 5)))


def pop():
    t = t_axis(0.09)
    f = 700 + 900 * (t / 0.09)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 40)


def chime():
    out = np.zeros(int(0.9 * SR))
    for k, n in enumerate((88, 95)):
        t = t_axis(0.9 - k * 0.09)
        out[int(k * 0.09 * SR):] += np.sin(2 * np.pi * midi(n) * t) * np.exp(-t * 5) * (1 - np.exp(-t * 400))
    return reverb(out, 0.3, 1.2)


def master(src, dst, extra=""):
    ff = os.environ.get("FFMPEG")
    if not ff:
        return False
    flt = (extra + "," if extra else "") + "loudnorm=I=-14:TP=-1.5:LRA=11"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", src, "-af", flt, "-ar", str(SR), dst], check=True)
    return True


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    raw = write("upbeat-raw.wav", upbeat_bed())
    if master(raw, os.path.join(OUT, "upbeat.wav")):
        os.remove(raw)
    else:
        os.replace(raw, os.path.join(OUT, "upbeat.wav"))
    write("sfx-whoosh.wav", whoosh())
    write("sfx-impact.wav", impact())
    for i in range(4):
        write(f"sfx-key{i}.wav", typewriter_key(i))
    write("sfx-bell.wav", bell())
    write("sfx-pop.wav", pop())
    write("sfx-chime.wav", chime())
    print("written to", os.path.abspath(OUT))
