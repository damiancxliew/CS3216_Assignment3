import { ImageResponse } from "next/og";

import { MARK_PATHS } from "@/components/ui";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const displayHost = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Keep a param to one printable line: crawlers can pass anything. */
function clean(value: string | null, fallback: string, max: number) {
  if (!value) return fallback;
  const stripped = value.replace(/[\r\n\x00-\x1f\x7f]+/g, " ").trim();
  if (!stripped) return fallback;
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

/**
 * The "ending card" students share from the debrief. Same card language as
 * opengraph-image.tsx — paper, ink border, the two registers — but the
 * headline is the ending a player reached and the strap sells the adventure
 * it came from.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ending = clean(searchParams.get("title"), "They reached an ending", 90);
  const adventure = clean(searchParams.get("adventure"), "A historical adventure", 60);

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
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "flex", fontFamily: "Georgia, serif", fontSize: 34, fontStyle: "italic", color: "#3659cf" }}>
            {adventure}
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 80, fontWeight: 900, lineHeight: 0.95, letterSpacing: -3 }}>
            {ending}
          </div>
          <div style={{ display: "flex", alignSelf: "flex-start", padding: "10px 20px", border: "3px solid #172033", borderRadius: 999, background: "#ffe66d", fontSize: 22, fontWeight: 800 }}>
            A PLAYER REACHED THIS ENDING
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "4px solid #172033", paddingTop: 26, fontSize: 26, fontWeight: 800 }}>
          <span style={{ color: "#d85f35" }}>history you can play</span>
          <span style={{ color: "#5c6472" }}>{displayHost}</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
