import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cast, pitch } from "./episode";
import { PixelFace } from "./hud";
import { T, TOWN_H, TOWN_W, Town, World } from "./pixel";
import { Sound } from "./sound";
import { bold, color, pixel, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const c = pitch.create;

/** Big headline that slams in at the top left of a creation shot. */
const Headline = ({ text, at, until, top = 80, light = false }: { text: string; at: number; until?: number; top?: number; light?: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.min(1, spring({ frame: frame - at, fps, config: { damping: 18, mass: 0.5, stiffness: 220 } }));
  if (frame < at || (until !== undefined && frame >= until)) return null;
  return (
    <div style={{ position: "absolute", left: 120, top, fontFamily: bold, fontWeight: 900, fontSize: 84, letterSpacing: -2, color: light ? "#fff8e9" : color.ink, opacity: p, transform: p < 0.985 ? `translateY(${(1 - p) * 30}px) scale(${1.2 - p * 0.2})` : undefined, transformOrigin: "left center" }}>
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
  const stepAt = (i: number) => 70 + i * 22;
  const reveal = interpolate(frame, [110, 170], [0, 1], clamp);
  const people = [cast.temenggong, cast.raffles, cast.hussein, cast.farquhar, cast.player];
  return (
    <Paper>
      <Headline text={c.drop} at={4} until={70} />
      <Headline text={c.drafted} at={70} top={80} />
      <ConsoleWindow>
        <div style={{ display: "flex", height: "100%" }}>
          <div style={{ width: 760, padding: "34px 40px", borderRight: "1px solid #eee6d3" }}>
            <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 20 }}>{c.title}</div>
            <div style={{ border: "3px dashed #c9bfa6", borderRadius: 18, padding: 22, minHeight: 300, background: frame > 10 && frame < 60 ? color.recordWash : "#fffdf7" }}>
              {c.files.map((f, i) => <FileCard key={f} name={f} at={10 + i * 12} index={i} />)}
            </div>
            <div style={{ marginTop: 26 }}>
              {c.steps.map((step, i) => {
                const done = frame >= stepAt(i) + 16;
                const active = frame >= stepAt(i);
                return (
                  <div key={step} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 25, margin: "10px 0", opacity: active ? 1 : 0.35 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 999, background: done ? color.world : active ? color.recordWash : "#eee", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20 }}>{done ? "✓" : ""}</div>
                    {step}
                    {done ? <Sound src="key1" at={stepAt(i) + 16} volume={0.3} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, padding: "34px 40px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: color.muted, marginBottom: 16 }}>CHARACTERS</div>
            <div style={{ display: "flex", gap: 18, marginBottom: 30 }}>
              {people.map((person, i) => {
                const p = interpolate(frame, [92 + i * 6, 100 + i * 6], [0, 1], clamp);
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

/** The teacher reviews key facts, each with its source, then approves. */
export const ReviewScene = () => {
  const frame = useCurrentFrame();
  const approveAt = 62;
  const stamp = spring({ frame: frame - approveAt, fps: 30, config: { damping: 10 } });
  return (
    <Paper>
      <Headline text={c.check} at={4} />
      <ConsoleWindow>
        <div style={{ padding: "34px 44px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Review: key facts every student will learn</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", background: frame >= approveAt ? color.world : color.record, padding: "12px 28px", borderRadius: 12, transform: frame >= approveAt - 4 && frame < approveAt ? "scale(0.94)" : undefined }}>
              {frame >= approveAt ? "Approved ✓" : "Approve"}
            </div>
          </div>
          {c.facts.map((fact, i) => {
            const at = 10 + i * 9;
            const p = interpolate(frame, [at, at + 8], [0, 1], clamp);
            const checked = frame >= at + 20;
            return (
              <div key={fact.text} style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 22px", borderRadius: 14, background: i % 2 ? "#fffdf7" : "#f8f4ea", marginBottom: 10, opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, border: `3px solid ${color.world}`, background: checked ? color.world : "#fff", color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{checked ? "✓" : ""}</div>
                <div style={{ flex: 1, fontFamily: serif, fontSize: 30 }}>{fact.text}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: color.record, background: color.recordWash, padding: "6px 14px", borderRadius: 999 }}>{fact.source}</div>
              </div>
            );
          })}
        </div>
        <Sound src="impact" at={approveAt} volume={0.35} />
      </ConsoleWindow>
      {frame >= approveAt ? (
        <div style={{ position: "absolute", right: 260, bottom: 140, transform: `rotate(-10deg) scale(${2 - stamp})`, opacity: Math.min(1, stamp), fontFamily: pixel, fontWeight: 700, fontSize: 64, color: color.world, border: `8px solid ${color.world}`, padding: "6px 26px", background: "rgba(255,255,255,0.85)" }}>
          READY TO PLAY
        </div>
      ) : null}
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
