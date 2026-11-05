import type { ReactNode } from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cast, pitch } from "./episode";
import { PixelFace } from "./hud";
import { T, TOWN_H, TOWN_W, Town, World } from "./pixel";
import { WORD_SPRING } from "./pitch";
import { Sound } from "./sound";
import { bold, color, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const c = pitch.create;

/** Big headline that lands at the top left of a creation shot. */
const Headline = ({ text, at, until, top = 80, light = false, children }: { text: string; at: number; until?: number; top?: number; light?: boolean; children?: ReactNode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.min(1, spring({ frame: frame - at, fps, config: WORD_SPRING }));
  if (frame < at || (until !== undefined && frame >= until)) return null;
  return (
    <div style={{ position: "absolute", left: 120, top, display: "flex", alignItems: "center", gap: 26, fontFamily: bold, fontWeight: 900, fontSize: 84, letterSpacing: -2, color: light ? "#fff8e9" : color.ink, opacity: p, transform: p < 0.985 ? `translateY(${(1 - p) * 24}px) scale(${1.1 - p * 0.1})` : undefined, transformOrigin: "left center" }}>
      {text}
      {children}
    </div>
  );
};

/** The teacher console, drawn as a simple app window. */
const ConsoleWindow = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
  <div style={{ position: "absolute", left: 120, right: 120, top: 230, bottom: 70, background: "#ffffff", borderRadius: 22, boxShadow: "0 40px 90px rgba(23,32,51,0.18)", overflow: "hidden", fontFamily: sans, color: color.ink, ...style }}>
    <div style={{ height: 58, background: "#f4efe3", display: "flex", alignItems: "center", gap: 12, padding: "0 24px", borderBottom: "1px solid #e3dccb" }}>
      {["#e86a5c", "#f1bf4a", "#5cc26a"].map((dot) => <div key={dot} style={{ width: 16, height: 16, borderRadius: 999, background: dot }} />)}
      <div style={{ marginLeft: 24, fontSize: 20, fontWeight: 600, color: color.muted }}>Pocket Adventures › Historical Adventures</div>
    </div>
    <div style={{ position: "absolute", top: 58, left: 0, right: 0, bottom: 0 }}>{children}</div>
  </div>
);

/** Plain paper background. */
const Paper = ({ children }: { children: ReactNode }) => <AbsoluteFill style={{ background: color.paper, overflow: "hidden" }}>{children}</AbsoluteFill>;

const FileCard = ({ name, at, index }: { name: string; at: number; index: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 14, mass: 0.6 } });
  const ext = name.split(".").pop()?.toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, background: "#fff", border: "2px solid #e6dcc5", borderRadius: 14, padding: "14px 20px", marginBottom: 14, opacity: Math.min(1, p * 1.4), transform: `translate(${(1 - p) * -260}px, ${(1 - p) * (index - 1) * 60}px) rotate(${(1 - p) * -8}deg)` }}>
      <Sound src="pop" at={at} volume={0.4} />
      <div style={{ width: 50, height: 62, background: ext === "PDF" ? "#d85f35" : color.record, borderRadius: 6, color: "#fff", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8 }}>{ext}</div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{name}</div>
    </div>
  );
};

/** A mouse pointer gliding between targets: [frame, x, y] keyframes; `clicks` are frames where it presses. */
const Pointer = ({ path, clicks = [] }: { path: [number, number, number][]; clicks?: number[] }) => {
  const frame = useCurrentFrame();
  const fs = path.map((p) => p[0]);
  const x = interpolate(frame, fs, path.map((p) => p[1]), { ...clamp, easing: easeOut });
  const y = interpolate(frame, fs, path.map((p) => p[2]), { ...clamp, easing: easeOut });
  const pressed = clicks.some((k) => frame >= k && frame < k + 5);
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 20, transform: `scale(${pressed ? 0.85 : 1})`, transformOrigin: "0 0", opacity: frame < path[0][0] ? 0 : 1 }}>
      {clicks.map((k) => <Sound key={k} src="pop" at={k} volume={0.3} />)}
      {clicks.map((k) => {
        const r = interpolate(frame, [k, k + 12], [0, 1], clamp);
        return r > 0 && r < 1 ? <div key={`r${k}`} style={{ position: "absolute", left: -30 * r, top: -30 * r, width: 60 * r, height: 60 * r, borderRadius: 999, border: `3px solid ${color.signal}`, opacity: 1 - r }} /> : null;
      })}
      <svg width="44" height="52" viewBox="0 0 22 26" aria-hidden style={{ filter: "drop-shadow(2px 3px 2px rgba(0,0,0,0.35))" }}>
        <path d="M1 1 L1 20 L6 15 L10 24 L13 23 L9 14 L16 14 Z" fill="#ffffff" stroke={color.ink} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Chip = ({ children, tone = "record", size = 20 }: { children: ReactNode; tone?: "record" | "world" | "signal" | "muted"; size?: number }) => {
  const bg = { record: color.recordWash, world: color.worldWash, signal: color.signalWash, muted: "#eee8da" }[tone];
  const fg = { record: color.record, world: color.world, signal: color.signal, muted: color.muted }[tone];
  return <span style={{ display: "inline-block", fontFamily: sans, fontSize: size, fontWeight: 700, letterSpacing: 0, color: fg, background: bg, padding: "6px 16px", borderRadius: 999 }}>{children}</span>;
};

