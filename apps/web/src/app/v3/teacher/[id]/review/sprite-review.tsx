"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { compactButton as button } from "@/components/ui";
export const SPRITE_DIRECTIONS = ["Down", "Up", "Left", "Right"] as const;
export function SpriteReview({ url, label }: { url: string; label: string }) {
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const source = attempt
    ? `${url}${url.includes("?") ? "&" : "?"}asset_retry=${attempt}`
    : url;
  useEffect(() => {
    setStatus("loading");
    // CSS background images do not emit load/error events. Probe independently of the closed full-sheet disclosure.
    const probe = new window.Image();
    probe.onload = () => setStatus("ready");
    probe.onerror = () => setStatus("failed");
    probe.src = source;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [source]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!preference.matches);
    const change = () => {
      if (preference.matches) setPlaying(false);
    };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!playing || status !== "ready") {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => setFrame((frame) => (frame + 1) % 4), 125);
    return () => clearInterval(timer);
  }, [playing, status]);
  return (
    <div className="space-y-3" aria-label={`${label} walking review`}>
      <div className="grid grid-cols-4 gap-2">
        {SPRITE_DIRECTIONS.map((direction, column) => (
          <figure key={direction} className="text-center">
            <div
              role="img"
              aria-label={`${label}: ${direction.toLowerCase()}, ${playing ? "walking" : "idle"}`}
              className="mx-auto h-16 w-16 max-w-full bg-sunken [image-rendering:pixelated]"
              style={
                status !== "ready"
                  ? undefined
                  : {
                      backgroundImage: `url(${JSON.stringify(source)})`,
                      backgroundSize: "400% 400%",
                      backgroundPosition: `${(column * 100) / 3}% ${(frame * 100) / 3}%`,
                    }
              }
            />
            <figcaption className="text-xs">{direction}</figcaption>
          </figure>
        ))}
      </div>
      <button
        type="button"
        className={button.subtle}
        disabled={status !== "ready"}
        onClick={() => setPlaying((value) => !value)}
        aria-pressed={playing}
      >
        {playing ? "Pause" : "Play"} walking preview
      </button>
      {status === "loading" ? (
        <p role="status" className="text-sm text-muted">
          Loading sheet…
        </p>
      ) : null}
      {status === "failed" ? (
        <>
          <p role="status" className="text-sm">
            Sheet unavailable. The map will use the bundled fallback.
          </p>
          <button
            type="button"
            className={button.subtle}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry loading
          </button>
        </>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm underline">
          Full sheet
        </summary>
        <Image
          key={source}
          unoptimized
          src={source}
          alt={`${label}, four columns down, up, left, right; four animation rows`}
          width={512}
          height={512}
          className="max-w-full h-auto [image-rendering:pixelated]"
          onError={() => setStatus("failed")}
        />
      </details>
    </div>
  );
}
