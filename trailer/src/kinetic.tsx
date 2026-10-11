import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { color, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Deep, slightly warm backdrop with slow drifting motes, for the argument beats. */
export const Backdrop = ({ children }: { children: ReactNode }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #222b40 0%, ${color.night} 70%)`, overflow: "hidden" }}>
      {Array.from({ length: 28 }, (_, i) => {
        const x = (i * 263) % 1920;
        const y = 1080 - ((frame * (0.6 + (i % 5) * 0.25) + i * 97) % 1180);
        const size = 4 + (i % 3) * 4;
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: size, height: size, background: i % 4 === 0 ? color.signal : "#f5eddf", opacity: 0.12 + (i % 4) * 0.04 }} />;
      })}
      {children}
    </AbsoluteFill>
  );
};

/**
 * A line whose words rise in one after another. Words listed in `accent` are coloured and underlined
 * by a sweeping bar once the line has landed.
 */
export const KineticLine = ({ text, start, size = 96, accent = [], accentColor = color.signal, top, weight = 700, exitAt }: {
  text: string; start: number; size?: number; accent?: string[]; accentColor?: string; top: number; weight?: number; exitAt?: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  const exit = exitAt === undefined ? 0 : interpolate(frame, [exitAt, exitAt + 10], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 140, right: 140, top, textAlign: "center", fontFamily: serif, fontWeight: weight, fontSize: size, lineHeight: 1.18, color: "#f5eddf", opacity: 1 - exit, transform: `translateY(${-exit * 30}px)`, filter: exit > 0 ? `blur(${exit * 8}px)` : undefined }}>
      {words.map((word, i) => {
        const t = spring({ frame: frame - start - i * 3, fps, config: { damping: 16, mass: 0.6 } });
        const isAccent = accent.includes(word.replace(/[.,?!…"“”]/g, ""));
        const bar = interpolate(frame, [start + words.length * 3 + 6, start + words.length * 3 + 18], [0, 1], clamp);
        return (
          <span key={`${word}-${i}`} style={{ display: "inline-block", marginRight: size * 0.26, opacity: t, transform: `translateY(${(1 - t) * size * 0.55}px)`, color: isAccent ? accentColor : undefined, position: "relative" }}>
            {word}
            {isAccent ? <span style={{ position: "absolute", left: 0, bottom: size * 0.02, height: size * 0.08, width: `${bar * 100}%`, background: accentColor }} /> : null}
          </span>
        );
      })}
    </div>
  );
};

/** A big numbered point sliding in from the left. */
export const NumberedPoint = ({ n, text, start, top, accent }: { n: number; text: string; start: number; top: number; accent: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - start, fps, config: { damping: 15 } });
  return (
    <div style={{ position: "absolute", left: 260, right: 200, top, display: "flex", alignItems: "center", gap: 46, opacity: t, transform: `translateX(${(1 - t) * -80}px)` }}>
      <div style={{ width: 120, height: 120, background: accent, color: color.night, fontFamily: serif, fontWeight: 700, fontSize: 70, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "8px 8px 0 rgba(0,0,0,0.35)" }}>{n}</div>
      <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 84, color: "#f5eddf", lineHeight: 1.1 }}>{text}</div>
    </div>
  );
};
