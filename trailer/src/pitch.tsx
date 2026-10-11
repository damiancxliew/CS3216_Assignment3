import type { ReactNode } from "react";
import { AbsoluteFill, Easing, Freeze, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PreviewContext, Sound } from "./sound";
import { bold, color, sans, serif, typewriter } from "./theme";


const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = { ...clamp, easing: Easing.inOut(Easing.cubic) };

export type Tone = "ink" | "record" | "signal" | "world" | "paper";
const TONES: Record<Tone, { bg: string; fg: string; accent: string; stripe: string }> = {
  ink: { bg: color.ink, fg: "#fff8e9", accent: "#ffac86", stripe: "rgba(255,255,255,0.035)" },
  record: { bg: color.record, fg: "#ffffff", accent: "#ffd166", stripe: "rgba(255,255,255,0.06)" },
  signal: { bg: color.signal, fg: "#fff8e9", accent: color.ink, stripe: "rgba(0,0,0,0.06)" },
  world: { bg: color.world, fg: "#ffffff", accent: "#ffd166", stripe: "rgba(255,255,255,0.06)" },
  paper: { bg: "#fff8e9", fg: color.ink, accent: color.signal, stripe: "rgba(23,32,51,0.04)" },
};

/** Coloured ground with slowly travelling diagonal stripes. */
const Ground = ({ tone, children }: { tone: Tone; children: ReactNode }) => {
  const frame = useCurrentFrame();
  const t = TONES[tone];
  return (
    <AbsoluteFill style={{ background: t.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(-55deg, ${t.stripe} 0 60px, transparent 60px 140px)`, backgroundPosition: `${frame * 2}px 0` }} />
      {children}
    </AbsoluteFill>
  );
};

/** Words slam in one by one; words wrapped in *asterisks* take the accent colour. */
const Slam = ({ lines, size, start, fg, accent }: { lines: string[]; size: number; start: number; fg: string; accent: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let k = 0;
  return (
    <div style={{ fontFamily: bold, fontWeight: 900, fontSize: size, lineHeight: 1.0, letterSpacing: -size * 0.03, color: fg }}>
      {lines.map((line, li) => (
        <div key={li} style={{ marginBottom: size * 0.1 }}>
          {line.split(" ").map((raw) => {
            const i = k++;
            const p = Math.min(1, spring({ frame: frame - start - i * 2.5, fps, config: { damping: 18, mass: 0.5, stiffness: 220 } }));
            const settled = p > 0.985;
            return (
              <span key={i} style={{ display: "inline-block", marginRight: size * 0.24, color: raw.startsWith("*") ? accent : undefined, opacity: settled ? 1 : p, transform: settled ? undefined : `scale(${1.35 - p * 0.35}) translateY(${(1 - p) * 30}px)`, filter: settled ? undefined : `blur(${(1 - p) * 10}px)` }}>
                {raw.replace(/\*/g, "")}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/**
 * A claim with its proof: chapter number and statement on the left, a tilted window on the right showing the first
 * frame of the next game beat, which zooms to fill the screen in the card's last frames so the cut is seamless.
 */
export const ClaimCard = ({ chapter, label, lines, tone, size = 120, next: Next, duration }: {
  chapter: string; label: string; lines: string[]; tone: Tone; size?: number; next: () => ReactNode; duration: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = TONES[tone];
  const zoomFrom = duration - 12;
  const z = interpolate(frame, [zoomFrom, duration], [0, 1], ease);
  const enter = spring({ frame: frame - 6, fps, config: { damping: 16, mass: 0.7 } });
  const W = 820;
  const H = (W * 1080) / 1920;
  const box = {
    left: interpolate(z, [0, 1], [1010, 0]),
    top: interpolate(z, [0, 1], [330 + (1 - enter) * 120, 0]),
    width: interpolate(z, [0, 1], [W, 1920]),
    rotate: interpolate(z, [0, 1], [-3.5, 0]),
    border: interpolate(z, [0, 1], [14, 0]),
    radius: interpolate(z, [0, 1], [22, 0]),
  };
  const scale = box.width / 1920;
  return (
    <Ground tone={tone}>
      <Sound src="whoosh" at={0} volume={0.45} />
      <div style={{ position: "absolute", left: 130, top: 150, opacity: 1 - z, transform: `translateX(${-z * 200}px)` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 22, opacity: interpolate(frame, [2, 10], [0, 1], clamp) }}>
          <span style={{ fontFamily: bold, fontWeight: 900, fontSize: 150, lineHeight: 1, color: "transparent", WebkitTextStroke: `3px ${t.fg}`, opacity: 0.55 }}>{chapter}</span>
          <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 30, letterSpacing: 6, color: t.accent }}>{label}</span>
        </div>
        <div style={{ width: 860, marginTop: 40 }}>
          <Slam lines={lines} size={size} start={8} fg={t.fg} accent={t.accent} />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: (box.width * 1080) / 1920,
          transform: `rotate(${box.rotate}deg)`,
          borderRadius: box.radius,
          boxShadow: z < 1 ? `0 0 0 ${box.border}px #0b0d12, 0 40px 80px rgba(0,0,0,${0.45 * (1 - z)})` : undefined,
          overflow: "hidden",
          opacity: enter,
        }}
      >
        <div style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative" }}>
          <PreviewContext.Provider value>
            <Freeze frame={0}>
              <Next />
            </Freeze>
          </PreviewContext.Provider>
        </div>
      </div>
      {z === 0 ? <div style={{ position: "absolute", left: 1010 + W - 210, top: 330 + H + 30, fontFamily: sans, fontWeight: 700, fontSize: 24, letterSpacing: 4, color: t.fg, opacity: 0.75 * enter }}>IN THE GAME ▶</div> : null}
    </Ground>
  );
};

