import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, sans } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (frame: number, start: number, length = 12) => interpolate(frame, [start, start + length], [0, 1], clamp);

/** Fade a whole scene in at its start and out at its end (0 = no fade, so hard cuts stay hard). */
export const SceneFade = ({ children, duration, fadeIn = 0, fadeOut = 0 }: { children: ReactNode; duration: number; fadeIn?: number; fadeOut?: number }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(fadeIn > 0 ? ramp(frame, 0, fadeIn) : 1, fadeOut > 0 ? 1 - ramp(frame, duration - fadeOut, fadeOut) : 1);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

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