const pop = (frame: number, at: number) => interpolate(frame, [at, at + 8], [0, 1], clamp);

/** Frames each of the three steps holds the stage. */
const STEP = 70;

/** The three-step tracker across the top: done steps tick, the current one is highlighted. */
const Steps = ({ active }: { active: number }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 70, display: "flex", justifyContent: "center", gap: 28 }}>
      {c.steps.map((label, i) => {
        const done = i < active;
        const on = i === active;
        const p = pop(frame, i * 6);
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 30px 16px 18px", borderRadius: 999, background: on ? color.ink : done ? color.worldWash : "#efe9db", color: on ? "#fff8e9" : done ? color.world : color.muted, fontFamily: bold, fontWeight: 800, fontSize: 38, opacity: p, transform: `scale(${on ? 1.04 : 1})` }}>
            <span style={{ width: 54, height: 54, borderRadius: 999, background: on ? color.signal : done ? color.world : "#d9d1bf", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>{done ? "✓" : i + 1}</span>
            {label}
          </div>
        );
      })}
    </div>
  );
};

/** Step 1: sources dropped into one box. */
const DropStep = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: 980, border: "4px dashed #c9bfa6", borderRadius: 28, padding: "40px 46px", background: "#fffdf7" }}>
      {c.files.map((f, i) => <FileCard key={f} name={f} at={6 + i * 8} index={i} />)}
    </div>
  </AbsoluteFill>
);

