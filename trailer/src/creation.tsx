import type { ReactNode } from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cast, pitch } from "./episode";
import { PixelFace } from "./hud";
import { T, TOWN_H, TOWN_W, Town, World } from "./pixel";
import { WORD_SPRING } from "./pitch";
import { Sound } from "./sound";
import { bold, color, pixel, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const c = pitch.create;

/** Big headline that slams in at the top left of a creation shot. */
const Headline = ({ text, at, until, top = 80, light = false }: { text: string; at: number; until?: number; top?: number; light?: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.min(1, spring({ frame: frame - at, fps, config: WORD_SPRING }));
  if (frame < at || (until !== undefined && frame >= until)) return null;
  return (
    <div style={{ position: "absolute", left: 120, top, fontFamily: bold, fontWeight: 900, fontSize: 84, letterSpacing: -2, color: light ? "#fff8e9" : color.ink, opacity: p, transform: p < 0.985 ? `translateY(${(1 - p) * 24}px) scale(${1.1 - p * 0.1})` : undefined, transformOrigin: "left center" }}>
      {text}
    </div>
  );
};

/** The teacher console, drawn as a browser window. */
const ConsoleWindow = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
  <div style={{ position: "absolute", left: 120, right: 120, top: 230, bottom: 70, background: "#ffffff", borderRadius: 22, boxShadow: "0 40px 90px rgba(23,32,51,0.25)", overflow: "hidden", fontFamily: sans, color: color.ink, ...style }}>
    <div style={{ height: 58, background: "#f1ece0", display: "flex", alignItems: "center", gap: 12, padding: "0 24px", borderBottom: "1px solid #e3dccb" }}>
      {["#e86a5c", "#f1bf4a", "#5cc26a"].map((dot) => <div key={dot} style={{ width: 16, height: 16, borderRadius: 999, background: dot }} />)}
      <div style={{ marginLeft: 24, background: "#fff", borderRadius: 999, padding: "6px 22px", fontSize: 20, color: color.muted }}>historicaladventures.app/create</div>
    </div>
    <div style={{ position: "absolute", top: 58, left: 0, right: 0, bottom: 0 }}>{children}</div>
  </div>
);

const Paper = ({ children }: { children: ReactNode }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: color.paper, overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: "repeating-linear-gradient(-55deg, rgba(23,32,51,0.035) 0 60px, transparent 60px 140px)", backgroundPosition: `${frame * 2}px 0` }} />
      {children}
    </AbsoluteFill>
  );
};

const FileCard = ({ name, at, index }: { name: string; at: number; index: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 14, mass: 0.6 } });
  const ext = name.split(".").pop()?.toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, background: "#fff", border: "2px solid #e6dcc5", borderRadius: 14, padding: "16px 20px", marginBottom: 16, opacity: Math.min(1, p * 1.4), transform: `translate(${(1 - p) * -260}px, ${(1 - p) * (index - 1) * 60}px) rotate(${(1 - p) * -8}deg)` }}>
      <Sound src="pop" at={at} volume={0.4} />
      <div style={{ width: 54, height: 66, background: ext === "PDF" ? "#d85f35" : color.record, borderRadius: 6, color: "#fff", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8 }}>{ext}</div>
      <div style={{ fontSize: 26, fontWeight: 600 }}>{name}</div>
    </div>
  );
};

