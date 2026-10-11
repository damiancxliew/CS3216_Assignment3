import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0→1 over `length` frames starting at `start`. */
export const ramp = (frame: number, start: number, length = 12) => interpolate(frame, [start, start + length], [0, 1], clamp);

/** Fade a whole scene in at its start and out at its end. */
export const SceneFade = ({ children, duration, fadeIn = 10, fadeOut = 10 }: { children: ReactNode; duration: number; fadeIn?: number; fadeOut?: number }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(ramp(frame, 0, fadeIn), 1 - ramp(frame, duration - fadeOut, fadeOut));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Paper = ({ children, deep = false }: { children?: ReactNode; deep?: boolean }) => (
  <AbsoluteFill
    style={{
      background: deep
        ? `radial-gradient(circle at 30% 20%, ${color.paper} 0%, ${color.paperDeep} 75%)`
        : `radial-gradient(circle at 50% 35%, #fffdf6 0%, ${color.paper} 70%)`,
      fontFamily: sans,
      color: color.ink,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Large on-screen line that rises into place. */
export const Caption = ({ text, start = 0, size = 64, top, bottom, light = false, weight = 700, family = serif, align = "center" }: {
  text: string; start?: number; size?: number; top?: number; bottom?: number; light?: boolean; weight?: number; family?: string; align?: CSSProperties["textAlign"];
}) => {
  const frame = useCurrentFrame();
  const t = ramp(frame, start, 14);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        top,
        bottom,
        textAlign: align,
        fontFamily: family,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1.2,
        color: light ? "#fffaf0" : color.ink,
        textShadow: light ? "0 3px 18px rgba(0,0,0,0.55)" : undefined,
        opacity: t,
        transform: `translateY(${(1 - t) * 24}px)`,
      }}
    >
      {text}
    </div>
  );
};

export const Face = ({ sprite, size = 96, ring = color.ink, style }: { sprite: string; size?: number; ring?: string; style?: CSSProperties }) => (
  <div style={{ width: size, height: size, borderRadius: 18, overflow: "hidden", border: `4px solid ${ring}`, background: "#141a14", flexShrink: 0, ...style }}>
    <Img src={staticFile(`characters/${sprite}/face.png`)} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />
  </div>
);

/** Text that types itself out from `start`. */
export const Typed = ({ text, start, speed = 1.6 }: { text: string; start: number; speed?: number }) => {
  const frame = useCurrentFrame();
  const shown = Math.max(0, Math.floor((frame - start) * speed));
  return <>{text.slice(0, shown)}</>;
};

export const Bubble = ({ side, text, start, sprite, name, speed, children, tone = "plain" }: {
  side: "left" | "right"; text?: string; start: number; sprite?: string; name?: string; speed?: number; children?: ReactNode; tone?: "plain" | "faded";
}) => {
  const frame = useCurrentFrame();
  const t = ramp(frame, start - 4, 10);
  const mine = side === "right";
  return (
    <div style={{ display: "flex", flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end", gap: 18, opacity: t, transform: `translateY(${(1 - t) * 16}px)` }}>
      {sprite ? <Face sprite={sprite} size={78} ring={mine ? color.record : color.ink} /> : null}
      <div style={{ maxWidth: 760 }}>
        {name ? <div style={{ fontSize: 22, fontWeight: 700, color: color.muted, marginBottom: 6, textAlign: mine ? "right" : "left" }}>{name}</div> : null}
        <div
          style={{
            background: mine ? color.record : "#ffffff",
            color: mine ? "#ffffff" : tone === "faded" ? color.muted : color.ink,
            border: mine ? "none" : "2px solid #e3dccb",
            borderRadius: 22,
            padding: "20px 26px",
            fontSize: 32,
            lineHeight: 1.35,
            boxShadow: "0 6px 20px rgba(23,32,51,0.08)",
          }}
        >
          {text !== undefined ? <Typed text={text} start={start} speed={speed} /> : children}
        </div>
      </div>
    </div>
  );
};

const Pencil = ({ size = 28, fill = color.world }: { size?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.7-10.2a1 1 0 0 0 0-1.42l-2.33-2.33a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill={fill} />
  </svg>
);

/** A notebook entry sliding in: the student's record of something they learned. */
export const NoteCard = ({ text, start, width = 560, label = "New note", sfx = true }: { text: string; start: number; width?: number; label?: string; sfx?: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - start, fps, config: { damping: 14, mass: 0.7 } });
  return (
    <div style={{ width, transform: `translateX(${(1 - t) * 120}px) rotate(${(1 - t) * 4 - 1}deg)`, opacity: Math.min(1, t * 1.4) }}>
      {sfx ? (
        <Sequence from={start} durationInFrames={60} layout="none">
          <Audio src={staticFile("audio/sfx-evidence.ogg")} volume={0.55} />
        </Sequence>
      ) : null}
      <div
        style={{
          background: "#fffdf3",
          backgroundImage: "repeating-linear-gradient(transparent, transparent 43px, #e9dfc6 44px)",
          borderLeft: `8px solid ${color.world}`,
          borderRadius: 14,
          padding: "18px 26px 22px",
          boxShadow: "0 14px 34px rgba(23,32,51,0.16)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 700, color: color.world, textTransform: "uppercase", letterSpacing: 1.5 }}>
          <Pencil /> {label}
        </div>
        <div style={{ fontFamily: serif, fontSize: 32, lineHeight: 1.36, marginTop: 8, color: color.ink }}>{text}</div>
      </div>
    </div>
  );
};

export const Panel = ({ children, width, style }: { children: ReactNode; width: number; style?: CSSProperties }) => (
  <div style={{ width, background: "#fbf6ea", border: "2px solid #e6dcc5", borderRadius: 28, padding: 34, boxShadow: "0 24px 60px rgba(23,32,51,0.14)", ...style }}>{children}</div>
);

export const PanelHeader = ({ sprite, name, sub }: { sprite: string; name: string; sub?: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 20, paddingBottom: 22, marginBottom: 26, borderBottom: "2px solid #e6dcc5" }}>
    <Face sprite={sprite} size={84} />
    <div>
      <div style={{ fontSize: 34, fontWeight: 700 }}>{name}</div>
      {sub ? <div style={{ fontSize: 24, color: color.muted }}>{sub}</div> : null}
    </div>
  </div>
);

export const Sfx = ({ src, at, volume = 0.6 }: { src: string; at: number; volume?: number }) => (
  <Sequence from={at} durationInFrames={90} layout="none">
    <Audio src={staticFile(`audio/sfx-${src}.ogg`)} volume={volume} />
  </Sequence>
);

/** Honest corner label shown throughout. */
export const WipTag = () => (
  <div
    style={{
      position: "absolute",
      right: 36,
      top: 30,
      fontFamily: sans,
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: color.signal,
      background: "rgba(255,248,233,0.92)",
      border: `2px solid ${color.signal}`,
      borderRadius: 999,
      padding: "8px 18px",
    }}
  >
    Work in progress
  </div>
);
