import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selectEndingMusic } from "@/lib/play/ending-music";

const ending = (id: string, title: string) => ({ id, title, summary: "A simulated outcome." });

describe("ending scores", () => {
  it("uses different existing tracks even when outcomes have similar titles", () => {
    const endings = Array.from({ length: 6 }, (_, i) => ending(String(i), `Agreement ${i}`));
    const tracks = endings.map((item) => selectEndingMusic(endings, item.id));
    expect(new Set(tracks).size).toBe(endings.length);
    for (const track of tracks) {
      expect(track).not.toContain("end-theme");
      expect(existsSync(resolve("apps/web/public", track.slice(1)))).toBe(true);
    }
    expect(selectEndingMusic(endings, "2")).toBe(tracks[2]);
  });

  it("distinguishes peaceful, tragic, and conflict outcomes", () => {
    const endings = [ending("peace", "The Throne Yields by Agreement"), ending("loss", "The Fall of the Court"), ending("war", "A War Without End")];
    expect(selectEndingMusic(endings, "peace")).toContain("peaceful.ogg");
    expect(selectEndingMusic(endings, "loss")).toContain("quiet.ogg");
    expect(selectEndingMusic(endings, "war")).toContain("tension.ogg");
  });

  it("has a safe fallback for a missing ending", () => {
    expect(selectEndingMusic([], "missing")).toBe("/game/ninja/audio/music/peaceful.ogg");
  });
});