/** Drop in sources; the draft builds itself (steps tick, characters appear, the map assembles). */
export const UploadScene = () => {
  const frame = useCurrentFrame();
  const stepAt = (i: number) => 48 + i * 18;
  const reveal = interpolate(frame, [76, 126], [0, 1], clamp);
  const people = [cast.temenggong, cast.raffles, cast.hussein, cast.farquhar, cast.player];
  return (
    <Paper>
      <Headline text={c.drop} at={4} until={48} />
      <Headline text={c.drafted} at={48} top={80} />
      <ConsoleWindow>
        <div style={{ display: "flex", height: "100%" }}>
          <div style={{ width: 760, padding: "34px 40px", borderRight: "1px solid #eee6d3" }}>
            <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 20 }}>{c.title}</div>
            <div style={{ border: "3px dashed #c9bfa6", borderRadius: 18, padding: 22, minHeight: 300, background: frame > 8 && frame < 44 ? color.recordWash : "#fffdf7" }}>
              {c.files.map((f, i) => <FileCard key={f} name={f} at={8 + i * 9} index={i} />)}
            </div>
            <div style={{ marginTop: 26 }}>
              {c.steps.map((step, i) => {
                const done = frame >= stepAt(i) + 12;
                const active = frame >= stepAt(i);
                return (
                  <div key={step} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 25, margin: "10px 0", opacity: active ? 1 : 0.35 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 999, background: done ? color.world : active ? color.recordWash : "#eee", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20 }}>{done ? "✓" : ""}</div>
                    {step}
                    {done ? <Sound src="key1" at={stepAt(i) + 12} volume={0.3} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, padding: "34px 40px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: color.muted, marginBottom: 16 }}>CHARACTERS</div>
            <div style={{ display: "flex", gap: 18, marginBottom: 30 }}>
              {people.map((person, i) => {
                const p = interpolate(frame, [64 + i * 5, 72 + i * 5], [0, 1], clamp);
                return <div key={person.name} style={{ opacity: p, transform: `scale(${0.6 + p * 0.4})` }}><PixelFace sprite={person.sprite} size={96} /></div>;
              })}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: color.muted, marginBottom: 16 }}>WORLD</div>
            <div style={{ position: "relative", width: 760, height: 330, overflow: "hidden", borderRadius: 14, background: "#e9e2cf" }}>
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)` }}>
                <div style={{ width: 1920, height: 1080, transform: `scale(${760 / 1920})`, transformOrigin: "0 0" }}>
                  <World camX={6 * T} width={TOWN_W} height={TOWN_H}>
                    <Town />
                  </World>
                </div>
              </div>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${reveal * 100}%`, width: 6, background: color.signal, opacity: reveal > 0 && reveal < 1 ? 1 : 0 }} />
            </div>
          </div>
        </div>
      </ConsoleWindow>
    </Paper>
  );
};

/** A mouse pointer gliding between targets: [frame, x, y] keyframes; `clicks` are frames where it presses. */
const Pointer = ({ path, clicks = [] }: { path: [number, number, number][]; clicks?: number[] }) => {
  const frame = useCurrentFrame();
  const fs = path.map((p) => p[0]);
  const x = interpolate(frame, fs, path.map((p) => p[1]), { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const y = interpolate(frame, fs, path.map((p) => p[2]), { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const pressed = clicks.some((c) => frame >= c && frame < c + 5);
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 20, transform: `scale(${pressed ? 0.85 : 1})`, transformOrigin: "0 0", opacity: frame < path[0][0] ? 0 : 1 }}>
      {clicks.map((c) => <Sound key={c} src="pop" at={c} volume={0.3} />)}
      {clicks.map((c) => {
        const r = interpolate(frame, [c, c + 12], [0, 1], clamp);
        return r > 0 && r < 1 ? <div key={`r${c}`} style={{ position: "absolute", left: -30 * r, top: -30 * r, width: 60 * r, height: 60 * r, borderRadius: 999, border: `3px solid ${color.signal}`, opacity: 1 - r }} /> : null;
      })}
      <svg width="44" height="52" viewBox="0 0 22 26" aria-hidden style={{ filter: "drop-shadow(2px 3px 2px rgba(0,0,0,0.35))" }}>
        <path d="M1 1 L1 20 L6 15 L10 24 L13 23 L9 14 L16 14 Z" fill="#ffffff" stroke={color.ink} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Chip = ({ children, tone = "record" }: { children: ReactNode; tone?: "record" | "world" | "signal" | "muted" }) => {
  const bg = { record: color.recordWash, world: color.worldWash, signal: color.signalWash, muted: "#eee8da" }[tone];
  const fg = { record: color.record, world: color.world, signal: color.signal, muted: color.muted }[tone];
  return <span style={{ display: "inline-block", fontSize: 20, fontWeight: 700, color: fg, background: bg, padding: "6px 14px", borderRadius: 999 }}>{children}</span>;
};

const pop = (frame: number, at: number) => interpolate(frame, [at, at + 8], [0, 1], clamp);

/** Moment 1: the skeleton board. A character is added, then a whole stage. */
const ShapeMoment = () => {
  const frame = useCurrentFrame();
  const sh = c.shape;
  const added = pop(frame, 24);
  const third = pop(frame, 42);
  const column = (title: string, people: string[], choice: string, extra?: ReactNode, opacity = 1) => (
    <div style={{ width: 470, background: "#fbf8f0", border: "2px solid #ebe3cf", borderRadius: 18, padding: 24, opacity, transform: `translateY(${(1 - opacity) * 30}px)` }}>
      <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 18 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, color: color.muted, marginBottom: 10 }}>CHARACTERS</div>
      <div style={{ display: "flex", gap: 12, minHeight: 96 }}>
        {people.map((sprite) => <PixelFace key={sprite} sprite={sprite} size={86} />)}
        {extra}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, color: color.muted, margin: "18px 0 10px" }}>DEFINING MOMENT</div>
      <Chip tone="signal">{choice}</Chip>
    </div>
  );
  return (
    <div style={{ padding: "34px 44px" }}>
      <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
        {column(sh.stages[0].title, sh.stages[0].people, sh.stages[0].choice, <div style={{ opacity: added, transform: `scale(${0.5 + added * 0.5})` }}><PixelFace sprite={sh.added} size={86} /></div>)}
        {column(sh.stages[1].title, sh.stages[1].people, sh.stages[1].choice)}
        {third > 0 ? column("Stage 3: The settlement", ["Villager3"], "Who governs?", undefined, third) : (
          <div style={{ width: 470, height: 280, border: "3px dashed #d6ccb4", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: color.muted }}>{sh.newStage}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 30 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: color.muted, marginRight: 8 }}>ENDINGS</span>
        {sh.endings.map((e, i) => <Chip key={e} tone={i === 0 ? "world" : i === 1 ? "record" : "signal"}>{e}</Chip>)}
      </div>
    </div>
  );
};

