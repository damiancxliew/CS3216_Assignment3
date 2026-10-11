"""
Placeholder soundtrack and sound effects for the trailer, synthesised in code (no samples, no licence needed).

  python3 scripts/make_audio.py            # needs numpy
  FFMPEG=/path/to/ffmpeg python3 ...       # optional: master to -14 LUFS and make the muffled copy

Writes into public/audio/:
  lofi.wav          warm lo-fi bed (84 BPM, Fmaj7-Em7-Dm7-Cmaj7), for game beats
  lofi-muffled.wav  the same bed low-passed, for pitch beats
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


def rhodes(freq, seconds, vel=1.0):
    t = t_axis(seconds)
    env = np.exp(-t * 1.6) * (1 - np.exp(-t * 300))
    bell = np.exp(-t * 9)
    tone = (
        np.sin(2 * np.pi * freq * t)
        + 0.35 * np.sin(2 * np.pi * freq * 2 * t) * bell
        + 0.12 * np.sin(2 * np.pi * freq * 3 * t) * bell
        + 0.5 * np.sin(2 * np.pi * freq * 1.003 * t)
    )
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.8 * t)
    return tone * env * trem * vel


def reverb(x, mix=0.25, seconds=2.2):
    ir_t = t_axis(seconds)
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
    ir = lowpass_fft(ir, 3500)
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + len(ir)) * np.fft.rfft(ir, len(x) + len(ir)), len(x) + len(ir))[: len(x)]
    return (1 - mix) * x + mix * wet * 0.6


def lofi_bed(seconds=62.0, bpm=84):
    beat = 60 / bpm
    n = int(seconds * SR)
    keys = np.zeros(n)
    bass = np.zeros(n)
    drums = np.zeros(n)
    chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]  # Fmaj7 Em7 Dm7 Cmaj7
    roots = [41, 40, 38, 36]

    def add(buf, start, sig):
        i = int(start * SR)
        if i >= len(buf):
            return
        j = min(len(buf), i + len(sig))
        buf[i:j] += sig[: j - i]

    bar = 4 * beat
    bars = int(seconds / bar) + 1
    for b in range(bars):
        chord = chords[b % 4]
        start = b * bar
        # Chords: on the downbeat, and a softer push on the "and" of beat 3 (swung).
        for k, note in enumerate(chord):
            add(keys, start + k * 0.012, rhodes(midi(note), bar, 0.55))
            add(keys, start + 2.66 * beat + k * 0.01, rhodes(midi(note + 12 if k == 3 else note), beat * 1.3, 0.22))
        # Bass on 1 and the swung "and" of 2.
        for pos, length in ((0, 1.5), (1.66, 1.2)):
            t = t_axis(beat * length)
            sig = np.tanh(1.6 * np.sin(2 * np.pi * midi(roots[b % 4]) * t)) * np.exp(-t * 2.2) * (1 - np.exp(-t * 200))
            add(bass, start + pos * beat, sig * 0.8)
        for q in range(4):
            bt = start + q * beat
            if q in (0, 2):  # kick
                t = t_axis(0.42)
                f = 45 + 75 * np.exp(-t * 28)
                kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
                add(drums, bt, kick * 0.9)
            if q in (1, 3):  # soft snare: tone plus filtered noise
                t = t_axis(0.25)
                body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 26)
                noise = lowpass_fft(highpass_fft(rng.standard_normal(len(t)), 900), 5200) * np.exp(-t * 20)
                add(drums, bt, body * 0.35 + noise * 0.22)
            for h, swing in ((0, 0), (1, 0.62)):  # swung hats, quiet and dark
                t = t_axis(0.06)
                hat = lowpass_fft(highpass_fft(rng.standard_normal(len(t)), 6500), 11000) * np.exp(-t * 70)
                add(drums, bt + (h * swing * beat), hat * (0.07 if h else 0.1))

    keys = reverb(lowpass_fft(keys, 2600), 0.35)
    mix = keys * 0.5 + lowpass_fft(bass, 400) * 0.55 + drums * 0.42
    mix = lowpass_fft(mix, 9000)
    # Gentle fade in and out.
    fade = np.ones(n)
    fi, fo = int(1.5 * SR), int(3.0 * SR)
    fade[:fi] = np.linspace(0, 1, fi)
    fade[-fo:] = np.linspace(1, 0, fo)
    mix *= fade
    left = mix + 0.08 * np.roll(keys, 260)
    right = mix + 0.08 * np.roll(keys, -260)
    return np.stack([left, right], axis=1)


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
    raw = write("lofi-raw.wav", lofi_bed())
    if master(raw, os.path.join(OUT, "lofi.wav")):
        master(raw, os.path.join(OUT, "lofi-muffled.wav"), "lowpass=f=520,lowpass=f=520,volume=-4dB")
        os.remove(raw)
    else:
        os.replace(raw, os.path.join(OUT, "lofi.wav"))
    write("sfx-whoosh.wav", whoosh())
    write("sfx-impact.wav", impact())
    for i in range(4):
        write(f"sfx-key{i}.wav", typewriter_key(i))
    write("sfx-bell.wav", bell())
    write("sfx-pop.wav", pop())
    write("sfx-chime.wav", chime())
    print("written to", os.path.abspath(OUT))
