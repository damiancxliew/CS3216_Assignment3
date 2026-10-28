import type { Action } from "@adventure/play-contract";
import type { DemoV3State } from "./v3-session";
import { stages } from "./lim-bo-seng";

export type DemoEventName = "demo_started" | "demo_resumed" | "demo_restarted" |
  "demo_chapter_started" | "demo_chapter_completed" | "demo_room_entered" |
  "demo_source_inspected" | "demo_quiz_answered" | "demo_npc_conversation_started" |
  "demo_decision_submitted" | "demo_completed" | "demo_report_downloaded";
export type DemoEvent = { event: DemoEventName; properties: Record<string, string | number | boolean> };

export function demoContext(state: DemoV3State) {
  return { demo_id: "lim-bo-seng", chapter: state.stage + 1, chapter_id: stages[state.stage].id, room_id: state.room };
}

/** Called only after validation and commit. Never include student-authored text. */
export function demoActionEvents(before: DemoV3State, after: DemoV3State, action: Action): DemoEvent[] {
  const events: DemoEvent[] = [];
  const add = (event: DemoEventName, properties: DemoEvent["properties"] = {}, context = before) =>
    events.push({ event, properties: { ...demoContext(context), ...properties } });
  if (before.intro && !after.intro && after.phase === "stage") {
    add("demo_chapter_started");
    add("demo_room_entered", {}, after);
  }
  if (action.type === "enterRoom" && action.roomId !== "embark" && before.room !== after.room)
    add("demo_room_entered", {}, after);
  if (action.type === "enterRoom" && action.roomId === "embark" && (before.stage !== after.stage || after.phase === "epilogue"))
    add("demo_chapter_completed");
  if ((action.type === "message" || action.type === "insertNote") && !before.messages.some(m =>
    m.kind === "player" && m.stageIndex === before.stage && m.characterId === action.characterId))
    add("demo_npc_conversation_started", { npc_id: action.characterId });
  if (action.type === "act" && after.decisions.length > before.decisions.length)
    add("demo_decision_submitted", { choice_id: action.actId });
  if (before.phase !== "reveal" && after.phase === "reveal") add("demo_completed");
  return events;
}
