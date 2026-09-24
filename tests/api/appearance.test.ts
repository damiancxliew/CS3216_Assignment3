/**
 * Every character in the pack that the mapping can pick actually exists in
 * `public/game/ninja`, the pick is deterministic per stakeholder, and the role
 * hints do what they say. The play state carries a faceset for every agent
 * and a sprite for every actor, while generated identity art remains nullable.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadI1Spec } from "@adventure/generation/fixtures";
import type { AssetManifest, AssetRecord } from "@adventure/generation/assets";
import { FakeLlmClient } from "@adventure/orchestration";
import { describe, expect, it } from "vitest";

import { CHARACTERS, characterFor, facesetUrl, PLAYER_CHARACTER, walkSheetUrl } from "@/lib/play/appearance";
import { getState, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore } from "@/lib/play/store";

const PUBLIC = join(process.cwd(), "apps", "web", "public");

describe("curated characters", () => {
  it("ship every sheet and faceset the mapping can choose, with the pack licence", () => {
    for (const character of CHARACTERS) {
      expect(existsSync(join(PUBLIC, walkSheetUrl(character))), character).toBe(true);
      expect(existsSync(join(PUBLIC, facesetUrl(character))), character).toBe(true);
    }
    expect(existsSync(join(PUBLIC, "game", "ninja", "LICENSE.txt"))).toBe(true);
    for (const tile of ["floor", "wall", "interior", "house"]) expect(existsSync(join(PUBLIC, "game", "ninja", "tiles", `${tile}.png`)), tile).toBe(true);
    for (const theme of ["desert", "winter", "forest", "coast"]) expect(existsSync(join(PUBLIC, "game", "themes", theme, "terrain.png")), theme).toBe(true);
  });

  it("picks the same character for the same stakeholder, and a fitting one for a known role", () => {
    const sultan = { id: "hussein", name: "Tengku Hussein", role: "Claimant to the Johor sultanate" };
    expect(characterFor(sultan)).toBe(characterFor({ ...sultan }));
    expect(["Sultan", "Sultan2", "Noble"]).toContain(characterFor(sultan));
    expect(["Inspector", "Knight", "Master"]).toContain(characterFor({ id: "farquhar", name: "Major William Farquhar", role: "Resident" }));
    expect(["OldMan", "OldMan2", "OldMan3"]).toContain(characterFor({ id: "temenggong", name: "Temenggong Abdul Rahman", role: "Chief of Singapore" }));
    expect(characterFor({ id: "anyone", name: "Someone", role: "" })).not.toBe(PLAYER_CHARACTER);
    expect(CHARACTERS).toContain(characterFor({ id: "x" }));
  });

  it("appear in the play state as sprites with nullable generated portraits", async () => {
    const spec = await loadI1Spec();
    const deps: PlayServiceDeps = {
      store: new MemoryPlayStore([{ attemptId: "a", studentId: "s", adventureId: "adv", publishedVersion: 1, status: "active", stageDeadlineAt: null, spec, snapshot: null }]),
      llm: new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [] })] }),
    };
    const result = await getState(deps, "a", "s");
    if (!result.ok) throw new Error(result.error.message);
    const { state } = result;
    expect(state.actors.find((a) => a.id === "player")?.sprite).toBe(PLAYER_CHARACTER);
    for (const actor of state.actors) expect(CHARACTERS).toContain(actor.sprite);
    for (const agent of state.agents) expect(agent.portraitUrl).toBeNull();
  });

  it("passes the chosen stage theme and ready story images to the play map", async () => {
    const spec = await loadI1Spec();
    spec.stages[0]!.mapTheme = "coast";
    const room = spec.stages[0]!.rooms.find((candidate) => candidate.landmark)!;
    const evidence = spec.stages[0]!.evidence[0]!;
    const makeRecord = (kind: "landmark" | "prop", entityId: string): AssetRecord => ({
      assetId: `asset-${kind}`, entityId, kind, status: "ready", url: `https://example.test/${kind}.png`,
      placeholderUrl: "", promptHash: "test", model: "test", costUsd: 0, error: null,
    });
    const assets: AssetManifest = {
      adventureId: spec.id, specVersion: spec.version,
      records: [makeRecord("landmark", room.id), makeRecord("prop", evidence.id)],
      generatedCount: 2, cacheHits: 0, totalCostUsd: 0, startedAt: "", finishedAt: "",
    };
    const deps: PlayServiceDeps = {
      store: new MemoryPlayStore([{ attemptId: "theme-a", studentId: "s", adventureId: spec.id, publishedVersion: 1, status: "active", stageDeadlineAt: null, spec, snapshot: null, assets }]),
      llm: new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [] })] }),
    };
    const result = await getState(deps, "theme-a", "s");
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.stage.mapTheme).toBe("coast");
    expect(result.state.landmarks).toContainEqual(expect.objectContaining({
      id: room.id,
      roomId: room.id,
      name: room.landmark!.name,
      width: 2,
      height: 2,
      imageUrl: "https://example.test/landmark.png",
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    }));
    expect(result.state.map?.landmarks).toContainEqual(expect.objectContaining({ roomId: room.id, width: 2, height: 2 }));
    expect(result.state.evidenceImages[evidence.id]).toBe("https://example.test/prop.png");
  });
});
