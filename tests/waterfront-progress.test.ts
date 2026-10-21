import { describe, expect, it } from "vitest";
import { atBoardingSteps, waterfrontTasks } from "../apps/web/src/lib/demo/waterfront-progress";
import { newDemoV3State } from "../apps/web/src/lib/demo/v3-session";

describe("waterfront boarding requirements", () => {
  it("does not count greeting lines, duplicate commitments or evidence from another stage", () => {
    const state = newDemoV3State();
    state.notes.push({ id: "later", text: "Later evidence", source: "document", stageIndex: 1, at: 0 });
    const tasks = waterfrontTasks(state, { selected: ["food", "food"], checkedDate: false });
    expect(tasks.every(task => !task.done)).toBe(true);
  });
  it("requires every task and a stage-zero decision, even when departure was previously unlocked", () => {
    const state = newDemoV3State();
    state.departureReady = true;
    state.decisions.push({ stage: 0, choice: "family", evidence: ["family"], prediction: "support" });
    state.notes.push({ id: "evidence", text: "Family record", source: "document", stageIndex: 0, at: 0 });
    for (const characterId of ["lim", "gan"]) state.messages.push({ ...state.messages[0], id: characterId, kind: "player", characterId, stageIndex: 0, text: "What should I consider?" });
    expect(waterfrontTasks(state, { selected: ["food", "care"], checkedDate: false }).filter(task => !task.done).map(task => task.id)).toEqual(["news"]);
    expect(waterfrontTasks(state, { selected: ["food", "care"], checkedDate: true }).every(task => task.done)).toBe(true);
  });
  it("uses the three walkable river-step tiles, not the neighbouring bank or water", () => {
    for (const x of [26, 27, 28]) expect(atBoardingSteps({x, y:18})).toBe(true);
    for (const point of [{x:25,y:18}, {x:29,y:18}, {x:27,y:17}, {x:27,y:19}]) expect(atBoardingSteps(point)).toBe(false);
  });
});
