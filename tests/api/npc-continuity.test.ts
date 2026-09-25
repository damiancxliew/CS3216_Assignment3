import { findPath } from "@adventure/game-core";
import { FakeLlmClient, moveActorStep } from "@adventure/orchestration";
import { loadI1Spec } from "@adventure/generation/fixtures";
import { describe, expect, it } from "vitest";

import { PlaySession } from "@/lib/play/session";

function approach(session: PlaySession, agentId: string) {
  const spatial = session.world.spatial!;
  const path = findPath(spatial.map, spatial.state.doors, spatial.state.actors.player!, spatial.state.actors[agentId]!);
  expect(path).not.toBeNull();
  for (const point of path!) expect(moveActorStep(session.world, "player", point).ok).toBe(true);
  return session.world.location.player!;
}

describe("NPC continuity and conflicting accounts", () => {
  it("carries the actual decision and a returning stakeholder's reaction into the next stage", async () => {
    const spec = structuredClone(await loadI1Spec());
    const opening = spec.stages[0]!;
    // Isolate continuity from the objective gate; that gate has its own API coverage.
    opening.decision.requires = [];
    for (const option of opening.decision.options) option.preconditions = [];
    const session = PlaySession.start(spec, "npc-continuity", 1);
    const choice = opening.decision.options.find((option) => option.id === "opt-sign-preliminary")!;
    const yielded = new FakeLlmClient({ replies: [JSON.stringify({ say: "", actions: [{ type: "yield" }] })] });
    expect((await session.decide(yielded, choice.id)).ok).toBe(true);
    expect(session.currentStage.id).toBe("stage-sultan");
    expect(session.state({ enabled: false, deadlineAt: null }).previousDecision?.choice).toBe(choice.label);

    const restored = PlaySession.resume(spec, "npc-continuity", 1, session.snapshot());
    const returning = restored.currentStage.agents.find((agent) => agent.stakeholderId === "temenggong")!;
    const roomId = approach(restored, returning.id);
    const llm = new FakeLlmClient({ replies: [JSON.stringify({ say: "I remember what you chose.", actions: [] })] });
    expect((await restored.message(llm, { roomId, body: "How do you feel about what I chose?", addresseeId: returning.id })).ok).toBe(true);
    expect(llm.lastRequest?.user).toContain(`The player chose "${choice.label}"`);
    expect(llm.lastRequest?.user).toContain(`After the player chose "${choice.label}"`);
    expect(restored.snapshot().dispositions.temenggong).toBeTypeOf("number");
  });

  it("reveals each grounded account only after that witness answers the same question", async () => {
    const spec = structuredClone(await loadI1Spec());
    const stage = spec.stages[0]!;
    const first = stage.agents.find((agent) => agent.stakeholderId === "farquhar")!;
    const second = stage.agents.find((agent) => agent.stakeholderId === "temenggong")!;
    const question = "Who has authority to grant the trading post?";
    stage.accountClues = [{
      id: "authority-accounts",
      question,
      firstAgentId: first.id,
      firstAccount: { text: "The preliminary agreement can be made now.", spans: first.publicPosition.spans, assumptionIds: [] },
      secondAgentId: second.id,
      secondAccount: { text: "A ruler's authority is needed for the land.", spans: second.publicPosition.spans, assumptionIds: [] },
      evidenceId: stage.evidence[0]!.id,
    }];
    let now = Date.now();
    const session = PlaySession.start(spec, "account-clues", 1, { now: () => new Date(now) });
    const clues = () => session.state({ enabled: false, deadlineAt: null }).accountClues[0]!;
    expect(clues().first.account).toBeNull();
    expect(clues().second.account).toBeNull();

    const firstRoom = approach(session, first.id);
    const firstLlm = new FakeLlmClient({ replies: [JSON.stringify({ say: "We should settle this immediately.", actions: [] })] });
    expect((await session.message(firstLlm, { roomId: firstRoom, body: `${first.id}, ${question}`, addresseeId: first.id })).ok).toBe(true);
    expect(clues().first.account).toBe(stage.accountClues[0]!.firstAccount.text);
    expect(clues().first.quote).toBe("We should settle this immediately.");
    expect(clues().second.account).toBeNull();

    now += 2_000;
    const secondRoom = approach(session, second.id);
    const secondLlm = new FakeLlmClient({ replies: [JSON.stringify({ say: "The ruler's signature matters.", actions: [] })] });
    expect((await session.message(secondLlm, { roomId: secondRoom, body: `${second.id}, ${question}`, addresseeId: second.id })).ok).toBe(true);
    expect(clues().second.account).toBe(stage.accountClues[0]!.secondAccount.text);
    expect(clues().second.quote).toBe("The ruler's signature matters.");
  });
});
