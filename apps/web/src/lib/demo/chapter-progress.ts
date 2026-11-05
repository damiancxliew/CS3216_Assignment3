import type { DemoV3State } from "./v3-session";
import { stages } from "./lim-bo-seng";

/** Chapter 2 asks for a written inference from the occupation newspaper (Source D). */
export const INFERENCE_STAGE = 1;
export const INFERENCE_SOURCE_ID = "press";
export const INFERENCE_NOTE_ID = `source-${INFERENCE_STAGE}-${INFERENCE_SOURCE_ID}`;

/** Three shared requirements, enforced by both the demo UI and its local adapter. */
export function chapterTasks(state: DemoV3State) {
  const stage = stages[state.stage];
  const documentNote = state.notes.some(
    (n) => n.stageIndex === state.stage && n.source === "document",
  );
  return [
    state.stage === INFERENCE_STAGE
      ? {
          id: "inference",
          label: "Explain what the occupation newspaper reveals",
          // The written inference saves the newspaper note. Saves from before this
          // goal existed keep their progress once a decision was recorded.
          done:
            state.notes.some((n) => n.id === INFERENCE_NOTE_ID) ||
            (documentNote && state.decisions.some((d) => d.stage === state.stage)),
        }
      : {
          id: "evidence",
          label: "Earn an evidence note",
          done: documentNote,
        },
    {
      id: "conversation",
      label: "Speak with someone here",
      done: state.messages.some(
        (m) =>
          m.stageIndex === state.stage &&
          m.kind === "player" &&
          stage.npcs.some((n) => n.id === m.characterId),
      ),
    },
    {
      id: "decision",
      label:
        state.stage === 0
          ? "Make your recommendation"
          : "Judge what the evidence supports",
      done: Boolean(
        state.departureReady &&
          state.decisions.some((d) => d.stage === state.stage),
      ),
    },
  ];
}
