import { describe, expect, it } from "vitest";
import { atBoardingSteps, waterfrontTasks } from "../apps/web/src/lib/demo/waterfront-progress";
import { newDemoV3State } from "../apps/web/src/lib/demo/v3-session";

describe("waterfront boarding requirements", () => {
  it("requires three core goals and does not count greetings or later evidence", () => {
    const state = newDemoV3State();
    state.notes.push({ id: "later", text: "Later evidence", source: "document", stageIndex: 1, at: 0 });
    const tasks = waterfrontTasks(state);
    expect(tasks).toHaveLength(3);
    expect(tasks.every(task => !task.done)).toBe(true);
  });
  it("accepts either historical figure without requiring optional activities", () => {
    const state = newDemoV3State();
    state.departureReady = true;
    state.decisions.push({ stage: 0, choice: "family", evidence: ["family"], prediction: "support" });
    state.notes.push({ id: "evidence", text: "Family record", source: "document", stageIndex: 0, at: 0 });
    expect(waterfrontTasks(state).filter(task => !task.done).map(task => task.id)).toEqual(["conversation"]);
    for (const characterId of ["lim", "gan"]) {
      const withConversation = { ...state, messages: [...state.messages, { ...state.messages[0], id: characterId, kind: "player" as const, characterId, stageIndex: 0, text: "What should I consider?" }] };
      expect(waterfrontTasks(withConversation).every(task => task.done)).toBe(true);
    }
  });
  it("uses the three walkable river-step tiles, not the neighbouring bank or water", () => {
    for (const x of [26, 27, 28]) expect(atBoardingSteps({x, y:18})).toBe(true);
    for (const point of [{x:25,y:18}, {x:29,y:18}, {x:27,y:17}, {x:27,y:19}]) expect(atBoardingSteps(point)).toBe(false);
  });
});
