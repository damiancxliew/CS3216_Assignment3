"use client";

import { useState } from "react";

import type { PlayerLook } from "@/lib/play/v3/player-look";

/**
 * The student's face, drawn crisp. A bundled faceset is shown whole; a walking sheet (4×4 grid,
 * first cell faces the viewer) is cropped to the head and shoulders of that front frame.
 */
export function PlayerPortrait({ look, name, className = "" }: { look: PlayerLook; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim()[0]?.toUpperCase() ?? "?";
  if (failed || (!look.faceUrl && !look.sheetUrl)) {
    return <span aria-hidden className={`grid place-items-center font-bold text-[#fffaf0] ${className}`}>{initial}</span>;
  }
  if (look.faceUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny pixel faceset
      <img src={look.faceUrl} alt="" aria-hidden className={`object-contain [image-rendering:pixelated] ${className}`} onError={() => setFailed(true)} />
    );
  }
  return (
    <span aria-hidden className={`relative block overflow-hidden ${className}`}>
      {/* The cell is drawn at 135% so the head fills the frame; the feet fall below the crop. */}
      <span
        className="absolute left-1/2 top-[4%] block aspect-square w-[135%] -translate-x-1/2 [image-rendering:pixelated]"
        style={{ backgroundImage: `url("${look.sheetUrl}")`, backgroundSize: "400% 400%", backgroundPosition: "0 0", backgroundRepeat: "no-repeat" }}
      />
      {/* Detect a broken sheet URL, which a CSS background cannot report. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- load probe only */}
      <img src={look.sheetUrl!} alt="" className="hidden" onError={() => setFailed(true)} />
    </span>
  );
}
