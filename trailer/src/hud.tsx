import type { CSSProperties, ReactNode } from "react";
import { Img, Sequence, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, pixel, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ramp = (frame: number, start: number, length = 10) => interpolate(frame, [start, start + length], [0, 1], clamp);

/** A chunky pixel border: dark outer line, light inner line, stepped corners. */
export const PixelFrame = ({ children, style, tone = "paper" }: { children: ReactNode; style?: CSSProperties; tone?: "paper" | "night" }) => {
  const bg = tone === "paper" ? "#fff8e9" : "#1b2235";
  const inner = tone === "paper" ? "#e8d9b3" : "#38415e";
  return (
    <div
      style={{
        position: "relative",
        background: bg,
        color: tone === "paper" ? color.ink : "#fff8e9",
        boxShadow: `0 0 0 6px ${inner}, 0 0 0 12px ${color.ink}, 12px 12px 0 12px rgba(0,0,0,0.25)`,
        clipPath: "polygon(0 6px, 6px 6px, 6px 0, calc(100% - 6px) 0, calc(100% - 6px) 6px, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 6px calc(100% - 6px), 0 calc(100% - 6px))",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Wrapper so the frame's outer border isn't clipped. */
const Framed = ({ children, style, tone }: { children: ReactNode; style?: CSSProperties; tone?: "paper" | "night" }) => (
  <div style={{ padding: 12, ...style }}>
    <div style={{ boxShadow: `0 0 0 12px ${color.ink}`, borderRadius: 2 }}>
      <PixelFrame tone={tone} style={{ boxShadow: `inset 0 0 0 6px ${tone === "night" ? "#38415e" : "#e8d9b3"}` }}>{children}</PixelFrame>
    </div>
  </div>
);

export const Typed = ({ text, start, speed = 1.5 }: { text: string; start: number; speed?: number }) => {
  const frame = useCurrentFrame();
  return <>{text.slice(0, Math.max(0, Math.floor((frame - start) * speed)))}</>;
};

export const PixelFace = ({ sprite, size = 190 }: { sprite: string; size?: number }) => (
  <div style={{ width: size, height: size, background: "#141a14", boxShadow: `0 0 0 6px ${color.ink}`, flexShrink: 0 }}>
    <Img src={staticFile(`characters/${sprite}/face.png`)} style={{ width: size, height: size, imageRendering: "pixelated" }} />
  </div>
);

/** RPG dialogue box across the bottom of the screen. */
export const DialogBox = ({ sprite, name, text, start, speed = 1.5, children, mine = false }: {
  sprite: string; name: string; text?: string; start: number; speed?: number; children?: ReactNode; mine?: boolean;
}) => {
  const frame = useCurrentFrame();
  const t = ramp(frame, start - 8, 8);
  const done = text ? frame > start + text.length / speed : true;
  return (
    <div style={{ position: "absolute", left: 120, right: 120, bottom: 56, opacity: t, transform: `translateY(${(1 - t) * 30}px)` }}>
      <Framed tone="paper">
        <div style={{ display: "flex", gap: 40, padding: "34px 40px", minHeight: 210 }}>
          <PixelFace sprite={sprite} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "inline-block", fontFamily: pixel, fontWeight: 700, fontSize: 34, color: "#fff8e9", background: mine ? color.record : color.ink, padding: "4px 16px", marginBottom: 14 }}>{name}</div>
            <div style={{ fontFamily: pixel, fontSize: 46, lineHeight: 1.3 }}>
              {text !== undefined ? <Typed text={text} start={start} speed={speed} /> : children}
              {done && Math.floor(frame / 12) % 2 === 0 ? <span style={{ color: color.signal, marginLeft: 12 }}>▼</span> : null}
            </div>
          </div>
        </div>
      </Framed>
    </div>
  );
};

/** RPG choice menu with a moving cursor. `pickAt` is when the choice is confirmed. */
export const ChoiceMenu = ({ title, options, start, pickAt, picked, closedIndex, closedAt, style }: {
  title: string; options: readonly string[]; start: number; pickAt: number; picked: number; closedIndex?: number; closedAt?: number; style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  const t = ramp(frame, start, 8);
  const hover = frame < start + 22 ? 0 : frame < start + 34 ? 1 : picked;
  const confirmed = frame >= pickAt;
  return (
    <div style={{ position: "absolute", opacity: t, transform: `scale(${0.96 + t * 0.04})`, ...style }}>
      <Framed tone="paper">
        <div style={{ padding: "30px 44px 34px", minWidth: 980 }}>
          <div style={{ fontFamily: pixel, fontWeight: 700, fontSize: 40, marginBottom: 22 }}>{title}</div>
          {options.map((option, i) => {
            const closed = closedIndex === i && closedAt !== undefined && frame >= closedAt;
            const active = i === hover;
            return (
              <div key={option} style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: pixel, fontSize: 44, lineHeight: 1.5, color: closed ? "#a59f90" : confirmed && i === picked ? color.record : color.ink, textDecoration: closed ? "line-through" : "none" }}>
                <span style={{ width: 36, color: color.signal, opacity: active && !closed ? (confirmed ? 1 : Math.floor(frame / 8) % 2 ? 1 : 0.4) : 0 }}>▶</span>
                <span style={{ background: confirmed && i === picked ? color.recordWash : "transparent", padding: "0 10px" }}>{option}</span>
              </div>
            );
          })}
        </div>
      </Framed>
      <Sequence from={pickAt} durationInFrames={60} layout="none">
        <Audio src={staticFile("audio/sfx-pop.wav")} volume={0.55} />
      </Sequence>
    </div>
  );
};

const Quill = () => (
  <svg width="34" height="34" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
    <path d="M6 0h2v1H7v1H6v1H5v1H4v1H3v1H2v1H1v1H0V7h1V6h1V5h1V4h1V3h1V2h1z" fill={color.world} />
  </svg>
);

/** "New note" card that pops in at the top right. */
export const NoteToast = ({ text, start, style }: { text: string; start: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - start, fps, config: { damping: 13, mass: 0.6 } });
  return (
    <div style={{ position: "absolute", right: 110, top: 110, width: 700, transform: `translateY(${(1 - t) * -40}px)`, opacity: Math.min(1, t * 1.5), ...style }}>
      <Sequence from={start} durationInFrames={60} layout="none">
        <Audio src={staticFile("audio/sfx-chime.wav")} volume={0.5} />
      </Sequence>
      <Framed tone="paper">
        <div style={{ padding: "22px 30px 26px", borderLeft: `10px solid ${color.world}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: pixel, fontWeight: 700, fontSize: 30, color: color.world, letterSpacing: 2 }}>
            <Quill /> NEW NOTE
          </div>
          <div style={{ fontFamily: pixel, fontSize: 38, lineHeight: 1.3, marginTop: 10 }}>{text}</div>
        </div>
      </Framed>
    </div>
  );
};

