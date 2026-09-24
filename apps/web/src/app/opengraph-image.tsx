import { ImageResponse } from "next/og";

import { MARK_PATHS } from "@/components/ui";

/**
 * Generated rather than committed as a PNG: the card is text, and a text card
 * that renders from the same strings as the page cannot drift from it. Uses
 * the same two registers as the site: the record's rule in ink-blue, the
 * simulation's in moss.
 */
export const alt = "Historical Adventures — history you can play";
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
          padding: 64,
          background: "#fff8e9",
          color: "#172033",
          fontFamily: "Arial, sans-serif",
          border: "18px solid #172033",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, fontWeight: 800 }}>
          <div style={{ display: "flex", padding: 8, border: "3px solid #172033", borderRadius: 14, background: "#ffe4d2" }}>
            <svg width={34} height={34} viewBox="0 0 32 32">
              <path d={MARK_PATHS.record} fill="#3659cf" />
              <path d={MARK_PATHS.world} fill="#258663" />
            </svg>
          </div>
          Historical Adventures
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          <div style={{ display: "flex", width: "fit-content", padding: "10px 20px", border: "3px solid #172033", borderRadius: 999, background: "#ffe66d", fontSize: 22, fontWeight: 800 }}>
            HISTORY YOU CAN PLAY
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 84, fontWeight: 900, lineHeight: 0.95, letterSpacing: -4 }}>
            <span>Don’t just teach history.</span>
            <span style={{ color: "#d85f35" }}>Drop them into it.</span>
          </div>
          <div style={{ display: "flex", fontSize: 25, color: "#5c6472" }}>
            Turn your sources into a world students can explore, question and change.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
