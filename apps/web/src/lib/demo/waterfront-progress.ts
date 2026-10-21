import type { DemoV3State } from "./v3-session";

/** The same requirements drive the map checklist and the local demo's exit gate. */
export function waterfrontTasks(state: DemoV3State) {
  const spokeTo = (id: string) => state.messages.some(
    (m) => m.stageIndex === 0 && m.kind === "player" && m.characterId === id,
  );
  return [
    { id: "evidence", label: "Save an evidence passage", done: state.notes.some(n => n.stageIndex === 0 && n.source === "document") },
    { id: "conversation", label: "Speak with Lim or Gan", done: spokeTo("lim") || spokeTo("gan") },
    { id: "decision", label: "Make your recommendation", done: Boolean(state.departureReady && state.decisions.some(d => d.stage === 0)) },
  ];
}

export function atBoardingSteps(point: { x: number; y: number }) {
  return point.x >= 26 && point.x <= 28 && point.y === 18;
}