/** Moment 2: a plain-language request rewrites just one character. */
const AskMoment = () => {
  const frame = useCurrentFrame();
  const a = c.ask;
  const typed = Math.max(0, Math.floor((frame - 6) * 2.6));
  const out = pop(frame, 38);
  const swap = interpolate(frame, [44, 52], [0, 1], clamp);
  return (
    <div style={{ padding: "34px 44px", display: "flex", gap: 36 }}>
      <div style={{ width: 640, background: "#fbf8f0", border: "2px solid #ebe3cf", borderRadius: 18, padding: 28 }}>
        <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 20 }}>
          <PixelFace sprite="OldMan" size={110} />
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>The Temenggong</div>
            <Chip tone="muted">Persona</Chip>
          </div>
        </div>
        <div style={{ position: "relative", fontFamily: serif, fontSize: 30, lineHeight: 1.4, minHeight: 130 }}>
          <div style={{ opacity: 1 - out, textDecoration: out > 0 ? "line-through" : "none", color: color.muted, position: "absolute" }}>{a.before}</div>
          <div style={{ opacity: swap, transform: `translateY(${(1 - swap) * 12}px)` }}>{a.after}</div>
        </div>
        {swap > 0.5 ? <div style={{ marginTop: 14 }}><Chip tone="world">✓ {a.scope}</Chip></div> : null}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: color.muted, marginBottom: 12 }}>ASK FOR A CHANGE</div>
        <div style={{ border: `3px solid ${color.record}`, borderRadius: 18, padding: "22px 26px", fontSize: 30, lineHeight: 1.4, minHeight: 170, background: "#fff" }}>
          {a.request.slice(0, typed)}
          {typed < a.request.length && Math.floor(frame / 6) % 2 === 0 ? <span style={{ color: color.record }}>|</span> : null}
        </div>
        <div style={{ marginTop: 18, display: "inline-block", fontSize: 26, fontWeight: 700, color: "#fff", background: color.record, padding: "12px 26px", borderRadius: 12 }}>Apply</div>
      </div>
    </div>
  );
};

