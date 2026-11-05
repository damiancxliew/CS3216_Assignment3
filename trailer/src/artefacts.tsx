import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { blackletter, color, fell, fellCaps, oldStandard, pixel, script } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const hash = (n: number) => {
  const h = Math.sin(n * 91.345 + 7.13) * 43758.5453;
  return h - Math.floor(h);
};

/** A jagged clip-path so the paper looks torn rather than cut. */
const tornEdge = (seed: number, depth = 1.2) => {
  const pts: string[] = [];
  const steps = 26;
  for (let i = 0; i <= steps; i++) pts.push(`${(i / steps) * 100}% ${hash(seed + i) * depth}%`);
  for (let i = 0; i <= steps; i++) pts.push(`${100 - hash(seed + 50 + i) * depth * 0.6}% ${(i / steps) * 100}%`);
  for (let i = steps; i >= 0; i--) pts.push(`${(i / steps) * 100}% ${100 - hash(seed + 100 + i) * depth}%`);
  for (let i = steps; i >= 0; i--) pts.push(`${hash(seed + 150 + i) * depth * 0.6}% ${(i / steps) * 100}%`);
  return `polygon(${pts.join(", ")})`;
};

/** Aged paper: base tone, uneven yellowing, foxing spots and fine grain. */
const Paper = ({ seed, tone = "#efe2c1", children, style }: { seed: number; tone?: string; children: ReactNode; style?: CSSProperties }) => {
  const spots = Array.from({ length: 9 }, (_, i) => ({ x: hash(seed * 3 + i) * 100, y: hash(seed * 5 + i) * 100, r: 6 + hash(seed * 7 + i) * 22, a: 0.05 + hash(seed + i) * 0.08 }));
  return (
    <div style={{ position: "relative", background: tone, overflow: "hidden", ...style }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 30% 20%, rgba(255,255,240,0.55) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse at 85% 90%, rgba(150,105,40,0.28) 0%, rgba(0,0,0,0) 60%), radial-gradient(ellipse at 5% 95%, rgba(130,90,30,0.22) 0%, rgba(0,0,0,0) 45%)` }} />
      {spots.map((spot, i) => (
        <div key={i} style={{ position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`, width: spot.r, height: spot.r, borderRadius: "50%", background: `radial-gradient(circle, rgba(140,90,30,${spot.a * 1.6}) 0%, rgba(140,90,30,${spot.a}) 45%, rgba(0,0,0,0) 72%)` }} />
      ))}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", mixBlendMode: "multiply", opacity: 0.35 }} aria-hidden>
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} />
          <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.22  0 0 0 0.55 0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
};

const IllustrativeMark = () => (
  <div style={{ position: "absolute", right: 22, bottom: 16, fontFamily: pixel, fontWeight: 700, fontSize: 20, letterSpacing: 1.5, color: color.signal, border: `2px solid ${color.signal}`, padding: "1px 10px", transform: "rotate(-4deg)", background: "rgba(255,248,233,0.7)" }}>
    ILLUSTRATIVE
  </div>
);

