import { describe, expect, it } from "vitest";
import { FakeLlmClient } from "@adventure/orchestration";

import { chooseRoomResponder } from "@/lib/play/reply-router";

const candidates = [
  { id: "a", name: "Ada", role: "Clerk" },
  { id: "b", name: "Bela", role: "Merchant" },
  { id: "c", name: "Cato", role: "Guard" },
];

describe("room reply router", () => {
  it("keeps at most two distinct present responders in speaking order", async () => {
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ agentIds: ["b", "b"] })] });
    const selected = await chooseRoomResponder(llm, "What does the market think?", candidates, []);
    expect(selected.agentIds).toEqual(["b"]);
    expect(llm.requests[0]?.schemaName).toBe("room_reply_route");
  });

  it("falls back to a present person when the model names someone absent", async () => {
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ agentIds: ["outsider"] })] });
    expect((await chooseRoomResponder(llm, "Hello", candidates, [])).agentIds).toEqual(["a"]);
  });
});
