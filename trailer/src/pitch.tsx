import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/** How long the slide into a pitch card takes (frames); its words start landing as it settles. */
export const WIPE_FRAMES = 16;
import { bold, color, sans, serif, typewriter } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Sound = ({ src, at, volume = 0.6 }: { src: string; at: number; volume?: number }) => (
  <Sequence from={at} durationInFrames={60} layout="none">
    <Audio src={staticFile(`audio/sfx-${src}.wav`)} volume={volume} />
  </Sequence>
);

export type Tone = "ink" | "record" | "signal" | "world" | "paper";
const TONES: Record<Tone, { bg: string; fg: string; accent: string }> = {
  ink: { bg: color.ink, fg: "#fff8e9", accent: "#ffac86" },
  record: { bg: color.record, fg: "#ffffff", accent: "#ffd166" },
  signal: { bg: color.signal, fg: "#fff8e9", accent: color.ink },
  world: { bg: color.world, fg: "#ffffff", accent: "#ffd166" },
  paper: { bg: "#fff8e9", fg: color.ink, accent: color.signal },
};

/**
 * A bold pitch beat: a colour panel wipes across, then words slam in one by one.
 * Words wrapped in *asterisks* take the accent colour.
 */
export const PitchCard = ({ lines, tone = "ink", size = 150, align = "left" }: { lines: string[]; tone?: Tone; size?: number; align?: "left" | "center" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = TONES[tone];
  let wordIndex = 0;
  return (
    <AbsoluteFill style={{ background: t.bg, justifyContent: "center", padding: "0 150px" }}>
      <Sound src="whoosh" at={0} volume={0.5} />
      <div style={{ fontFamily: bold, fontWeight: 900, fontSize: size, lineHeight: 1.0, letterSpacing: -size * 0.03, color: t.fg, textAlign: align }}>
        {lines.map((line, li) => (
          <div key={li} style={{ marginBottom: size * 0.08 }}>
            {line.split(" ").map((raw) => {
              const accent = raw.startsWith("*");
              const word = raw.replace(/\*/g, "");
              const k = wordIndex++;
              const p = spring({ frame: frame - WIPE_FRAMES * 0.6 - k * 2.5, fps, config: { damping: 18, mass: 0.5, stiffness: 220 } });
              return (
                <span key={`${li}-${k}`} style={{ display: "inline-block", marginRight: size * 0.24, color: accent ? t.accent : undefined, opacity: p, transform: `scale(${1.35 - p * 0.35}) translateY(${(1 - p) * 30}px)`, filter: `blur(${(1 - p) * 10}px)` }}>
                  {word}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Rapid-fire single words or phrases, one per cut, each on its own colour. */
export const RapidWords = ({ items, every }: { items: { text: string; tone: Tone }[]; every: number }) => {
  const frame = useCurrentFrame();
  const i = Math.min(items.length - 1, Math.floor(frame / every));
  const local = frame - i * every;
  const t = TONES[items[i].tone];
  const p = interpolate(local, [0, 6], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: t.bg, alignItems: "center", justifyContent: "center" }}>
      {items.map((_, k) => <Sound key={k} src="impact" at={k * every} volume={0.45} />)}
      <div style={{ fontFamily: bold, fontWeight: 900, fontSize: 220, letterSpacing: -6, color: t.fg, transform: `scale(${1.25 - p * 0.25})`, opacity: p, filter: `blur(${(1 - p) * 8}px)` }}>{items[i].text}</div>
    </AbsoluteFill>
  );
};

/** Typewriter lines on black, with a key sound per character and a bell at each line's end. */
export const TypeScene = ({ lines, start = 10, cps = 14, gap = 18, children }: { lines: string[]; start?: number; cps?: number; gap?: number; children?: React.ReactNode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const perChar = fps / cps;
  let cursor = start;
  const plan = lines.map((line) => {
    const begin = cursor;
    cursor += line.length * perChar + gap;
    return { line, begin };
  });
  const lastEnd = cursor - gap;
  return (
    <AbsoluteFill style={{ background: "#0b0d12", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 28 }}>
      {plan.map(({ line, begin }, li) => {
        const shown = Math.max(0, Math.min(line.length, Math.floor((frame - begin) / perChar)));
        const typing = frame >= begin && shown < line.length;
        const isLast = li === plan.length - 1;
        return (
          <div key={li} style={{ fontFamily: typewriter, fontSize: li === 0 && lines.length > 1 ? 64 : 84, color: "#efe6d2", opacity: frame >= begin ? 1 : 0, textShadow: "0 0 18px rgba(239,230,210,0.15)" }}>
            {line.slice(0, shown)}
            <span style={{ opacity: (typing || (isLast && frame >= lastEnd)) && Math.floor(frame / 8) % 2 === 0 ? 1 : typing ? 1 : 0, color: color.signal }}>█</span>
            {Array.from({ length: line.length }, (_, c) => (line[c] === " " ? null : <Sound key={c} src={`key${c % 4}`} at={Math.round(begin + c * perChar)} volume={0.35} />))}
            <Sound src="bell" at={Math.round(begin + line.length * perChar + 2)} volume={0.18} />
          </div>
        );
      })}
      {children}
    </AbsoluteFill>
  );
};

/** Title card after the closing typewriter line. */
export const TitleCard = ({ at, tagline, audience, wip }: { at: number; tagline: string; audience: string; wip: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 16 } });
  const show = frame >= at;
  return show ? (
    <AbsoluteFill style={{ background: "#fff8e9", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: interpolate(frame, [at, at + 6], [0, 1], clamp) }}>
      <Sound src="chime" at={at} volume={0.5} />
      <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.92 + p * 0.08})` }}>
        <Img src={staticFile("logo.svg")} style={{ width: 150, height: 150 }} />
        <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 112, color: color.ink, letterSpacing: -1 }}>Historical Adventures</div>
      </div>
      <div style={{ fontFamily: serif, fontSize: 50, color: color.ink, marginTop: 36, opacity: interpolate(frame, [at + 14, at + 26], [0, 1], clamp) }}>{tagline}</div>
      <div style={{ fontFamily: sans, fontSize: 32, color: color.muted, marginTop: 22, opacity: interpolate(frame, [at + 24, at + 36], [0, 1], clamp) }}>{audience}</div>
      <div style={{ position: "absolute", bottom: 80, fontFamily: sans, fontWeight: 700, fontSize: 30, color: color.signal, opacity: interpolate(frame, [at + 34, at + 46], [0, 1], clamp) }}>{wip}</div>
    </AbsoluteFill>
  ) : null;
};