/** An ink highlighter sweeping across a phrase from `at`. */
export const Mark = ({ children, at, tint = "rgba(255,205,60,0.62)" }: { children: ReactNode; at: number; tint?: string }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 14], [0, 100], clamp);
  return (
    <span style={{ backgroundImage: `linear-gradient(${tint}, ${tint})`, backgroundRepeat: "no-repeat", backgroundSize: `${t}% 78%`, backgroundPosition: "0 70%", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
      {children}
    </span>
  );
};

/** A torn newspaper clipping in period type. */
export const NewspaperClipping = ({ markAt, style }: { markAt: number; style?: CSSProperties }) => (
  <div style={{ position: "absolute", filter: "drop-shadow(10px 16px 14px rgba(0,0,0,0.45))", ...style }}>
    <div style={{ clipPath: tornEdge(3), width: 940 }}>
      <Paper seed={3} style={{ padding: "34px 46px 54px" }}>
        <div style={{ textAlign: "center", fontFamily: blackletter, fontSize: 82, lineHeight: 1, color: "#221a12" }}>The Straits Courier.</div>
        <div style={{ borderTop: "3px solid #2a2016", borderBottom: "1px solid #2a2016", margin: "14px 0 6px", padding: "5px 0", display: "flex", justifyContent: "space-between", fontFamily: oldStandard, fontSize: 18, letterSpacing: 1, color: "#2a2016" }}>
          <span>No. 7.]</span>
          <span>SINCAPORE, TUESDAY, FEBRUARY 9, 1819.</span>
          <span>[Price One Dollar.</span>
        </div>
        <div style={{ borderTop: "1px solid #2a2016", marginBottom: 18 }} />
        <div style={{ textAlign: "center", fontFamily: fellCaps, fontSize: 40, letterSpacing: 2, color: "#221a12", marginBottom: 14 }}>The New Settlement.</div>
        <div style={{ columnCount: 2, columnGap: 34, columnRule: "1px solid rgba(42,32,22,0.5)", fontFamily: fell, fontSize: 25, lineHeight: 1.42, textAlign: "justify", color: "#231b13", hyphens: "auto" }}>
          <p style={{ margin: 0, textIndent: 26 }}>
            We learn that Sir T. S. Raffles has concluded an engagement with the chiefs of this island, by which the Honourable
            Company is to raise a factory at the mouth of the river. The Temenggong, who governs here, is said to have{" "}
            <Mark at={markAt}>pressed hard for his share of the duties</Mark> upon native vessels, and would not be moved from it.
          </p>
          <p style={{ margin: "8px 0 0", textIndent: 26 }}>
            The Dutch at Malacca are reported to view the settlement with no small displeasure; and it is not yet known whether
            the Government at Calcutta will approve what has been done.
          </p>
        </div>
        <IllustrativeMark />
      </Paper>
    </div>
  </div>
);

/** An open memoir: running heads, chapter title, drop capital, gutter shadow. */
export const MemoirSpread = ({ markAt, style }: { markAt: number; style?: CSSProperties }) => (
  <div style={{ position: "absolute", filter: "drop-shadow(12px 18px 16px rgba(0,0,0,0.5))", ...style }}>
    <div style={{ display: "flex", width: 1060, height: 640, borderRadius: 6, overflow: "hidden", background: "#5b3a22", padding: 10 }}>
      {[0, 1].map((side) => (
        <Paper key={side} seed={20 + side} tone="#f1e6c8" style={{ flex: 1, padding: "34px 46px", boxShadow: side === 0 ? "inset -40px 0 50px -20px rgba(60,35,10,0.45)" : "inset 40px 0 50px -20px rgba(60,35,10,0.45)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fellCaps, fontSize: 17, letterSpacing: 1.5, color: "#4a3a28", borderBottom: "1px solid rgba(74,58,40,0.5)", paddingBottom: 6, marginBottom: 18 }}>
            {side === 0 ? (<><span>112</span><span>Recollections of a Malay Scribe.</span><span /></>) : (<><span /><span>Of the Coming of the English.</span><span>113</span></>)}
          </div>
          {side === 0 ? (
            <div style={{ fontFamily: fell, fontSize: 25, lineHeight: 1.5, color: "#2b2117", textAlign: "justify" }}>
              <div style={{ textAlign: "center", fontFamily: fellCaps, fontSize: 24, letterSpacing: 2, margin: "0 0 4px" }}>Chap. IV.</div>
              <div style={{ textAlign: "center", fontStyle: "italic", fontSize: 24, margin: "0 0 16px" }}>Of the Coming of the English.</div>
              <span style={{ float: "left", fontFamily: fellCaps, fontSize: 78, lineHeight: 0.9, padding: "4px 10px 0 0", color: "#6d2a17" }}>W</span>
              hen the English ships came to anchor, the people of the island gathered upon the shore. And though the Englishman wrote that
              the place was empty, <Mark at={markAt} tint="rgba(216,95,53,0.35)">my own kin had fished these waters and kept their houses here</Mark> for many years before.
            </div>
          ) : (
            <div style={{ fontFamily: fell, fontSize: 25, lineHeight: 1.5, color: "#2b2117", textAlign: "justify", textIndent: 26 }}>
              The Temenggong received them civilly, and gave them leave to land; yet he spoke much, and often, of what his people would
              lose if the trade of the river passed into other hands. Of the young prince Hussein, who was then at Riau, the Englishman
              asked a great many questions.
            </div>
          )}
          {side === 1 ? <IllustrativeMark /> : null}
        </Paper>
      ))}
    </div>
  </div>
);

/** A handwritten letter in brown ink with a wax seal. */
export const Letter = ({ markAt, style }: { markAt: number; style?: CSSProperties }) => (
  <div style={{ position: "absolute", filter: "drop-shadow(10px 16px 14px rgba(0,0,0,0.5))", transform: "rotate(3deg)", ...style }}>
    <Paper seed={41} tone="#f3e8cf" style={{ width: 720, padding: "36px 52px 70px", clipPath: tornEdge(41, 0.6) }}>
      <div style={{ textAlign: "right", fontFamily: script, fontSize: 38, color: "#5a3a1e" }}>Sincapore, 31st Jan<sup>y</sup> 1819</div>
      <div style={{ fontFamily: script, fontSize: 52, lineHeight: 1.35, color: "#4b2e16", marginTop: 14 }}>
        <div>My dear Sir,</div>
        <div style={{ paddingLeft: 40 }}><Mark at={markAt} tint="rgba(216,95,53,0.35)">The island is all but deserted,</Mark></div>
        <div>& there is no prince with a claim to it</div>
        <div>who could hinder our design…</div>
      </div>
      <div style={{ textAlign: "right", fontFamily: script, fontSize: 56, color: "#4b2e16", marginTop: 6 }}>T. S. Raffles</div>
      <div style={{ position: "absolute", left: 60, bottom: 30, width: 86, height: 86, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #c4322a 0%, #8e1d17 60%, #6a120e 100%)", boxShadow: "inset 0 0 0 6px rgba(0,0,0,0.12), 2px 3px 6px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: script, fontSize: 44, color: "rgba(255,220,200,0.55)" }}>R</div>
      <IllustrativeMark />
    </Paper>
  </div>
);

/** A printed summary of the real record, used for the reveal. */
export const ArchivalRecord = ({ items, appearAt, style }: { items: readonly string[]; appearAt: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", filter: "drop-shadow(12px 18px 16px rgba(0,0,0,0.5))", ...style }}>
      <Paper seed={60} tone="#efe4c6" style={{ width: 760, padding: "40px 54px 46px", border: "10px double rgba(70,50,30,0.55)" }}>
        <div style={{ textAlign: "center", fontFamily: fellCaps, fontSize: 24, letterSpacing: 3, color: "#4a3a28" }}>What really happened</div>
        <div style={{ textAlign: "center", fontFamily: blackletter, fontSize: 52, color: "#221a12", margin: "6px 0 4px" }}>Treaty at Singapore</div>
        <div style={{ textAlign: "center", fontFamily: fell, fontStyle: "italic", fontSize: 26, color: "#4a3a28", marginBottom: 20 }}>6th February 1819</div>
        {items.map((item, i) => (
          <div key={item} style={{ display: "flex", gap: 14, fontFamily: fell, fontSize: 30, lineHeight: 1.35, color: "#231b13", margin: "0 0 12px", opacity: interpolate(frame, [appearAt + i * 8, appearAt + i * 8 + 8], [0, 1], clamp) }}>
            <span style={{ color: "#6d2a17" }}>❧</span>
            {item}
          </div>
        ))}
        <div style={{ textAlign: "right", fontFamily: fellCaps, fontSize: 16, letterSpacing: 1.5, color: "#6b5a44", marginTop: 8 }}>Summary of the historical record</div>
      </Paper>
    </div>
  );
};
