import { ImageResponse } from "next/og";

/**
 * Generated rather than committed as a PNG: the card is text, and a text card
 * that renders from the same strings as the page cannot drift from it.
 */
export const alt = "Historical Adventures — play the source material";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 24,
          padding: 80,
          background: "#0b0f0c",
          color: "#f5f5f4",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 6, color: "#6ee7b7" }}>
          HISTORICAL ADVENTURES
        </div>
        <div style={{ fontSize: 88, fontWeight: 600, lineHeight: 1.05 }}>
          Play the source material.
        </div>
        <div style={{ fontSize: 32, color: "#a8a29e", maxWidth: 900 }}>
          Teachers turn historical sources into a world. Students question the
          people in it, decide, and see what the record actually says.
        </div>
      </div>
    ),
    size,
  );
}
