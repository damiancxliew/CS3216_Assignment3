import { ImageResponse } from "next/og";

/**
 * Generated rather than committed as a PNG: the card is text, and a text card
 * that renders from the same strings as the page cannot drift from it. Uses
 * the same two registers as the site: the record's rule in ink-blue, the
 * simulation's in moss.
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
          justifyContent: "space-between",
          padding: 72,
          background: "#f1f3f5",
          color: "#17202a",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28 }}>
          <svg width="34" height="34" viewBox="0 0 64 64">
            <rect x="18" y="12" width="5" height="40" rx="2.5" fill="#1f4b8a" />
            <path d="M26 15h22l-8 10 8 10H26z" fill="#1f4b8a" />
          </svg>
          Historical Adventures
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 96, lineHeight: 1.02, letterSpacing: -2 }}>
            Play the source material.
          </div>
          <div style={{ display: "flex", gap: 40, fontSize: 26, fontFamily: "Arial, sans-serif", color: "#5b6673" }}>
            <div style={{ display: "flex", borderLeft: "5px solid #1f4b8a", paddingLeft: 18, maxWidth: 480 }}>
              What the documents say, with the source and the page.
            </div>
            <div style={{ display: "flex", borderLeft: "5px solid #5e6f3f", paddingLeft: 18, maxWidth: 480 }}>
              What the simulation did, and what it assumed.
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
