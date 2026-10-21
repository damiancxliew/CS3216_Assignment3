import type { DemoV3State } from "./v3-session";
import { stages } from "./lim-bo-seng";

/** Three shared requirements, enforced by both the demo UI and its local adapter. */
export function chapterTasks(state: DemoV3State) {
  const stage = stages[state.stage];
  return [
    {
      id: "evidence",
      label: "Save an evidence passage",
      done: state.notes.some(
        (n) => n.stageIndex === state.stage && n.source === "document",
      ),
    },
    {
      id: "conversation",
      label:
        state.stage === 0
          ? "Speak with Lim or Gan"
          : "Speak with either person",
      done: state.messages.some(
        (m) =>
          m.stageIndex === state.stage &&
          m.kind === "player" &&
          stage.npcs.some((n) => n.id === m.characterId),
      ),
    },
    {
      id: "decision",
      label: "Make your recommendation",
      done: Boolean(
        state.departureReady &&
          state.decisions.some((d) => d.stage === state.stage),
      ),
    },
  ];
}
