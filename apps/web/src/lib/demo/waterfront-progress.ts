import type { DemoV3State } from "./v3-session";

export type WaterfrontActivities = { selected: string[]; checkedDate: boolean };
export const commitmentIds = ["food", "care", "contact", "departure"];

/** The same requirements drive the map checklist and the local demo's exit gate. */
export function waterfrontTasks(state: DemoV3State, activities: WaterfrontActivities) {
  const spokeTo = (id: string) => state.messages.some(
    (m) => m.stageIndex === 0 && m.kind === "player" && m.characterId === id,
  );
  return [
    { id: "supplies", label: "Arrange household support", done: new Set(activities.selected.filter(id => commitmentIds.includes(id))).size === 2 },
    { id: "news", label: "Check the dated record", done: activities.checkedDate },
    { id: "evidence", label: "Save an evidence passage", done: state.notes.some(n => n.stageIndex === 0 && n.source === "document") },
    { id: "lim", label: "Speak with Lim Bo Seng", done: spokeTo("lim") },
    { id: "gan", label: "Speak with Gan Choo Neo", done: spokeTo("gan") },
    { id: "decision", label: "Make your recommendation", done: Boolean(state.departureReady && state.decisions.some(d => d.stage === 0)) },
  ];
}

export function atBoardingSteps(point: { x: number; y: number }) {
  return point.x >= 26 && point.x <= 28 && point.y === 18;
}
