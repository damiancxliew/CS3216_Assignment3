import { expect, it } from "vitest";
import { memoryV3BriefStore } from "@/lib/v3/brief/store";

it("preserves the brief conversation after starting generation", async () => {
  const store = memoryV3BriefStore();
  const id = await store.create({ schoolId: "school", ownerId: "teacher" });
  const state = (await store.load(id))!.state!;
  state.messages.push({
    role: "user",
    text: "Focus on the treaty negotiations.",
    slot: "focus",
  });
  await store.save(id, state);
  expect(await store.startFromBrief(id, "Singapore 1819")).toBe(true);
  expect((await store.load(id))!.state).toEqual(state);
  expect(await store.findUntouched("teacher")).toBeNull();
});
