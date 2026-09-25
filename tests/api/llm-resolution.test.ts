import { findPath } from "@adventure/game-core";
import { FakeLlmClient, moveActorStep, type LlmRequest } from "@adventure/orchestration";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";

const NPC_YIELD = JSON.stringify({ say: "", actions: [{ type: "yield" }] });
const NARRATION = "The harbour master signs, and the crowd on the quay goes quiet.";

async function openStage() {
  const spec = structuredClone(await loadI1Spec());
  const opening = spec.stages[0]!;
  // Isolate resolution from the objective gate; that gate has its own API coverage.
  opening.decision.requires = [];
  for (const option of opening.decision.options) option.preconditions = [];
  const choice = opening.decision.options.find((option) => option.id === "opt-sign-preliminary")!;
  return { spec, choice };
}

function narrate(reply: string) {
  return (request: LlmRequest) => (request.schemaName === "resolver_narration" ? reply : NPC_YIELD);
}

describe("LLM resolution", () => {
  it("narrates the rules' outcome from what the player heard, without changing the branch", async () => {
    const { spec, choice } = await openStage();
    const rules = PlaySession.start(spec, "llm-resolution", 1);
    const narrated = PlaySession.start(spec, "llm-resolution", 1);

    // Say something the Resolver should be able to read back.
    const agentId = narrated.currentStage.agents[0]!.id;
    const spatial = narrated.world.spatial!;
    for (const point of findPath(spatial.map, spatial.state.doors, spatial.state.actors.player!, spatial.state.actors[agentId]!)!) {
      expect(moveActorStep(narrated.world, "player", point).ok).toBe(true);
    }
    const heard = "Will the Sultan honour a preliminary agreement?";
    await narrated.message(new FakeLlmClient({ replies: [JSON.stringify({ say: "He may.", actions: [] })] }), { roomId: narrated.world.location.player!, body: heard, addresseeId: agentId });

    const expected = await rules.decide(new FakeLlmClient({ replies: [NPC_YIELD] }), choice.id);
    const llm = new FakeLlmClient({ replies: [narrate(JSON.stringify({ announcement: NARRATION, sharedContextAppend: "The agreement was signed on the quay.", effects: [], worldDeltas: [], privateNotes: [] }))] });
    const result = await narrated.decide(llm, choice.id);

    expect(result.ok && result.resolution.announcement).toBe(NARRATION);
    const prompt = llm.requests.find((request) => request.schemaName === "resolver_narration")!;
    expect(prompt.user).toContain(heard);
    expect(narrated.currentStage.id).toBe(rules.currentStage.id);
    expect(narrated.snapshot().dispositions).toEqual(rules.snapshot().dispositions);
    expect(narrated.state({ enabled: false, deadlineAt: null }).previousDecision?.outcome).toBe("The agreement was signed on the quay.");
    expect(expected.ok && expected.resolution.announcement).not.toBe(NARRATION);
  });

  it("falls back to the rules' announcement when the narration is unusable", async () => {
    const { spec, choice } = await openStage();
    const rules = PlaySession.start(spec, "llm-resolution-fallback", 1);
    const broken = PlaySession.start(spec, "llm-resolution-fallback", 1);
    const expected = await rules.decide(new FakeLlmClient({ replies: [NPC_YIELD] }), choice.id);
    const result = await broken.decide(new FakeLlmClient({ replies: [narrate("not json")] }), choice.id);
    expect(result.ok && result.resolution.announcement).toBe(expected.ok && expected.resolution.announcement);
    expect(broken.currentStage.id).toBe(rules.currentStage.id);
  });

  it("still resolves an expired stage without a model", async () => {
    const { spec } = await openStage();
    const session = PlaySession.start(spec, "llm-resolution-expire", 1);
    expect((await session.expire()).ok).toBe(true);
  });
});