/** Moment 3: every fact shows its source; real excerpts are locked. */
const SourcesMoment = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ padding: "34px 44px", display: "flex", gap: 36 }}>
      <div style={{ flex: 1 }}>
        {c.facts.map((fact, i) => {
          const p = pop(frame, 4 + i * 7);
          return (
            <div key={fact.text} style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 22px", borderRadius: 14, background: i % 2 ? "#fffdf7" : "#f8f4ea", marginBottom: 12, opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: color.world, color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>
              <div style={{ flex: 1, fontFamily: serif, fontSize: 28 }}>{fact.text}</div>
              <Chip>{fact.source}</Chip>
            </div>
          );
        })}
      </div>
      <div style={{ width: 560, background: "#f3e8cf", borderRadius: 14, padding: "26px 30px", boxShadow: "0 10px 26px rgba(0,0,0,0.12)", opacity: pop(frame, 20), position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Chip tone="signal">Source A · real excerpt</Chip>
          <svg width="30" height="34" viewBox="0 0 15 17" aria-hidden>
            <path d="M3.5 7V5a4 4 0 0 1 8 0v2" fill="none" stroke={color.ink} strokeWidth="1.8" />
            <rect x="1.5" y="7" width="12" height="9" rx="1.5" fill={color.ink} />
          </svg>
        </div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 28, lineHeight: 1.45, color: "#3b2a18" }}>“…the island is all but deserted, and there is no prince with a claim to it…”</div>
        <div style={{ marginTop: 16, fontSize: 22, fontWeight: 700, color: color.muted }}>{c.sources.locked}</div>
      </div>
    </div>
  );
};

/** Moment 4: play it as a student; the town opens inside the console. */
const PreviewMoment = () => {
  const frame = useCurrentFrame();
  const open = interpolate(frame, [18, 34], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const W = interpolate(open, [0, 1], [360, 1560]);
  const H = (W * 9) / 16;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {open < 0.05 ? (
        <div style={{ fontSize: 34, fontWeight: 700, color: "#fff", background: color.world, padding: "20px 40px", borderRadius: 16, transform: frame >= 14 && frame < 19 ? "scale(0.94)" : undefined }}>▶ {c.preview.button}</div>
      ) : (
        <div style={{ width: W, height: Math.min(H, 760), borderRadius: 18, overflow: "hidden", boxShadow: `0 0 0 8px ${color.ink}` }}>
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

const MOMENT = 60;
/** "Make it yours": shape the story, change anything in plain words, see the sources, play it as a student. */
export const ShapeScene = () => {
  const frame = useCurrentFrame();
  const i = Math.min(3, Math.floor(frame / MOMENT));
  const local = frame - i * MOMENT;
  const headlines = [c.shape.headline, c.ask.headline, c.sources.headline, c.preview.headline];
  const moments = [ShapeMoment, AskMoment, SourcesMoment, PreviewMoment];
  const Moment = moments[i];
  const pointer: [number, number, number][][] = [
    [[0, 1500, 950], [18, 480, 585], [34, 1395, 585], [50, 1395, 585]],
    [[0, 1400, 950], [30, 930, 770], [50, 930, 770]],
    [[0, 1700, 950], [24, 1720, 585], [50, 1720, 585]],
    [[0, 1200, 900], [12, 960, 660], [50, 960, 660]],
  ];
  const clicks = [[22, 40], [36], [26], [14]];
  return (
    <Paper>
      {headlines.map((h, k) => <Headline key={h} text={h} at={k * MOMENT + 2} until={k < 3 ? (k + 1) * MOMENT : undefined} />)}
      <ConsoleWindow>
        <AbsoluteFill style={{ opacity: interpolate(local, [0, 6], [0, 1], clamp), justifyContent: "center" }}>
          <div style={{ height: i === 3 ? "100%" : undefined, position: "relative" }}>
            <Sequence from={i * MOMENT} durationInFrames={i === 3 ? Infinity : MOMENT} layout="none">
              <Moment />
            </Sequence>
          </div>
        </AbsoluteFill>
      </ConsoleWindow>
      <Sequence from={i * MOMENT} durationInFrames={i === 3 ? Infinity : MOMENT} layout="none">
        <Pointer path={pointer[i]} clicks={clicks[i]} />
      </Sequence>
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