const BookStack = () => (
  <svg width="360" height="300" viewBox="0 0 36 30" shapeRendering="crispEdges" aria-hidden>
    {[["#6d2a17", 2, 22, 30], ["#1f4b8a", 4, 16, 28], ["#4f6033", 1, 10, 31], ["#8a6a2a", 5, 4, 26]].map(([c, x, y, w], i) => (
      <g key={i}>
        <rect x={x as number} y={y as number} width={w as number} height={6} fill={c as string} />
        <rect x={(x as number) + 2} y={(y as number) + 2} width={(w as number) - 6} height={1} fill="rgba(255,255,255,0.35)" />
      </g>
    ))}
  </svg>
);

const BlandChat = () => (
  <div style={{ width: 520, background: "#ffffff", borderRadius: 28, padding: "26px 30px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)" }}>
    <div style={{ fontFamily: sans, fontSize: 22, fontWeight: 700, color: "#8a93a3", marginBottom: 10 }}>AI chatbot</div>
    <div style={{ fontFamily: sans, fontSize: 30, lineHeight: 1.35, color: "#3a4150" }}>Great question! Here are 5 key facts about 1819 you should know…</div>
  </div>
);

/** A single bold statement on a striped colour ground. */
export const StatementCard = ({ lines, tone, size = 130 }: { lines: string[]; tone: Tone; size?: number }) => {
  const t = TONES[tone];
  return (
    <Ground tone={tone}>
      <Sound src="whoosh" at={0} volume={0.45} />
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 150px" }}>
        <Slam lines={lines} size={size} start={8} fg={t.fg} accent={t.accent} />
      </AbsoluteFill>
    </Ground>
  );
};

/** A statement on the left with its own illustration on the right. */
export const IllustratedCard = ({ lines, tone, art, size = 104 }: { lines: string[]; tone: Tone; art: ReactNode; size?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - 10, fps, config: { damping: 15 } });
  const t = TONES[tone];
  return (
    <Ground tone={tone}>
      <Sound src="whoosh" at={0} volume={0.45} />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140 }}>
        <div style={{ width: 960 }}>
          <Slam lines={lines} size={size} start={8} fg={t.fg} accent={t.accent} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", right: 130, top: "50%", opacity: a, transform: `translateY(calc(-50% + ${(1 - a) * 80}px))` }}>{art}</div>
    </Ground>
  );
};

/** An exam-style source question on paper (illustrative). */
export const ExamPaper = ({ q }: { q: { section: string; prompt: string; statement: string; ask: string; marks: string } }) => (
  <div style={{ width: 640, background: "#fbfaf6", padding: "40px 46px 34px", boxShadow: "0 30px 60px rgba(0,0,0,0.4)", transform: "rotate(3deg)", fontFamily: serif, color: "#1d2230" }}>
    <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 20, letterSpacing: 2, textTransform: "uppercase", borderBottom: "2px solid #1d2230", paddingBottom: 10, marginBottom: 18 }}>{q.section}</div>
    <div style={{ fontSize: 26, marginBottom: 14 }}>{q.prompt}</div>
    <div style={{ fontSize: 28, fontStyle: "italic", lineHeight: 1.35, marginBottom: 14 }}>{q.statement}</div>
    <div style={{ fontSize: 26, lineHeight: 1.35 }}>
      {q.ask} <span style={{ float: "right", fontWeight: 700 }}>{q.marks}</span>
    </div>
    <div style={{ marginTop: 26 }}>
      {Array.from({ length: 4 }, (_, i) => <div key={i} style={{ height: 34, borderBottom: "1.5px solid #c9ccd6" }} />)}
    </div>
  </div>
);

export const BookArt = () => (
  <div style={{ transform: "rotate(-4deg)" }}>
    <BookStack />
  </div>
);

export const ChatArt = () => (
  <div style={{ transform: "rotate(3deg)" }}>
    <BlandChat />
  </div>
);