/** Step 2: the adventure builds itself; every fact keeps a link to its source. */
const BuildStep = () => {
  const frame = useCurrentFrame();
  const bar = interpolate(frame, [4, 60], [0, 1], { ...clamp, easing: easeOut });
  const people = [cast.temenggong, cast.raffles, cast.hussein, cast.farquhar, cast.player];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1180, fontFamily: sans, color: color.ink }}>
        <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 18 }}>{c.building}</div>
        <div style={{ height: 22, background: "#efe8d8", borderRadius: 999, overflow: "hidden", marginBottom: 34 }}>
          <div style={{ width: `${bar * 100}%`, height: "100%", background: color.world, borderRadius: 999 }} />
        </div>
        <div style={{ display: "flex", gap: 40, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {people.map((person, i) => {
              const p = pop(frame, 10 + i * 6);
              return <div key={person.name} style={{ opacity: p, transform: `scale(${0.6 + p * 0.4})` }}><PixelFace sprite={person.sprite} size={110} /></div>;
            })}
          </div>
          <div style={{ position: "relative", width: 520, height: 292, borderRadius: 16, overflow: "hidden", background: "#e9e2cf", boxShadow: `0 0 0 5px ${color.ink}` }}>
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - interpolate(frame, [16, 56], [0, 1], clamp)) * 100}% 0 0)` }}>
              <div style={{ width: 1920, height: 1080, transform: `scale(${520 / 1920})`, transformOrigin: "0 0" }}>
                <World camX={6 * T} width={TOWN_W} height={TOWN_H}>
                  <Town />
                </World>
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 30, opacity: pop(frame, 44) }}><Chip tone="world" size={26}>✓ {c.linked}</Chip></div>
      </div>
    </AbsoluteFill>
  );
};

/** Step 3: one button, and the game opens. */
const PlayStep = () => {
  const frame = useCurrentFrame();
  const open = interpolate(frame, [14, 34], [0, 1], { ...clamp, easing: easeOut });
  const W = interpolate(open, [0, 1], [380, 1500]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 80 }}>
      {open < 0.05 ? (
        <div style={{ fontFamily: bold, fontSize: 56, fontWeight: 800, color: "#fff", background: color.world, padding: "26px 64px", borderRadius: 22, boxShadow: "0 20px 40px rgba(37,134,99,0.35)", transform: frame >= 10 && frame < 15 ? "scale(0.94)" : `scale(${1 + Math.sin(frame / 3) * 0.02})` }}>▶ Play</div>
      ) : (
        <div style={{ width: W, height: (W * 9) / 16, borderRadius: 20, overflow: "hidden", boxShadow: `0 0 0 8px ${color.ink}, 0 30px 60px rgba(0,0,0,0.25)` }}>
          <div style={{ width: 1920, height: 1080, transform: `scale(${W / 1920})`, transformOrigin: "0 0" }}>
            <World camX={2 * T + frame * 0.8} width={TOWN_W} height={TOWN_H}>
              <Town />
            </World>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Making an adventure: drop in sources, we build it, press play. */
export const EasyScene = () => {
  const frame = useCurrentFrame();
  const i = Math.min(2, Math.floor(frame / STEP));
  const local = frame - i * STEP;
  const Step = [DropStep, BuildStep, PlayStep][i];
  return (
    <Paper>
      <Steps active={i} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 168, textAlign: "center", fontFamily: sans, fontSize: 30, fontWeight: 600, color: color.muted, opacity: pop(frame, 14) }}>{c.noSkills}</div>
      <AbsoluteFill style={{ top: 120, opacity: interpolate(local, [0, 6], [0, 1], clamp) }}>
        <Sequence from={i * STEP} layout="none">
          <Step />
        </Sequence>
      </AbsoluteFill>
      {i === 2 ? <Sequence from={2 * STEP} layout="none"><Pointer path={[[0, 1250, 980], [10, 980, 640], [40, 980, 640]]} clicks={[10]} /></Sequence> : null}
    </Paper>
  );
};

/** Optional changes, in plain words (PRD T4.4): only the affected part is redone. */
export const AskScene = () => {
  const frame = useCurrentFrame();
  const a = c.ask;
  const typed = Math.max(0, Math.floor((frame - 10) * 2));
  const applyAt = 40;
  const out = pop(frame, applyAt + 4);
  const swap = interpolate(frame, [applyAt + 10, applyAt + 18], [0, 1], clamp);
  return (
    <Paper>
      <Headline text={a.headline} at={2}>
        <Chip tone="muted" size={28}>{a.optional}</Chip>
      </Headline>
      <ConsoleWindow>
        <div style={{ display: "flex", gap: 40, padding: "60px 54px", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ border: `3px solid ${color.record}`, borderRadius: 20, padding: "26px 30px", fontSize: 36, lineHeight: 1.4, minHeight: 150, background: "#fff" }}>
              {a.request.slice(0, typed)}
              {typed < a.request.length && Math.floor(frame / 6) % 2 === 0 ? <span style={{ color: color.record }}>|</span> : null}
            </div>
            <div style={{ marginTop: 22, display: "inline-block", fontSize: 30, fontWeight: 700, color: "#fff", background: color.record, padding: "14px 34px", borderRadius: 14, transform: frame >= applyAt && frame < applyAt + 5 ? "scale(0.94)" : undefined }}>Apply</div>
          </div>
          <div style={{ width: 660, background: "#fbf8f0", border: "2px solid #ebe3cf", borderRadius: 20, padding: 30 }}>
            <div style={{ display: "flex", gap: 22, alignItems: "center", marginBottom: 22 }}>
              <PixelFace sprite="OldMan" size={120} />
              <div style={{ fontSize: 34, fontWeight: 700 }}>The Temenggong</div>
            </div>
            <div style={{ position: "relative", fontFamily: serif, fontSize: 32, lineHeight: 1.4, minHeight: 140 }}>
              <div style={{ opacity: 1 - out, textDecoration: out > 0 ? "line-through" : "none", color: color.muted, position: "absolute" }}>{a.before}</div>
              <div style={{ opacity: swap, transform: `translateY(${(1 - swap) * 12}px)` }}>{a.after}</div>
            </div>
            <div style={{ marginTop: 10, opacity: pop(frame, applyAt + 20) }}><Chip tone="world">✓ {a.scope}</Chip></div>
          </div>
        </div>
      </ConsoleWindow>
      <Pointer path={[[0, 1300, 1000], [30, 250, 555], [60, 250, 555]]} clicks={[applyAt]} />
    </Paper>
  );
};

/** After play: the class summary (PRD T2), anonymised and in totals. */
export const ClassScene = () => {
  const frame = useCurrentFrame();
  const cv = c.classView;
  return (
    <Paper>
      <Headline text={cv.headline} at={2} />
      <ConsoleWindow>
        <div style={{ display: "flex", gap: 10, padding: "22px 44px 0", borderBottom: "2px solid #eee6d3" }}>
          {cv.tabs.map((tab, i) => (
            <div key={tab} style={{ fontSize: 24, fontWeight: 700, padding: "12px 22px", borderRadius: "12px 12px 0 0", background: i === 1 ? "#fbf8f0" : "transparent", color: i === 1 ? color.ink : color.muted, borderBottom: i === 1 ? `4px solid ${color.record}` : "none" }}>{tab}</div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 50, padding: "34px 44px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 22 }}>Was the treaty fair to the people already living there?</div>
            {cv.verdicts.map((v, i) => {
              const grow = interpolate(frame, [10 + i * 6, 34 + i * 6], [0, v.value], clamp);
              return (
                <div key={v.label} style={{ marginBottom: 22 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, marginBottom: 8 }}>
                    <span>{v.label}</span>
                    <span style={{ fontWeight: 700 }}>{Math.round(grow * 100)}%</span>
                  </div>
                  <div style={{ height: 20, background: "#efe8d8", borderRadius: 999 }}>
                    <div style={{ width: `${grow * 100}%`, height: "100%", background: [color.world, color.record, color.signal][i], borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 10, opacity: pop(frame, 44) }}><Chip tone="record">{cv.changed}</Chip></div>
          </div>
          <div style={{ width: 600, background: "#fbf8f0", borderRadius: 18, padding: "30px 34px", opacity: pop(frame, 50), transform: `translateY(${(1 - pop(frame, 50)) * 20}px)` }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: color.muted, marginBottom: 14 }}>WORTH DISCUSSING</div>
            <div style={{ fontFamily: serif, fontSize: 34, lineHeight: 1.35 }}>{cv.quote}</div>
            <div style={{ marginTop: 14, fontSize: 22, color: color.muted }}>{cv.quoteBy}</div>
          </div>
        </div>
      </ConsoleWindow>
    </Paper>
  );
};

/** One adventure in the library: its cover with a slow push-in, title and level. */
const CoverCard = ({ cover, title, meta, at }: { cover: string; title: string; meta: string; at: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 14 } });
  const W = 540;
  const H = (W * 9) / 16;
  return (
    <div style={{ width: W, opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 40}px) scale(${0.9 + p * 0.1})` }}>
      <Sound src="pop" at={at} volume={0.3} />
      <div style={{ position: "relative", width: W, height: H, borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 50px rgba(0,0,0,0.45)", background: cover ? "#1b2235" : "transparent", border: cover ? undefined : `5px dashed ${color.signal}` }}>
        {cover ? (
          <Img src={staticFile(`art/${cover}.webp`)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.04 + frame * 0.0012})` }} />
        ) : (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: bold, fontWeight: 900, fontSize: 150, color: color.signal, lineHeight: 1 }}>+</div>
          </AbsoluteFill>
        )}
      </div>
      <div style={{ fontFamily: bold, fontWeight: 800, fontSize: 32, color: "#fff8e9", marginTop: 16 }}>{title}</div>
      <div style={{ fontFamily: sans, fontSize: 22, color: "#b5bdcb", marginTop: 4 }}>{meta}</div>
    </div>
  );
};

/** Six adventures, the last one yours. */
export const MontageScene = () => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #222b40 0%, ${color.night} 75%)` }}>
    <Headline text={c.any} at={4} top={60} light />
    <AbsoluteFill style={{ top: 190, display: "grid", gridTemplateColumns: "repeat(3, 540px)", justifyContent: "center", alignContent: "start", columnGap: 70, rowGap: 26 }}>
      {pitch.montage.map((m, i) => <CoverCard key={m.title} cover={m.cover} title={m.title} meta={m.meta} at={8 + i * 7} />)}
    </AbsoluteFill>
  </AbsoluteFill>
);
