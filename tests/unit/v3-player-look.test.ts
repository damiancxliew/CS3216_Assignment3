import { describe, expect, it } from "vitest";

import { playerCharacterFor, resolvePlayerLook, withPlayerLook } from "@/lib/play/v3/player-look";
import type { V3StageScenery } from "@/lib/play/v3/scenery";

const sam1942 = { name: "Sam", position: "Junior liaison officer at army headquarters (fictional)" };
const sam1819 = { name: "Sam", position: "Clerk to Stamford Raffles" };

describe("player look", () => {
  it("matches the role and period instead of the default grinning boy", () => {
    expect(playerCharacterFor(sam1942, "Fort Canning, Singapore, early February 1942")).toBe("Inspector");
    expect(playerCharacterFor(sam1819, "Singapore River, January 1819")).toBe("Boy");
    expect(playerCharacterFor({ name: "Mei", position: "Volunteer nurse" }, "Singapore, 1942")).toBe("Woman");
    // No armour or ninja headbands for a modern soldier, even as a fallback.
    expect(playerCharacterFor({ name: "Ali", position: "Private in the Malay Regiment" }, "Pasir Panjang, 1942")).not.toMatch(/Knight|Hunter/);
    expect(playerCharacterFor({ name: "Wat", position: "A soldier of the king" }, "Malacca, 1511")).toBe("Knight");
  });

  it("skips a look an NPC already wears when the role has another", () => {
    expect(playerCharacterFor(sam1942, "1942", new Set(["Inspector"]))).toBe("Noble");
  });

  it("prefers the adventure's own player sprite, custom or bundled", () => {
    const custom: V3StageScenery = { roomDescriptions: {}, storyContext: "", walkingSprites: { player: { sprite: "Boy", spriteSheetUrl: "https://cdn.example/sam.png", selection: "custom" } } };
    expect(resolvePlayerLook({ briefing: sam1942, context: "1942", scenery: custom })).toMatchObject({ source: "custom-sprite", faceUrl: null, sheetUrl: "https://cdn.example/sam.png" });
    const bundled: V3StageScenery = { roomDescriptions: {}, storyContext: "", walkingSprites: { player: { sprite: "Noble", spriteSheetUrl: "/game/ninja/characters/Noble/walk.png", selection: "bundled" } } };
    expect(resolvePlayerLook({ briefing: sam1942, context: "1942", scenery: bundled })).toMatchObject({ source: "chosen-sprite", character: "Noble", faceUrl: "/game/ninja/characters/Noble/face.png" });
    const fallback: V3StageScenery = { roomDescriptions: {}, storyContext: "", walkingSprites: { player: { sprite: "Boy", spriteSheetUrl: "/game/ninja/characters/Boy/walk.png", selection: "default" } } };
    const look = resolvePlayerLook({ briefing: sam1942, context: "1942", scenery: fallback });
    expect(look).toMatchObject({ source: "role-match", character: "Inspector", faceUrl: "/game/ninja/characters/Inspector/face.png" });
    // The map walks the same person.
    expect(withPlayerLook(fallback, look)?.walkingSprites?.player).toMatchObject({ sprite: "Inspector", spriteSheetUrl: "/game/ninja/characters/Inspector/walk.png" });
    expect(withPlayerLook(custom, resolvePlayerLook({ briefing: sam1942, context: "1942", scenery: custom }))).toBe(custom);
  });
});
