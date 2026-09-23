import { describe, expect, it } from "vitest";

import { withSceneBreaks } from "@/lib/play/transcript";
import type { PublicMessage } from "@/lib/turn-api/contract";

let seq = 0;
const line = (roomId: string | null, author: "player" | string, body = "hi"): PublicMessage => ({
  id: `m${(seq += 1)}`,
  roomId,
  authorType: author === "player" ? "player" : "agent",
  authorId: author === "player" ? "player" : author,
  authorName: author,
  body,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const scene = (currentRoomId: string | null) => ({
  currentRoomId,
  roomName: (roomId: string | null) => roomId ?? "the open air",
  actorName: (actorId: string) => actorId,
});

const labels = (items: ReturnType<typeof withSceneBreaks>) =>
  items.map((item) => (item.kind === "break" ? item.label : `said: ${item.message.body}`));

describe("transcript scene breaks", () => {
  it("opens with the room and marks a move between rooms", () => {
    const items = withSceneBreaks([line("forge", "player", "one"), line("forge", "smith", "two"), line("yard", "player", "three")], scene("yard"));
    expect(labels(items)).toEqual([
      "You entered forge",
      "said: one",
      "said: two",
      "You entered yard",
      "said: three",
    ]);
  });

  it("marks turning to someone else in the same room", () => {
    const items = withSceneBreaks(
      [line("forge", "player", "one"), line("forge", "smith", "two"), line("forge", "player", "three"), line("forge", "guard", "four")],
      scene("forge"),
    );
    expect(labels(items)).toEqual([
      "You entered forge",
      "said: one",
      "said: two",
      "You turned to guard",
      "said: three",
      "said: four",
    ]);
  });

  it("shows the room the player walked into before anyone speaks there", () => {
    const items = withSceneBreaks([line("forge", "smith", "one")], scene(null));
    expect(labels(items)).toEqual(["You entered forge", "said: one", "You entered the open air"]);
  });

  it("has nothing to separate in an empty transcript", () => {
    expect(withSceneBreaks([], scene("forge"))).toEqual([]);
  });
});