const ICONS: Record<string, ReactNode> = {
  sources: (
    <svg width="160" height="160" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      <rect x="3" y="1" width="9" height="12" fill="#f3e3bd" /><rect x="5" y="3" width="9" height="12" fill="#fff8e9" />
      <rect x="7" y="6" width="5" height="1" fill="#172033" /><rect x="7" y="8" width="5" height="1" fill="#172033" /><rect x="7" y="10" width="3" height="1" fill="#172033" />
    </svg>
  ),
  lesson: (
    <svg width="160" height="160" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      <rect x="2" y="2" width="12" height="12" fill="#fff8e9" /><rect x="3" y="3" width="10" height="10" fill="#3659cf" />
      <rect x="7" y="4" width="2" height="5" fill="#fff8e9" /><rect x="9" y="7" width="3" height="2" fill="#fff8e9" />
    </svg>
  ),
  marks: (
    <svg width="160" height="160" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      <rect x="2" y="2" width="12" height="12" fill="#fff8e9" />
      <text x="8" y="11.5" textAnchor="middle" fontFamily="Arial" fontWeight="900" fontSize="7" fill="#172033">A+</text>
      <rect x="1" y="7" width="14" height="2" fill="#d85f35" transform="rotate(-35 8 8)" />
    </svg>
  ),
  thinking: (
    <svg width="160" height="160" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      <rect x="5" y="2" width="6" height="7" fill="#ffd166" /><rect x="4" y="3" width="8" height="5" fill="#ffd166" />
      <rect x="6" y="10" width="4" height="2" fill="#fff8e9" /><rect x="6" y="13" width="4" height="1" fill="#fff8e9" />
    </svg>
  ),
};

/** Rapid-fire benefits, one per beat, each with an icon. */
export const RapidWords = ({ items, every }: { items: { text: string; tone: Tone; icon: keyof typeof ICONS }[]; every: number }) => {
  const frame = useCurrentFrame();
  const i = Math.min(items.length - 1, Math.floor(frame / every));
  const local = frame - i * every;
  const t = TONES[items[i].tone];
  const p = interpolate(local, [0, 6], [0, 1], clamp);
  return (
    <Ground tone={items[i].tone}>
      {items.map((_, k) => <Sound key={k} src="impact" at={k * every} volume={0.4} />)}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 30 }}>
        <div style={{ transform: `scale(${0.6 + p * 0.4}) rotate(${(1 - p) * -12}deg)`, opacity: p }}>{ICONS[items[i].icon]}</div>
        <div style={{ fontFamily: bold, fontWeight: 900, fontSize: 190, letterSpacing: -6, color: t.fg, transform: p < 1 ? `scale(${1.2 - p * 0.2})` : undefined, opacity: p, filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined }}>{items[i].text}</div>
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 70, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        {items.map((_, k) => <div key={k} style={{ width: 70, height: 10, background: k <= i ? t.fg : "rgba(255,255,255,0.25)" }} />)}
      </div>
    </Ground>
  );
};

/** Typewriter lines on black, with a key sound per character and a bell at each line's end. */
export const TypeScene = ({ lines, start = 10, cps = 14, gap = 18, children }: { lines: string[]; start?: number; cps?: number; gap?: number; children?: ReactNode }) => {
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
        const blink = li === plan.length - 1 && frame >= lastEnd && Math.floor(frame / 8) % 2 === 0;
        return (
          <div key={li} style={{ fontFamily: typewriter, fontSize: li === 0 && lines.length > 1 ? 64 : 84, color: "#efe6d2", opacity: frame >= begin ? 1 : 0}}>
            {line.slice(0, shown)}
            <span style={{ opacity: typing || blink ? 1 : 0, color: color.signal }}>█</span>
            {Array.from({ length: line.length }, (_, c) => (line[c] === " " ? null : <Sound key={c} src={`key${c % 4}`} at={begin + c * perChar} volume={0.35} />))}
            <Sound src="bell" at={begin + line.length * perChar + 2} volume={0.18} />
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
  if (frame < at) return null;
  return (
    <AbsoluteFill style={{ background: "#fff8e9", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: interpolate(frame, [at, at + 6], [0, 1], clamp) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.92 + p * 0.08})` }}>
        <Img src={staticFile("logo.svg")} style={{ width: 150, height: 150 }} />
        <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 112, color: color.ink, letterSpacing: -1 }}>Historical Adventures</div>
      </div>
      <div style={{ fontFamily: serif, fontSize: 50, color: color.ink, marginTop: 36, opacity: interpolate(frame, [at + 14, at + 26], [0, 1], clamp) }}>{tagline}</div>
      <div style={{ fontFamily: sans, fontSize: 32, color: color.muted, marginTop: 22, opacity: interpolate(frame, [at + 24, at + 36], [0, 1], clamp) }}>{audience}</div>
      <div style={{ position: "absolute", bottom: 80, fontFamily: sans, fontWeight: 700, fontSize: 30, color: color.signal, opacity: interpolate(frame, [at + 34, at + 46], [0, 1], clamp) }}>{wip}</div>
    </AbsoluteFill>
  );
};
