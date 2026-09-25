"""Synthesise the two street-life sounds used by the map renderer.

`chatter.ogg` is the short murmur played when a passer-by says something, and
`crowd.ogg` is the loopable background murmur that swells when the player walks
into a busy street. Both are generated here rather than sourced, so they carry no
third-party licence; re-run this script if the mix needs changing.

    python3 scripts/make-street-audio.py
"""

from __future__ import annotations

import pathlib
import subprocess
import tempfile
import wave

import numpy as np

RATE = 22050
OUT = pathlib.Path(__file__).resolve().parents[1] / "apps/web/public/game/ninja/audio/sfx"
# Vowel formant pairs: enough to read as speech without any words in it.
VOWELS = [(500, 1500), (700, 1100), (350, 1900), (600, 1650), (450, 1000)]


def syllable(rng: np.random.Generator, seconds: float, pitch: float, vowel: tuple[int, int]) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    # A glottal buzz plus two formants, wobbled so the pitch never sounds like a synth tone.
    wobble = 1 + 0.05 * np.sin(2 * np.pi * rng.uniform(3, 6) * t + rng.uniform(0, 6))
    phase = 2 * np.pi * pitch * wobble * t
    buzz = np.sign(np.sin(phase)) * 0.35 + np.sin(phase) * 0.65
    tone = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * gain for f, gain in zip(vowel, (0.5, 0.25)))
    attack = np.minimum(t / 0.03, 1)
    release = np.minimum((seconds - t) / 0.08, 1)
    return buzz * (0.6 + 0.4 * tone) * attack * np.clip(release, 0, 1)


def voice(rng: np.random.Generator, seconds: float, pitch: float) -> np.ndarray:
    """A few syllables with gaps: one person saying something indistinct."""
    out = np.zeros(int(seconds * RATE))
    cursor = rng.uniform(0, 0.15)
    while cursor < seconds - 0.2:
        length = rng.uniform(0.09, 0.2)
        chunk = syllable(rng, length, pitch * rng.uniform(0.94, 1.08), VOWELS[rng.integers(len(VOWELS))])
        start = int(cursor * RATE)
        out[start : start + len(chunk)] += chunk[: len(out) - start]
        cursor += length + rng.uniform(0.02, 0.12)
    return out


def lowpass(signal: np.ndarray, cutoff: float) -> np.ndarray:
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / RATE)
    return np.fft.irfft(spectrum / (1 + (freqs / cutoff) ** 2), len(signal))


def write_ogg(name: str, signal: np.ndarray, peak: float) -> None:
    signal = signal / max(np.max(np.abs(signal)), 1e-9) * peak
    frames = (np.clip(signal, -1, 1) * 32767).astype("<i2")
    with tempfile.TemporaryDirectory() as directory:
        raw = pathlib.Path(directory) / "audio.wav"
        with wave.open(str(raw), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(RATE)
            handle.writeframes(frames.tobytes())
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-c:a", "libvorbis", "-q:a", "2", str(OUT / name)],
            check=True,
        )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(7)
    line = voice(rng, 0.6, 150) + 0.35 * voice(rng, 0.6, 205)
    write_ogg("chatter.ogg", lowpass(line, 2600), 0.7)

    # Many quiet overlapping voices, then a half-second crossfade so the loop has no seam.
    rng = np.random.default_rng(11)
    seconds, fade = 6.5, 0.5
    crowd = sum(voice(rng, seconds, rng.uniform(110, 260)) * rng.uniform(0.25, 1.0) for _ in range(14))
    crowd = lowpass(crowd, 1400)
    tail = int(fade * RATE)
    ramp = np.linspace(0, 1, tail)
    crowd[:tail] = crowd[:tail] * ramp + crowd[-tail:] * (1 - ramp)
    write_ogg("crowd.ogg", crowd[:-tail], 0.55)


if __name__ == "__main__":
    main()
